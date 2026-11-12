'use strict';

/**
 * routes_timing.js — Express Router for SceneFlow Timing & Whisper AI
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const {
  getAllModelsStatus,
  getModelStatus,
  downloadModel,
  cancelModelDownload
} = require('./whisper_models');

const {
  checkWhisperEnv,
  transcribeAudio
} = require('./transcriber');

const {
  splitTranscript,
  validateRules,
  parseSRTToWords,
  parseScriptWithTimestampsToWords,
  exportCaptionsTxt,
  exportSRT,
  exportFilenamesListTxt,
  exportCSV,
  exportWordLevelJSON,
  exportBlocksJSON
} = require('./timing');

const { getAudioDuration } = require('./renderer');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
// Keep 'splitter_projects' directory name to preserve previously saved user Timing projects
const PROJECTS_DIR = path.join(__dirname, '..', 'data', 'splitter_projects');
if (!fs.existsSync(PROJECTS_DIR)) {
  try { fs.mkdirSync(PROJECTS_DIR, { recursive: true }); } catch {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// Download progress tracking
const downloadJobs = {
  fast: { status: 'idle', progress: null, sseClients: [] },
  best: { status: 'idle', progress: null, sseClients: [] }
};

function broadcastDownloadSSE(modelKey, data) {
  const job = downloadJobs[modelKey];
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

// Transcription jobs tracking
const transcriptionJobs = {};

function broadcastTranscribeSSE(jobId, data) {
  const job = transcriptionJobs[jobId];
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

// ─── 1. Whisper Status & Environment ─────────────────────────────────────────

router.get('/api/whisper/status', (req, res) => {
  const models = getAllModelsStatus();
  const env = checkWhisperEnv();
  res.json({ models, env });
});

// ─── 2. Model Download ───────────────────────────────────────────────────────

router.post('/api/whisper/download', async (req, res) => {
  const { model } = req.body;
  const modelKey = model === 'best' ? 'best' : 'fast';

  const job = downloadJobs[modelKey];
  if (job.status === 'downloading') {
    return res.json({ ok: true, status: 'already_downloading' });
  }

  job.status = 'downloading';
  job.progress = { percent: 0, mbDownloaded: 0, speedMb: '0.0', etaSec: 0 };
  res.json({ ok: true, status: 'started', model: modelKey });

  downloadModel(modelKey, (p) => {
    job.progress = p;
    broadcastDownloadSSE(modelKey, { type: 'progress', ...p });
  })
    .then((result) => {
      job.status = 'done';
      broadcastDownloadSSE(modelKey, { type: 'done', model: modelKey, status: result });
    })
    .catch((err) => {
      job.status = 'error';
      broadcastDownloadSSE(modelKey, { type: 'error', model: modelKey, message: err.message });
    });
});

router.get('/api/whisper/download/:model/progress', (req, res) => {
  const modelKey = req.params.model === 'best' ? 'best' : 'fast';
  const job = downloadJobs[modelKey];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (job.progress) {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...job.progress })}\n\n`);
  }

  job.sseClients.push(res);
  req.on('close', () => {
    job.sseClients = job.sseClients.filter(c => c !== res);
  });
});

router.post('/api/whisper/download/cancel', (req, res) => {
  const { model } = req.body;
  const modelKey = model === 'best' ? 'best' : 'fast';
  const cancelled = cancelModelDownload(modelKey);
  const job = downloadJobs[modelKey];
  if (job) {
    job.status = 'cancelled';
    broadcastDownloadSSE(modelKey, { type: 'error', message: 'Download cancelled by user' });
  }
  res.json({ ok: cancelled });
});

// ─── 3. Voiceover Upload & Audio Duration ────────────────────────────────────

router.post(['/api/timing/upload-audio', '/api/splitter/upload-audio'], upload.single('audio'), async (req, res) => {
  try {
    let filePath = null;
    let fileName = null;

    if (req.file) {
      filePath = path.resolve(req.file.path);
      fileName = req.file.originalname;
    } else if (req.body.audioPath && fs.existsSync(req.body.audioPath)) {
      filePath = path.resolve(req.body.audioPath);
      fileName = path.basename(filePath);
    } else {
      return res.status(400).json({ error: 'No audio file uploaded or path provided' });
    }

    let durationSec = 0;
    try {
      durationSec = await getAudioDuration(filePath);
    } catch {}

    res.json({
      ok: true,
      path: filePath,
      name: fileName,
      durationSec: Math.round(durationSec * 100) / 100
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 4. Run Transcription ───────────────────────────────────────────────────

router.post(['/api/timing/transcribe', '/api/splitter/transcribe'], async (req, res) => {
  let { audioPath, fileName, model, language } = req.body;

  if (!audioPath || !fs.existsSync(audioPath)) {
    if (fileName && fs.existsSync(path.join(UPLOADS_DIR, fileName))) {
      audioPath = path.join(UPLOADS_DIR, fileName);
    } else {
      try {
        const files = fs.readdirSync(UPLOADS_DIR)
          .map(f => ({ name: f, full: path.join(UPLOADS_DIR, f), time: fs.statSync(path.join(UPLOADS_DIR, f)).mtimeMs }))
          .sort((a, b) => b.time - a.time);
        if (files.length > 0 && fs.existsSync(files[0].full)) {
          audioPath = files[0].full;
        }
      } catch {}
    }
  }

  if (!audioPath || !fs.existsSync(audioPath)) {
    return res.status(400).json({ error: 'Audio file not found on server. Please upload an audio file first.' });
  }

  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: 'running',
    progress: null,
    result: null,
    error: null,
    sseClients: []
  };
  transcriptionJobs[jobId] = job;

  res.json({ ok: true, jobId });

  transcribeAudio(audioPath, { model, language }, (prog) => {
    job.progress = prog;
    broadcastTranscribeSSE(jobId, prog);
  })
    .then((result) => {
      job.status = 'done';
      job.result = result;
      broadcastTranscribeSSE(jobId, result);
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message;
      broadcastTranscribeSSE(jobId, { type: 'error', message: err.message });
    });
});

router.get(['/api/timing/transcribe/:jobId/progress', '/api/splitter/transcribe/:jobId/progress'], (req, res) => {
  const { jobId } = req.params;
  const job = transcriptionJobs[jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (job.progress) {
    res.write(`data: ${JSON.stringify(job.progress)}\n\n`);
  }
  if (job.status === 'done' && job.result) {
    res.write(`data: ${JSON.stringify(job.result)}\n\n`);
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

// ─── 5. Parse Alternative Inputs (SRT / Timestamped Script) ──────────────────

router.post(['/api/timing/parse-input', '/api/splitter/parse-input'], (req, res) => {
  const { text, type, durationSec } = req.body;
  if (!text) return res.json({ words: [] });

  let words = [];
  if (type === 'srt') {
    words = parseSRTToWords(text);
  } else {
    words = parseScriptWithTimestampsToWords(text, durationSec || 0);
  }

  res.json({
    ok: true,
    words,
    wordCount: words.length
  });
});

// ─── 6. Validate Rules ───────────────────────────────────────────────────────

router.post(['/api/timing/validate-rules', '/api/splitter/validate-rules'], (req, res) => {
  const { rules, audioDuration } = req.body;
  const validation = validateRules(rules || [], audioDuration || 0);
  res.json(validation);
});

// ─── 7. Run Timing Split Engine ──────────────────────────────────────────────

router.post(['/api/timing/split', '/api/splitter/split'], (req, res) => {
  const { words, audioDuration, options } = req.body;
  try {
    const result = splitTranscript(words || [], audioDuration || 0, options || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 8. Export Helpers ───────────────────────────────────────────────────────

router.post(['/api/timing/export', '/api/splitter/export'], (req, res) => {
  const { blocks, words, format } = req.body;
  if (!blocks || !Array.isArray(blocks)) {
    return res.status(400).json({ error: 'blocks array required' });
  }

  let content = '';
  let filename = 'sceneflow_export.txt';
  let mimeType = 'text/plain; charset=utf-8';

  switch (format) {
    case 'captions':
      content = exportCaptionsTxt(blocks);
      filename = 'sceneflow_captions.txt';
      break;
    case 'srt':
      content = exportSRT(blocks);
      filename = 'sceneflow_subtitles.srt';
      break;
    case 'filenames':
      content = exportFilenamesListTxt(blocks);
      filename = 'sceneflow_filenames_list.txt';
      break;
    case 'csv':
      content = exportCSV(blocks);
      filename = 'sceneflow_blocks.csv';
      mimeType = 'text/csv; charset=utf-8';
      break;
    case 'words_json':
      content = exportWordLevelJSON(words || []);
      filename = 'sceneflow_words_transcript.json';
      mimeType = 'application/json; charset=utf-8';
      break;
    case 'blocks_json':
      content = exportBlocksJSON(blocks);
      filename = 'sceneflow_blocks_data.json';
      mimeType = 'application/json; charset=utf-8';
      break;
    default:
      content = exportCaptionsTxt(blocks);
      filename = 'sceneflow_captions.txt';
  }

  res.json({ ok: true, content, filename, mimeType });
});

// ─── 9. Save & Reopen Projects ───────────────────────────────────────────────

router.post(['/api/timing/project/save', '/api/splitter/project/save'], (req, res) => {
  const { name, data } = req.body;
  const projName = (name || 'sceneflow_timing_project').replace(/[^a-zA-Z0-9_-]/g, '_');
  const projFile = path.join(PROJECTS_DIR, `${projName}_${Date.now()}.json`);
  fs.writeFileSync(projFile, JSON.stringify(data, null, 2), 'utf8');
  res.json({ ok: true, file: projFile, name: path.basename(projFile) });
});

router.get(['/api/timing/project/list', '/api/splitter/project/list'], (req, res) => {
  if (!fs.existsSync(PROJECTS_DIR)) return res.json([]);
  const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    const stat = fs.statSync(path.join(PROJECTS_DIR, f));
    return { name: f, size: stat.size, mtime: stat.mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  res.json(list);
});

router.get(['/api/timing/project/:filename', '/api/splitter/project/:filename'], (req, res) => {
  const fPath = path.join(PROJECTS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fPath)) return res.status(404).json({ error: 'File not found' });
  const raw = fs.readFileSync(fPath, 'utf8');
  res.json(JSON.parse(raw));
});

module.exports = router;
