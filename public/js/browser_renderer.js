'use strict';

/**
 * browser_renderer.js — Pure In-Browser Client-Side Video Compilation Engine
 * 
 * Compiles timeline clips, motion effects (Ken Burns zoom/pan), multi-track audio mixing,
 * and styled kinetic captions directly inside the user's browser without requiring
 * desktop FFmpeg or a backend server.
 * 
 * Compatible with Chrome, Edge, Safari, Firefox, and serverless hosting (Vercel).
 */

import { Muxer, ArrayBufferTarget } from './mp4-muxer.js';

export const BROWSER_RESOLUTIONS = {
  '720p':  { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2K':    { width: 2560, height: 1440 },
  '4K':    { width: 3840, height: 2160 },
};

/**
 * Check if the browser supports fast offline WebCodecs MP4 encoding.
 */
export async function isWebCodecsSupported(width = 1280, height = 720) {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const videoSupport = await VideoEncoder.isConfigSupported({
      codec: 'avc1.4d002a', // H.264 Main Profile Level 4.2
      width,
      height,
      bitrate: 4_000_000,
      framerate: 30,
    });
    return Boolean(videoSupport && videoSupport.supported);
  } catch (err) {
    return false;
  }
}

/**
 * Check if the browser supports AAC AudioEncoder.
 */
export async function isAacAudioSupported() {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const audioSupport = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      numberOfChannels: 2,
      sampleRate: 44100,
      bitrate: 128_000,
    });
    return Boolean(audioSupport && audioSupport.supported);
  } catch (err) {
    return false;
  }
}

/**
 * Load an image from a File, Blob, or URL into an HTMLImageElement or ImageBitmap.
 */
async function loadMediaImage(fileItem) {
  if (!fileItem) return null;
  return new Promise((resolve) => {
    let src = '';
    if (fileItem.file) {
      src = URL.createObjectURL(fileItem.file);
    } else if (fileItem.objectUrl) {
      src = fileItem.objectUrl;
    } else if (fileItem.path && !fileItem.path.startsWith('client:')) {
      src = `/api/media-preview?path=${encodeURIComponent(fileItem.path)}`;
    }

    if (!src) return resolve(null);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn('Could not load image for browser render:', fileItem.name);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Apply smooth Ken Burns zoom/pan cinematic motion to the canvas.
 */
function drawClipFrame(ctx, img, motion, p, w, h) {
  if (!img) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const zoomRange = 0.10; // 10% smooth motion
  let scale = 1.0;
  let tx = 0;
  let ty = 0;

  if (motion === 'zoomIn') {
    scale = 1.0 + zoomRange * p;
  } else if (motion === 'zoomOut') {
    scale = (1.0 + zoomRange) - zoomRange * p;
  } else if (motion === 'panLeft') {
    scale = 1.10;
    tx = -(w * 0.10) * p;
  } else if (motion === 'panRight') {
    scale = 1.10;
    tx = -(w * 0.10) * (1.0 - p);
  } else {
    scale = 1.0;
  }

  const imgW = img.naturalWidth || img.width || w;
  const imgH = img.naturalHeight || img.height || h;
  const imgAspect = imgW / imgH;
  const targetAspect = w / h;

  let drawW, drawH;
  if (imgAspect > targetAspect) {
    drawH = h * scale;
    drawW = drawH * imgAspect;
  } else {
    drawW = w * scale;
    drawH = drawW / imgAspect;
  }

  const cx = w / 2 + tx;
  const cy = h / 2 + ty;
  const dx = cx - drawW / 2;
  const dy = cy - drawH / 2;

  ctx.drawImage(img, dx, dy, drawW, drawH);
}

/**
 * Render styled kinetic captions on the canvas at time `t`.
 */
function drawCaptionsOnCanvas(ctx, captionLines, style, font, textColor, highlightColor, pos, baseSize, t, w, h) {
  if (!captionLines || !captionLines.length || style === 'none') return;

  const line = captionLines.find(l => t >= l.startSec && t <= l.endSec);
  if (!line || !line.words || !line.words.length) return;

  const words = line.words;
  const isUppercase = ['bold', 'bold-highlight', 'poppin', 'poppin-clean', 'beast', 'hustle', 'aarit', 'gaming-stream', 'simple-one-word'].includes(style);
  const isHighlightStyle = ['bold-highlight', 'poppin', 'beast', 'hustle', 'pupcaps', 'podcast', 'aarit', 'gaming-stream'].includes(style);

  // Position relative to canvas resolution
  const posX = (pos?.x ?? 50) / 100 * w;
  const posY = (pos?.y ?? 80) / 100 * h;

  // Scale font size based on canvas height (reference 720p)
  const fontPx = Math.max(16, Math.round(baseSize * (h / 720)));
  const fontSpec = `bold ${fontPx}px '${font || 'Poppins'}', sans-serif`;

  ctx.font = fontSpec;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Single focal word style
  if (style === 'simple-one-word') {
    let activeIdx = words.findIndex(item => t >= item.startSec && t < item.endSec);
    if (activeIdx === -1) activeIdx = t >= line.endSec ? words.length - 1 : 0;
    const wordText = (isUppercase ? words[activeIdx].word.toUpperCase() : words[activeIdx].word) || '';

    // Black shadow / outline
    ctx.lineWidth = Math.max(4, Math.round(fontPx * 0.16));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(wordText, posX, posY);

    ctx.fillStyle = textColor;
    ctx.fillText(wordText, posX, posY);
    return;
  }

  // Full line kinetic karaoke highlight
  let activeIdx = words.findIndex(item => t >= item.startSec && t < item.endSec);
  if (activeIdx === -1) {
    activeIdx = t >= line.endSec ? words.length - 1 : 0;
  }

  // Calculate width of each word to layout horizontally centered
  const spaceWidth = ctx.measureText(' ').width;
  const wordWidths = words.map(item => {
    const text = isUppercase ? item.word.toUpperCase() : item.word;
    return ctx.measureText(text).width;
  });
  const totalLineWidth = wordWidths.reduce((a, b) => a + b, 0) + (words.length - 1) * spaceWidth;

  let startX = posX - totalLineWidth / 2;

  for (let i = 0; i < words.length; i++) {
    const item = words[i];
    const text = isUppercase ? item.word.toUpperCase() : item.word;
    const itemW = wordWidths[i];
    const wordX = startX + itemW / 2;

    const isActive = i === activeIdx;
    const isPast = i < activeIdx;

    let color = textColor;
    if (isHighlightStyle) {
      if (isActive) color = highlightColor;
      else if (isPast) color = textColor;
      else color = 'rgba(255, 255, 255, 0.45)';
    }

    // Heavy drop shadow / outline for crisp legibility
    ctx.lineWidth = Math.max(3, Math.round(fontPx * 0.14));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, wordX, posY);

    ctx.fillStyle = color;
    ctx.fillText(text, wordX, posY);

    startX += itemW + spaceWidth;
  }
}

/**
 * Decode an audio source (File, Blob, or URL) into an AudioBuffer.
 */
async function decodeAudioSource(audioCtx, audioObj) {
  if (!audioObj) return null;
  try {
    let arrayBuf = null;
    if (audioObj.file) {
      arrayBuf = await audioObj.file.arrayBuffer();
    } else if (audioObj.path && !audioObj.path.startsWith('client:')) {
      const resp = await fetch(`/api/audio?path=${encodeURIComponent(audioObj.path)}`);
      if (resp.ok) arrayBuf = await resp.arrayBuffer();
    }
    if (!arrayBuf) return null;
    return await audioCtx.decodeAudioData(arrayBuf);
  } catch (err) {
    console.warn('Audio decode warning:', err);
    return null;
  }
}

/**
 * Compile video directly inside the browser using WebCodecs + mp4-muxer.
 */
export async function compileVideoInBrowser({
  clips = [],
  files = [],
  voiceover = null,
  music = null,
  musicVolume = 0.15,
  captionLines = [],
  captionStyle = 'bold-highlight',
  captionFont = 'Poppins',
  captionColor = '#FFFFFF',
  captionHighlight = '#FACC15',
  captionSize = 36,
  captionPosition = { x: 50, y: 80 },
  resolution = '720p',
  fps = 30,
  fileName = 'export.mp4',
  onProgress = () => {},
  signal = null,
}) {
  const resSpec = BROWSER_RESOLUTIONS[resolution] || BROWSER_RESOLUTIONS['720p'];
  const width = resSpec.width;
  const height = resSpec.height;

  onProgress({ pct: 2, stage: 'Preparing browser compilation engine…' });

  // 1. Audio mixing setup
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
  let voBuffer = null;
  let musicBuffer = null;

  try {
    if (voiceover) {
      onProgress({ pct: 5, stage: 'Decoding voiceover audio…' });
      voBuffer = await decodeAudioSource(audioCtx, voiceover);
    }
    if (music) {
      onProgress({ pct: 8, stage: 'Decoding background music…' });
      musicBuffer = await decodeAudioSource(audioCtx, music);
    }
  } catch (err) {
    console.warn('Audio decoding skipped:', err);
  }

  // Determine total duration
  const lastClipEnd = clips.length > 0 ? clips[clips.length - 1].endSec : 0;
  const totalDuration = Math.max(1.0, lastClipEnd || (voBuffer ? voBuffer.duration : 0));
  const totalFrames = Math.max(1, Math.round(totalDuration * fps));

  // Mix audio into a single stereo Float32Array buffer
  const sampleRate = 44100;
  const totalSamples = Math.ceil(totalDuration * sampleRate);
  let mixedLeft = null;
  let mixedRight = null;
  const hasAudio = Boolean(voBuffer || musicBuffer);

  if (hasAudio) {
    mixedLeft = new Float32Array(totalSamples);
    mixedRight = new Float32Array(totalSamples);

    if (voBuffer) {
      const voL = voBuffer.getChannelData(0);
      const voR = voBuffer.numberOfChannels > 1 ? voBuffer.getChannelData(1) : voL;
      const len = Math.min(totalSamples, voL.length);
      for (let i = 0; i < len; i++) {
        mixedLeft[i] += voL[i];
        mixedRight[i] += voR[i];
      }
    }

    if (musicBuffer) {
      const vol = typeof musicVolume === 'number' ? musicVolume : 0.15;
      const musL = musicBuffer.getChannelData(0);
      const musR = musicBuffer.numberOfChannels > 1 ? musicBuffer.getChannelData(1) : musL;
      const musLen = musL.length;
      for (let i = 0; i < totalSamples; i++) {
        const idx = i % musLen;
        mixedLeft[i] += musL[idx] * vol;
        mixedRight[i] += musR[idx] * vol;
      }
    }

    // Clamp values to [-1.0, 1.0] to prevent audio clipping
    for (let i = 0; i < totalSamples; i++) {
      mixedLeft[i] = Math.max(-1.0, Math.min(1.0, mixedLeft[i]));
      mixedRight[i] = Math.max(-1.0, Math.min(1.0, mixedRight[i]));
    }
  }

  // 2. Pre-load images for clips
  onProgress({ pct: 12, stage: `Pre-loading ${clips.length} clip media assets…` });
  const imageMap = new Map();
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (imageMap.has(c.name)) continue;
    const fileItem = files.find(f => f.name === c.name) || c;
    const img = await loadMediaImage(fileItem);
    if (img) imageMap.set(c.name, img);
  }

  // 3. Check WebCodecs availability
  const webCodecsSupported = await isWebCodecsSupported(width, height);
  const aacSupported = hasAudio ? await isAacAudioSupported() : false;

  if (!webCodecsSupported) {
    throw new Error('Your browser does not support WebCodecs hardware encoding. Please use a modern Chromium browser (Chrome or Edge) or run SceneFlow locally.');
  }

  onProgress({ pct: 15, stage: 'Initializing MP4 encoder…' });

  // 4. Initialize MP4 Muxer & VideoEncoder
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: hasAudio && aacSupported ? {
      codec: 'aac',
      numberOfChannels: 2,
      sampleRate: 44100,
    } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let videoError = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error('VideoEncoder error:', e);
      videoError = e;
    },
  });

  videoEncoder.configure({
    codec: 'avc1.4d002a',
    width,
    height,
    bitrate: resolution === '1080p' ? 8_000_000 : 4_000_000,
    framerate: fps,
  });

  // AudioEncoder (if supported)
  let audioEncoder = null;
  if (hasAudio && aacSupported) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error('AudioEncoder error:', e),
    });
    audioEncoder.configure({
      codec: 'mp4a.40.2',
      numberOfChannels: 2,
      sampleRate: 44100,
      bitrate: 128_000,
    });

    // Chunk and encode mixed audio
    const chunkSize = 1024;
    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
      if (signal?.aborted) throw new Error('Render cancelled');
      const frameCount = Math.min(chunkSize, totalSamples - offset);
      const audioDataBuf = new Float32Array(frameCount * 2);
      audioDataBuf.set(mixedLeft.subarray(offset, offset + frameCount), 0);
      audioDataBuf.set(mixedRight.subarray(offset, offset + frameCount), frameCount);

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: 44100,
        numberOfFrames: frameCount,
        numberOfChannels: 2,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: audioDataBuf,
      });

      audioEncoder.encode(audioData);
      audioData.close();
    }
    await audioEncoder.flush();
  }

  // 5. Canvas rendering setup
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  const startTime = Date.now();

  // 6. Encode video frames
  for (let f = 0; f < totalFrames; f++) {
    if (signal?.aborted) {
      videoEncoder.close();
      if (audioEncoder) audioEncoder.close();
      throw new Error('Render cancelled by user');
    }
    if (videoError) throw videoError;

    const t = f / fps;

    // Find active clip
    let clip = clips.find(c => t >= c.startSec && t < c.endSec);
    if (!clip && clips.length > 0) {
      clip = t >= totalDuration ? clips[clips.length - 1] : clips[0];
    }

    // Clear background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Draw active image with motion
    if (clip && clip.type !== 'gap') {
      const img = imageMap.get(clip.name);
      const clipDur = Math.max(0.1, clip.endSec - clip.startSec);
      const localP = Math.max(0.0, Math.min(1.0, (t - clip.startSec) / clipDur));
      drawClipFrame(ctx, img, clip.motion || 'none', localP, width, height);
    }

    // Draw kinetic captions
    drawCaptionsOnCanvas(
      ctx,
      captionLines,
      captionStyle,
      captionFont,
      captionColor,
      captionHighlight,
      captionPosition,
      captionSize,
      t,
      width,
      height
    );

    // Create VideoFrame & encode
    const timestampUs = Math.round(t * 1_000_000);
    const keyFrame = f % (fps * 2) === 0; // Keyframe every 2 seconds
    const videoFrame = new VideoFrame(canvas, { timestamp: timestampUs });
    videoEncoder.encode(videoFrame, { keyFrame });
    videoFrame.close();

    // Update progress & calculate ETA
    if (f % 5 === 0 || f === totalFrames - 1) {
      const pct = 15 + Math.round((f / totalFrames) * 80);
      const elapsed = (Date.now() - startTime) / 1000;
      const etaSec = f > 0 ? Math.round((elapsed / f) * (totalFrames - f)) : 0;
      onProgress({
        pct,
        stage: `Encoding frame ${f + 1} of ${totalFrames}…`,
        etaSec,
      });

      // Yield event loop so UI stays snappy and responsive
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress({ pct: 96, stage: 'Finalizing MP4 file container…' });
  await videoEncoder.flush();
  muxer.finalize();

  const { buffer } = muxer.target;
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(blob);

  onProgress({ pct: 100, stage: '✓ Video ready!' });

  return {
    blob,
    url: blobUrl,
    fileName: fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`,
    duration: totalDuration,
    fileSize: blob.size,
    resolution: `${width}x${height}`,
    encoder: 'Browser WebCodecs (Hardware)',
  };
}

/**
 * Automatically trigger browser file download.
 */
export function triggerFileDownload(blobOrUrl, fileName = 'export.mp4') {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch {}
  }, 1500);
}
