'use strict';

/**
 * server.js — Express backend for SceneFlow
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const { exec, spawn } = require('child_process');
const multer = require('multer');

const { buildTimeline, parseFilename, formatTime } = require('./src/parser');
const { parseCaptionText, spreadWords, writeASSFile } = require('./src/captions');
const { render, cancelJob, RESOLUTION, QUALITY_PRESETS, getAudioDuration } = require('./src/renderer');
const { probeEncoder } = require('./src/encoder');
const { pickFolder } = require('./src/dialog');
const { extractZipMedia } = require('./src/zip_extractor');
const settingsStore = require('./src/settings');
const historyStore = require('./src/history');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const isVercel = Boolean(process.env.VERCEL);

const TEMP_DIR = isVercel ? path.join(os.tmpdir(), 'sceneflow_temp') : path.join(__dirname, 'temp');
try { if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch {}

const UPLOADS_DIR = isVercel ? path.join(os.tmpdir(), 'sceneflow_uploads') : path.join(__dirname, 'uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}

const EXPORTS_DIR = isVercel ? path.join(os.tmpdir(), 'sceneflow_exports') : path.join(__dirname, 'exports');
try { if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true }); } catch {}

function getDefaultExportDir() {
  if (isVercel) return EXPORTS_DIR;
  return process.platform === 'win32' && fs.existsSync('C:\\') ? 'C:\\' : EXPORTS_DIR;
}

// Legacy page URL redirects (keep old links and bookmarks working)
const LEGACY_ROUTE_REDIRECTS = {
  '/vo-hunter': '/voice',
  '/voiceover': '/voice',
  '/script-splitter': '/timing',
  '/script-hunter': '/timing',
  '/prompt': '/prompts',
  '/prompt-hunter': '/prompts',
  '/prompt-mapper': '/prompts',
  '/image': '/images',
  '/image-batch': '/images',
  '/frame-hunter': '/studio'
};

Object.entries(LEGACY_ROUTE_REDIRECTS).forEach(([oldPath, newPath]) => {
  app.get([oldPath, `${oldPath}/`], (req, res) => {
    res.redirect(301, newPath);
  });
});

app.use('/js', express.static(path.join(__dirname, 'public', 'js'), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./src/routes_timing'));
app.use(require('./src/routes_voice'));

function isDirWritable(dirPath) {
  const probe = path.join(dirPath, `.sceneflow_write_probe_${process.pid}_${Date.now()}`);
  try {
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// Auto-cleanup for web deployment: delete temporary uploads older than 2 hours every 30 minutes
function cleanupOldFiles() {
  const maxAgeMs = 2 * 60 * 60 * 1000; // 2 hours
  const now = Date.now();
  for (const dir of [TEMP_DIR, UPLOADS_DIR]) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        try {
          const stat = fs.statSync(full);
          if (stat.isFile() && (now - stat.mtimeMs > maxAgeMs)) {
            fs.unlinkSync(full);
          }
        } catch {}
      }
    } catch {}
  }
}
const cleanupTimer = setInterval(cleanupOldFiles, 30 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

// Fix UTF-8 encoding in filenames (handles em-dash, accents, etc.)
function fixFilenameEncoding(name) {
  if (!name) return name;
  // If string contains non-ASCII characters outside Latin-1 range (like em-dash \u2014, en-dash \u2013),
  // it is ALREADY properly decoded Unicode! DO NOT touch it!
  if (/[\u0100-\uFFFF]/.test(name)) return name;

  // Only attempt latin1->utf8 fix if it contains typical UTF-8 mojibake patterns
  if (/[\xC0-\xFF]/.test(name)) {
    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      if (!decoded.includes('\uFFFD')) return decoded;
    } catch {}
  }
  return name;
}

// Multer storage: preserve original filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const cleanName = fixFilenameEncoding(file.originalname);
    cb(null, cleanName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB per file
});

// ── In-memory job registry ───────────────────────────────────────────────
const jobs = {}; // jobId → { status, progress, result, error, sseClients[] }

// ── Media file preview (for local disk files) ───────────────────────────
app.get('/api/media-preview', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.resolve(filePath));
});

// ── Upload Media (images / videos) ────────────────────────────────────────
app.post('/api/upload-media', (req, res, next) => {
  req.setTimeout(120000);
  res.setTimeout(120000);
  upload.array('media', 1000)(req, res, (err) => {
    if (err) {
      console.error('Multer upload-media error:', err);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, (req, res) => {
  try {
    const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;
    const uploaded = (req.files || []).map(f => {
      const name = fixFilenameEncoding(f.originalname);
      return {
        name,
        path: f.path,
        type: VIDEO_EXT.test(name) ? 'video' : 'image',
        size: f.size
      };
    });
    res.json({ ok: true, files: uploaded, count: uploaded.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Upload Zip Archive (extracts images / videos) ─────────────────────────
app.post('/api/upload-zip', (req, res, next) => {
  req.setTimeout(0);
  res.setTimeout(0);
  upload.single('zip')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No zip file uploaded' });
  }
  const zipPath = req.file.path;
  try {
    const files = extractZipMedia(zipPath, UPLOADS_DIR);
    res.json({ ok: true, files, count: files.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    try { fs.unlinkSync(zipPath); } catch {}
  }
});

// ── Upload Audio (voiceover / background music) ────────────────────────────
app.post('/api/upload-audio', (req, res, next) => {
  req.setTimeout(60000);
  res.setTimeout(60000);
  upload.single('audio')(req, res, (err) => {
    if (err) {
      console.error('Multer upload-audio error:', err);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
    const name = fixFilenameEncoding(req.file.originalname);
    const filePath = req.file.path;
    let duration = 0;
    if (req.body && req.body.clientDuration) {
      duration = parseFloat(req.body.clientDuration) || 0;
    }
    if (!duration) {
      duration = await getAudioDuration(filePath);
    }
    res.json({
      ok: true,
      name,
      path: filePath,
      duration: duration || 0,
      size: req.file.size
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Native Folder Picker ──────────────────────────────────────────────────
app.post('/api/select-folder', async (req, res) => {
  try {
    const result = await pickFolder();
    res.json(result);
  } catch (e) {
    res.json({ path: null });
  }
});

// ── Quick Folders ──────────────────────────────────────────────────────────
app.get('/api/quick-folders', (req, res) => {
  const home = os.homedir();
  const candidates = [
    { label: 'Render Output', path: path.join(__dirname, 'test', 'render_output') },
    { label: 'Exports', path: EXPORTS_DIR },
    { label: 'Videos', path: path.join(home, 'Videos') },
    { label: 'Desktop', path: path.join(home, 'Desktop') },
    { label: 'Downloads', path: path.join(home, 'Downloads') },
  ];
  const list = [];
  for (const item of candidates) {
    try {
      if (!fs.existsSync(item.path)) {
        fs.mkdirSync(item.path, { recursive: true });
      }
      list.push(item);
    } catch {
      // Skip if inaccessible
    }
  }
  res.json(list);
});

// ── Settings ─────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const s = settingsStore.load();
  if (!s.saveFolder) s.saveFolder = getDefaultExportDir();
  res.json(s);
});

app.post('/api/settings', (req, res) => {
  try {
    const saved = settingsStore.save(req.body);
    res.json({ ok: true, settings: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── History ───────────────────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  res.json(historyStore.load());
});

app.delete('/api/history', (req, res) => {
  res.json(historyStore.clear());
});

// ── Encoder probe ─────────────────────────────────────────────────────────
app.get('/api/probe-encoder', (req, res) => {
  try {
    const enc = probeEncoder();
    res.json(enc);
  } catch (e) {
    res.json({ encoder: 'libx264', label: 'CPU (libx264)' });
  }
});

// ── Scan folder ───────────────────────────────────────────────────────────
app.post('/api/scan-folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
  if (!fs.existsSync(folderPath)) return res.status(404).json({ error: `Folder not found: ${folderPath}` });

  try {
    const IMAGE_EXT = /\.(png|jpg|jpeg|gif|bmp|webp|tiff?)$/i;
    const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;

    const entries = fs.readdirSync(folderPath);
    const files = entries
      .filter(name => IMAGE_EXT.test(name) || VIDEO_EXT.test(name))
      .map(name => ({
        name,
        path: path.join(folderPath, name),
        type: VIDEO_EXT.test(name) ? 'video' : 'image',
      }));

    res.json({ files, count: files.length, folderPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Parse filenames → timeline ────────────────────────────────────────────
app.post('/api/parse-filenames', (req, res) => {
  const { files, gapMode = 'extend' } = req.body;
  if (!files || !Array.isArray(files)) return res.status(400).json({ error: 'files[] required' });

  try {
    const clips = buildTimeline(files, { gapMode });
    res.json({ clips, totalDuration: clips.length > 0 ? clips[clips.length - 1].endSec : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Audio duration probe ───────────────────────────────────────────────────
app.post('/api/audio-duration', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const duration = await getAudioDuration(filePath);
  res.json({ duration });
});

// ── Disk space check ──────────────────────────────────────────────────────
app.post('/api/disk-space', (req, res) => {
  const { folderPath } = req.body;
  const checkPath = folderPath || EXPORTS_DIR;
  const drive = checkPath.match(/^([A-Za-z]:)/)?.[1] || 'C:';

  exec(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`, (err, stdout) => {
    if (err) return res.json({ free: -1 });
    const match = stdout.match(/FreeSpace=(\d+)/);
    res.json({ free: match ? parseInt(match[1]) : -1 });
  });
});

// ── Open folder or select file in Windows Explorer ──────────────────────────────
app.post('/api/open-folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });

  // Normalize path with Windows backslashes
  const winPath = path.resolve(folderPath.replace(/\//g, '\\'));

  function launchExplorer(args) {
    try {
      const argStr = args.map(a => `"${a}"`).join(' ');
      exec(`explorer.exe ${argStr}`, { windowsHide: false }, () => {});
      return true;
    } catch (e) {
      console.warn('explorer launch error:', e.message);
      return false;
    }
  }

  if (fs.existsSync(winPath)) {
    const stat = fs.statSync(winPath);
    const targetDir = stat.isFile() ? path.dirname(winPath) : winPath;
    launchExplorer([targetDir]);
    return res.json({ ok: true, type: 'directory', path: targetDir });
  } else {
    // If exact target doesn't exist yet, try its parent directory
    const parentDir = path.dirname(winPath);
    if (fs.existsSync(parentDir)) {
      launchExplorer([parentDir]);
      return res.json({ ok: true, type: 'parent_directory', path: parentDir });
    }
    launchExplorer([winPath]);
    res.json({ ok: true, type: 'fallback', path: winPath });
  }
});

// ── Caption word timing ───────────────────────────────────────────────────
app.post('/api/parse-captions', (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ lines: [], words: [], wordCount: 0 });
  const lines = parseCaptionText(text);
  const words = spreadWords(lines);
  res.json({ lines, words, wordCount: words.length });
});

// ── Export: start render job ──────────────────────────────────────────────
app.post('/api/export', async (req, res) => {
  const jobId = uuidv4();
  const jobData = req.body;

  // Validation: ensure clips exist and their file paths exist
  const clips = jobData.clips || [];
  if (!clips.length) {
    return res.status(400).json({ error: 'No clips provided for export.' });
  }

  // Check if any non-gap clips are missing paths on disk
  const missingFiles = [];
  for (const clip of clips) {
    if (clip.type !== 'gap') {
      if (!clip.path) {
        missingFiles.push(clip.name);
      } else if (!fs.existsSync(clip.path)) {
        // Try fallback in uploads dir
        const fallback = path.join(UPLOADS_DIR, clip.name);
        if (fs.existsSync(fallback)) {
          clip.path = fallback;
        } else {
          missingFiles.push(`${clip.name}`);
        }
      }
    }
  }

  if (missingFiles.length > 0) {
    return res.status(400).json({
      error: `The following media files were not found on disk:\n• ${missingFiles.slice(0, 5).join('\n• ')}${missingFiles.length > 5 ? `\n• ...and ${missingFiles.length - 5} more` : ''}\n\nPlease add them via "Add Folder" or upload them again.`
    });
  }

  jobs[jobId] = {
    status: 'queued',
    progress: { stage: 'Queued', pct: 0 },
    result: null,
    error: null,
    sseClients: [],
  };

  res.json({ jobId });

  // Run async
  (async () => {
    const job = jobs[jobId];
    job.status = 'running';

    try {
      // Generate ASS file if captions present
      let assFile = null;
      if (jobData.captionWords?.length && jobData.captionStyle !== 'none') {
        const { w, h } = RESOLUTION[jobData.videoSize || '1080p'] || RESOLUTION['1080p'];
        assFile = writeASSFile(jobData.captionWords, {
          style: jobData.captionStyle,
          color: jobData.captionColor,
          highlightColor: jobData.captionHighlight,
          font: jobData.captionFont,
          size: jobData.captionSize || 48,
          position: jobData.captionPosition,
          videoWidth: w,
          videoHeight: h,
          wordsPerLine: jobData.wordsPerLine || 'all',
        }, TEMP_DIR);
      }

      // Ensure output dir exists
      const requestedDir = (jobData.saveFolder || '').trim();
      let outDir = jobData.useBrowserDir
        ? TEMP_DIR
        : (requestedDir && fs.existsSync(requestedDir) ? requestedDir : getDefaultExportDir());
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      if (!jobData.useBrowserDir && !isDirWritable(outDir)) {
        const subDir = path.join(outDir, 'SceneFlow');
        try {
          fs.mkdirSync(subDir, { recursive: true });
          if (isDirWritable(subDir)) outDir = subDir;
        } catch {}
        if (!isDirWritable(outDir)) {
          outDir = EXPORTS_DIR;
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        }
      }

      const cleanFileName = (jobData.fileName || `export_${Date.now()}`).replace(/\.mp4$/i, '') + '.mp4';
      const outputPath = path.join(outDir, cleanFileName);

      const result = await render(
        { ...jobData, assFile, outputPath, tempDir: TEMP_DIR },
        (progress) => {
          job.progress = progress;
          broadcastSSE(jobId, { type: 'progress', ...progress });
        },
        jobId
      );

      job.status = 'done';
      job.result = result;
      broadcastSSE(jobId, { type: 'done', ...result });

      // Save to history
      const stat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
      historyStore.add({
        fileName: path.basename(outputPath),
        outputPath,
        folder: path.dirname(outputPath),
        duration: result.duration,
        fileSize: result.fileSize,
        resolution: result.resolution,
        encoder: result.encoder,
        clips: jobData.clips?.length || 0,
        date: new Date().toISOString(),
      });

      // Persist last save folder when saving directly to OS path
      if (!jobData.useBrowserDir) {
        settingsStore.save({ saveFolder: requestedDir || outDir });
      }

    } catch (e) {
      job.status = 'error';
      job.error = e.message;
      broadcastSSE(jobId, { type: 'error', message: e.message });
    }
  })();
});

// ── Export progress (SSE) ─────────────────────────────────────────────────
app.get('/api/export/:jobId/progress', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state immediately
  res.write(`data: ${JSON.stringify({ type: 'progress', ...job.progress })}\n\n`);
  if (job.status === 'done') {
    res.write(`data: ${JSON.stringify({ type: 'done', ...job.result })}\n\n`);
    return res.end();
  }
  if (job.status === 'error') {
    res.write(`data: ${JSON.stringify({ type: 'error', message: job.error })}\n\n`);
    return res.end();
  }

  job.sseClients.push(res);
  req.on('close', () => {
    job.sseClients = job.sseClients.filter(c => c !== res);
  });
});

function broadcastSSE(jobId, data) {
  const job = jobs[jobId];
  if (!job) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of job.sseClients) {
    try { client.write(msg); } catch {}
    if (data.type === 'done' || data.type === 'error') {
      try { client.end(); } catch {}
    }
  }
  if (data.type === 'done' || data.type === 'error') {
    job.sseClients = [];
  }
}

// ── Cancel export ─────────────────────────────────────────────────────────
app.post('/api/export/:jobId/cancel', (req, res) => {
  const { jobId } = req.params;
  const cancelled = cancelJob(jobId);
  const job = jobs[jobId];
  if (job) { job.status = 'cancelled'; broadcastSSE(jobId, { type: 'error', message: 'Cancelled by user' }); }
  res.json({ ok: cancelled });
});

app.get('/api/export/:jobId/download', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== 'done' || !job.result?.outputPath || !fs.existsSync(job.result.outputPath)) {
    return res.status(404).json({ error: 'Export file not found' });
  }
  res.download(job.result.outputPath, path.basename(job.result.outputPath));
});

app.get('/api/export/:jobId/stream', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== 'done' || !job.result?.outputPath || !fs.existsSync(job.result.outputPath)) {
    return res.status(404).json({ error: 'Export file not found' });
  }
  res.sendFile(path.resolve(job.result.outputPath));
});

// ── SPA Page Routes & Fallback ────────────────────────────────────────────
app.get(['/', '/voice', '/timing', '/prompts', '/images', '/studio'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🎬  SceneFlow running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
