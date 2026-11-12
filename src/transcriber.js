'use strict';

/**
 * transcriber.js — Backend transcription runner
 * Interfaces with python/transcribe.py (faster-whisper) with word-level timestamps,
 * stream progress, CUDA/CPU autodetection, and graceful fallbacks.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getModelStatus } = require('./whisper_models');

const PROJECT_ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'python', 'transcribe.py');

/**
 * Locate best Python executable:
 * 1. .venv/Scripts/python.exe
 * 2. System python
 * 3. System py
 */
function findPython() {
  const venvPy = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPy)) return venvPy;

  const venvLinux = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvLinux)) return venvLinux;

  const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\THE HAIDER\\AppData\\Local';
  const candidates = [
    path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
    'C:\\Python310\\python.exe',
    'C:\\Python311\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Program Files\\Python310\\python.exe',
    'C:\\Program Files\\Python311\\python.exe',
    '/usr/bin/python3',
    '/usr/local/bin/python3'
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return 'python3';
  } catch {}

  try {
    execSync('python --version', { stdio: 'ignore' });
    return 'python';
  } catch {}

  try {
    execSync('py --version', { stdio: 'ignore' });
    return 'py';
  } catch {}

  return null;
}

let cachedReadyEnv = null;

/**
 * Check transcription environment readiness
 */
function checkWhisperEnv(forceRefresh = false) {
  if (!forceRefresh && cachedReadyEnv && cachedReadyEnv.pythonPath && fs.existsSync(cachedReadyEnv.pythonPath)) {
    return cachedReadyEnv;
  }

  const py = findPython();
  if (!py) {
    return {
      ready: false,
      hasPython: false,
      hasFasterWhisper: false,
      pythonPath: null,
      message: 'Python was not detected. Please run setup to enable local transcription.'
    };
  }

  // Test transcription package import
  try {
    execSync(`"${py}" -c "import faster_whisper; print('OK')"`, { stdio: 'ignore' });
    cachedReadyEnv = {
      ready: true,
      hasPython: true,
      hasFasterWhisper: true,
      pythonPath: py,
      message: 'Local AI engine is ready.'
    };
    return cachedReadyEnv;
  } catch {
    return {
      ready: false,
      hasPython: true,
      hasFasterWhisper: false,
      pythonPath: py,
      message: 'Python is installed, but transcription package is missing.'
    };
  }
}

/**
 * Run transcription on audio file
 * 
 * @param {string} audioPath - Absolute path to audio file
 * @param {Object} options - { model: 'fast'|'best', language: 'auto'|string }
 * @param {Function} onProgress - Progress callback ({ percent, processedSec, totalSec, etaSec })
 */
function transcribeAudio(audioPath, options = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
    const py = findPython();
    if (!py) {
      return reject(new Error('Python is not installed. Please install local dependencies or paste a timestamped script.'));
    }

    const modelKey = options.model || 'fast';
    const modelFolder = modelKey === 'best' ? 'small' : 'base';
    const language = options.language || 'auto';

    const args = [
      SCRIPT_PATH,
      '--audio', audioPath,
      '--model', modelFolder,
      '--models-dir', path.join(PROJECT_ROOT, 'models'),
      '--language', language
    ];

    const proc = spawn(py, args, { cwd: PROJECT_ROOT });
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let finalResult = null;

    proc.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // keep partial

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'progress' && onProgress) {
            onProgress(msg);
          } else if (msg.type === 'done') {
            finalResult = msg;
          } else if (msg.type === 'error') {
            reject(new Error(msg.message || 'Transcription failed'));
          }
        } catch {}
      }
    });

    proc.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    proc.on('close', (code) => {
      if (stdoutBuffer.trim().startsWith('{')) {
        try {
          const msg = JSON.parse(stdoutBuffer.trim());
          if (msg.type === 'done') finalResult = msg;
        } catch {}
      }

      if (code === 0 && finalResult) {
        resolve(finalResult);
      } else {
        const errMsg = finalResult?.message || stderrBuffer.trim() || `Transcription process exited with code ${code}`;
        reject(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start transcription process: ${err.message}`));
    });
  });
}

module.exports = {
  findPython,
  checkWhisperEnv,
  transcribeAudio
};
