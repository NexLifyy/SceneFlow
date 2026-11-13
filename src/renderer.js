/**
 * renderer.js — FFmpeg render pipeline for SceneFlow.
 *
 * Strategy:
 *  1. Build per-clip filter_complex in BATCHES of 50 clips → intermediate MP4 segments
 *  2. Concat all intermediate segments → final video
 *  3. Mix audio (voiceover + music)
 *  4. Burn captions (.ass) if provided
 *  5. Output H.264 MP4 with yuv420p + faststart
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { probeEncoder, getFfmpegPath } = require('./encoder');

const RESOLUTION = {
  '720p':  { w: 1280, h: 720  },
  '1080p': { w: 1920, h: 1080 },
  '2K':    { w: 2560, h: 1440 },
  '4K':    { w: 3840, h: 2160 },
};

const QUALITY_PRESETS = {
  draft:   { crf: 35, bitrate: '2000k'  },
  web:     { crf: 28, bitrate: '4000k'  },
  youtube: { crf: 23, bitrate: '8000k'  },
  high:    { crf: 18, bitrate: '16000k' },
  max:     { crf: 15, bitrate: '24000k' },
};

const MOTION_SPEED_SCALE = { slow: 0.5, medium: 1.0, fast: 2.0 };

// Active render jobs keyed by jobId
const activeJobs = {};

/**
 * Build a zoompan filter for a single clip.
 * @param {string} motion - 'zoomIn'|'zoomOut'|'panLeft'|'panRight'|'none'|'auto'
 * @param {number} durationSec
 * @param {number} w - output width
 * @param {number} h - output height
 * @param {string} speed - 'slow'|'medium'|'fast'
 * @param {number} fps
 */
function buildZoompan(motion, durationSec, w, h, speed, fps) {
  const frames = Math.max(1, Math.round(durationSec * fps));
  const s = MOTION_SPEED_SCALE[speed] || 1.0;

  // Zoom range for smooth, visible cinematic Ken Burns motion
  const zoomRange = 0.10 * s;

  // High-precision closed-form expressions that eliminate recursion jumps, subpixel jitter, and shaking
  const motionFilters = {
    none:     `scale=${w}:${h},setsar=1`,
    zoomIn:   `zoompan=z='1.0+${zoomRange}*(on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`,
    zoomOut:  `zoompan=z='1.0+${zoomRange}*(1.0-(on/${frames}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`,
    panLeft:  `zoompan=z='1.12':x='(iw-(iw/zoom))*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`,
    panRight: `zoompan=z='1.12':x='(iw-(iw/zoom))*(1.0-(on/${frames}))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`,
  };

  return motionFilters[motion] || motionFilters.none;
}

// Cycle through motion effects for 'auto'
const AUTO_MOTIONS = ['zoomIn', 'zoomOut', 'panLeft', 'panRight'];
function pickAutoMotion(index, enabledEffects = {}) {
  const available = AUTO_MOTIONS.filter(m => enabledEffects[m] !== false);
  if (!available.length) return 'none';
  return available[index % available.length];
}

/**
 * Probe audio duration via ffprobe.
 */
function getAudioDuration(filePath) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };
    const timer = setTimeout(() => done(0), 4000);
    try {
      const ffprobeStatic = require('ffprobe-static');
      const ffprobe = ffprobeStatic?.path || 'ffprobe';
      const proc = spawn(ffprobe, [
        '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
      ]);
      let out = '';
      if (proc.stdout) {
        proc.stdout.on('data', d => out += d);
      }
      proc.on('error', (err) => {
        clearTimeout(timer);
        console.warn('ffprobe spawn error in getAudioDuration:', err.message);
        done(0);
      });
      proc.on('close', () => {
        clearTimeout(timer);
        try {
          const info = JSON.parse(out);
          done(parseFloat(info.format?.duration || 0));
        } catch { done(0); }
      });
    } catch (err) {
      clearTimeout(timer);
      console.warn('getAudioDuration exception:', err.message);
      done(0);
    }
  });
}

/**
 * Run ffmpeg with args, reporting progress via onProgress(pct, fps, speed).
 * Returns promise that resolves when done.
 */
function runFfmpeg(args, totalDuration, onProgress, jobId) {
  return new Promise((resolve, reject) => {
    const ffmpeg = getFfmpegPath();
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    if (jobId) {
      activeJobs[jobId] = { proc, cancelled: false };
    }

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;

      // Parse progress: time=00:01:23.45
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && totalDuration > 0 && onProgress) {
        const elapsed = parseInt(timeMatch[1]) * 3600 +
                        parseInt(timeMatch[2]) * 60 +
                        parseFloat(timeMatch[3]);
        const pct = Math.min(99, Math.round((elapsed / totalDuration) * 100));
        const fpsMatch = text.match(/fps=\s*([\d.]+)/);
        const speedMatch = text.match(/speed=\s*([\d.]+)x/);
        onProgress(pct, parseFloat(fpsMatch?.[1] || 0), parseFloat(speedMatch?.[1] || 0));
      }
    });

    proc.on('close', (code) => {
      if (jobId) delete activeJobs[jobId];
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}.\n${stderr.slice(-2000)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

/**
 * Cancel an active render job.
 */
function cancelJob(jobId) {
  const job = activeJobs[jobId];
  if (job && job.proc) {
    job.cancelled = true;
    job.proc.kill('SIGTERM');
    return true;
  }
  return false;
}

/**
 * Fit/fill a source image into output dimensions.
 * fitMode: 'fit' → pad with black bars, 'fill' → scale+crop to fill
 */
function buildScaleFilter(w, h, fitMode) {
  if (fitMode === 'fill') {
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  // fit with black bars
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
}

/**
 * Main render function.
 *
 * @param {Object} job
 * @param {Function} onProgress - called with (stage, pct, detail)
 * @param {string} jobId
 */
async function render(job, onProgress, jobId) {
  const {
    clips,              // timeline clips from buildTimeline()
    voiceover,          // path or null
    music,              // path or null
    musicVolume = 0.3,
    videoSize = '1080p',
    quality = 'youtube',
    fps = 30,
    fitMode = 'fit',
    motionSpeed = 'medium',
    motionEffects = {},
    transitions = {},
    assFile = null,     // pre-generated .ass path or null
    outputPath,         // final output path
    tempDir,            // temp directory for intermediates
    voiceoverMode = 'cut', // 'cut' or 'extend'
  } = job;

  const { w, h } = RESOLUTION[videoSize] || RESOLUTION['1080p'];
  const { crf, bitrate } = QUALITY_PRESETS[quality] || QUALITY_PRESETS.youtube;
  const { encoder } = probeEncoder();

  // Ensure temp dir exists
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const progress = (stage, pct, detail = '') => {
    onProgress && onProgress({ stage, pct, detail });
  };

  // ── Step 1: Get voiceover duration ──────────────────────────────────────
  let voiceoverDuration = 0;
  if (voiceover && fs.existsSync(voiceover)) {
    voiceoverDuration = await getAudioDuration(voiceover);
  }

  // ── Compute total video duration ────────────────────────────────────────
  const lastClipEnd = clips.length > 0 ? clips[clips.length - 1].endSec : 0;
  let totalDuration = Math.max(lastClipEnd, voiceoverDuration);
  if (voiceoverMode === 'cut') {
    totalDuration = lastClipEnd > 0 ? lastClipEnd : voiceoverDuration;
  }

  progress('Preparing', 2, 'Analyzing clips...');

  // ── Step 2: Render clips in batches of 50 ───────────────────────────────
  const BATCH_SIZE = 50;
  const batches = [];
  for (let i = 0; i < clips.length; i += BATCH_SIZE) {
    batches.push(clips.slice(i, i + BATCH_SIZE));
  }

  const segmentPaths = [];

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const segPath = path.join(tempDir, `segment_${bIdx}.mp4`);
    segmentPaths.push(segPath);

    // Build ffmpeg args for this batch
    const args = ['-y'];

    // Input files
    for (const clip of batch) {
      if (clip.type === 'gap' || !clip.path) {
        // Black frame input
        args.push('-f', 'lavfi', '-i', `color=black:s=${w}x${h}:r=${fps}`);
      } else {
        // Loop image for its duration
        args.push('-loop', '1', '-t', String(Math.max(0.1, clip.durationSec)), '-i', clip.path);
      }
    }

    // Build filter_complex
    const filterParts = [];
    const streamLabels = [];

    for (let i = 0; i < batch.length; i++) {
      const clip = batch[i];
      const dur = Math.max(0.1, clip.durationSec);
      const frames = Math.max(1, Math.round(dur * fps));

      let motion = clip.motion === 'auto'
        ? pickAutoMotion(clips.indexOf(clip), motionEffects)
        : clip.motion || 'none';

      if (clip.type === 'gap') motion = 'none';

      let f;
      if (motion !== 'none' && clip.type !== 'gap') {
        const zoompanFilter = buildZoompan(motion, dur, w, h, motionSpeed, fps);
        const scaleFirst = buildScaleFilter(w * 4, h * 4, fitMode); // 4x super-resolution pre-scale completely eliminates integer rounding jitter
        f = `[${i}:v]${scaleFirst},${zoompanFilter},setpts=PTS-STARTPTS,fps=${fps},trim=duration=${dur}[v${i}]`;
      } else if (clip.type === 'gap') {
        f = `[${i}:v]scale=${w}:${h},fps=${fps},trim=duration=${dur}[v${i}]`;
      } else {
        const scaleFilter = buildScaleFilter(w, h, fitMode);
        f = `[${i}:v]${scaleFilter},fps=${fps},trim=duration=${dur},setpts=PTS-STARTPTS[v${i}]`;
      }

      filterParts.push(f);
      streamLabels.push(`[v${i}]`);
    }

    // Concat
    filterParts.push(`${streamLabels.join('')}concat=n=${batch.length}:v=1:a=0[outv]`);

    args.push('-filter_complex', filterParts.join(';'));
    args.push('-map', '[outv]');
    args.push('-c:v', encoder);
    if (encoder === 'libx264') {
      args.push('-crf', String(crf), '-preset', 'fast');
    } else {
      args.push('-b:v', bitrate);
    }
    args.push('-pix_fmt', 'yuv420p');
    args.push('-r', String(fps));
    args.push('-an');
    args.push(segPath);

    const batchProgress = (pct) => {
      const overall = Math.round((bIdx / batches.length) * 70 + (pct / 100) * (70 / batches.length));
      progress('Rendering', overall, `Batch ${bIdx + 1}/${batches.length}`);
    };

    // Estimate batch duration
    const batchDuration = batch.reduce((sum, c) => sum + (c.durationSec || 0), 0);
    await runFfmpeg(args, batchDuration, (pct) => batchProgress(pct), jobId);
  }

  progress('Concatenating', 72, 'Joining segments...');

  // ── Step 3: Concat all segments ─────────────────────────────────────────
  const concatListPath = path.join(tempDir, 'concat.txt');
  const concatContent = segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatListPath, concatContent, 'utf8');

  const concatVideoPath = path.join(tempDir, 'concat_video.mp4');
  const concatArgs = [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    concatVideoPath,
  ];
  await runFfmpeg(concatArgs, totalDuration, null, jobId);

  progress('Audio', 80, 'Mixing audio...');

  // ── Step 4: Mix audio + captions → final output ─────────────────────────
  const finalArgs = ['-y'];

  // Video input
  finalArgs.push('-i', concatVideoPath);

  // Audio inputs
  let audioInputCount = 0;
  if (voiceover && fs.existsSync(voiceover)) {
    finalArgs.push('-i', voiceover);
    audioInputCount++;
  }
  if (music && fs.existsSync(music)) {
    finalArgs.push('-i', music);
    audioInputCount++;
  }

  // Build audio filter
  let audioMap = null;
  if (audioInputCount === 2) {
    // Mix voiceover + music with volume
    const voiceover_idx = 1;
    const music_idx = 2;
    finalArgs.push('-filter_complex',
      `[${voiceover_idx}:a]apad[vo];[${music_idx}:a]volume=${musicVolume}[music];[vo][music]amix=inputs=2:duration=first[aout]`
    );
    audioMap = '[aout]';
  } else if (audioInputCount === 1) {
    audioMap = '1:a';
  }

  // Map video + audio
  finalArgs.push('-map', '0:v');
  if (audioMap) finalArgs.push('-map', audioMap);

  // Video codec
  finalArgs.push('-c:v', encoder);
  if (encoder === 'libx264') {
    finalArgs.push('-crf', String(crf), '-preset', 'fast');
  } else {
    finalArgs.push('-b:v', bitrate);
  }
  finalArgs.push('-pix_fmt', 'yuv420p');
  finalArgs.push('-r', String(fps));

  // Audio codec
  if (audioInputCount > 0) {
    finalArgs.push('-c:a', 'aac', '-b:a', '192k');
    if (voiceoverMode === 'cut') {
      finalArgs.push('-t', String(totalDuration));
    }
  }

  // Captions filter (burn subtitles)
  // Note: subtitles filter must be applied to video stream;
  // we do it in a separate pass after audio mix for simplicity
  finalArgs.push('-movflags', '+faststart');
  finalArgs.push(outputPath);

  await runFfmpeg(finalArgs, totalDuration, (pct) => {
    progress('Finalizing', 80 + Math.round(pct * 0.15), 'Muxing...');
  }, jobId);

  // ── Step 4b: Burn captions if needed ─────────────────────────────────────
  let finalOutput = outputPath;
  if (assFile && fs.existsSync(assFile)) {
    progress('Captions', 95, 'Burning subtitles...');
    const captionedPath = outputPath.replace('.mp4', '_captioned.mp4');

    // ASS paths need forward slashes and escaped colons on Windows
    const assPathEscaped = assFile.replace(/\\/g, '/').replace(/:/g, '\\:');
    const fontsDir = path.join(__dirname, '..', 'fonts');
    const fontsDirEscaped = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');

    const capArgs = [
      '-y', '-i', outputPath,
      '-vf', `subtitles='${assPathEscaped}':fontsdir='${fontsDirEscaped}'`,
      '-c:v', encoder,
    ];
    if (encoder === 'libx264') {
      capArgs.push('-crf', String(crf), '-preset', 'fast');
    } else {
      capArgs.push('-b:v', bitrate);
    }
    capArgs.push('-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart');
    capArgs.push(captionedPath);

    await runFfmpeg(capArgs, totalDuration, null, jobId);

    // Replace original with captioned
    fs.unlinkSync(outputPath);
    fs.renameSync(captionedPath, outputPath);
    finalOutput = outputPath;
  }

  progress('Done', 100, 'Complete');

  // Cleanup temp files
  try {
    for (const f of segmentPaths) if (fs.existsSync(f)) fs.unlinkSync(f);
    if (fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath);
    if (fs.existsSync(concatVideoPath)) fs.unlinkSync(concatVideoPath);
  } catch {}

  // Get final file size
  const stat = fs.existsSync(finalOutput) ? fs.statSync(finalOutput) : null;
  return {
    outputPath: finalOutput,
    fileSize: stat ? stat.size : 0,
    duration: totalDuration,
    encoder,
    resolution: `${w}x${h}`,
    fps,
    bitrate: encoder === 'libx264' ? `CRF ${crf}` : bitrate,
  };
}

module.exports = { render, cancelJob, RESOLUTION, QUALITY_PRESETS, getAudioDuration };
