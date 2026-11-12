'use strict';

/**
 * whisper_models.js — Model storage, verification, and downloader
 * Handles downloading faster-whisper models (base & small) from Hugging Face with:
 *   - Live progress (MB downloaded, percent, speed)
 *   - Safe atomic downloads (.tmp folder cleanup on cancel/error)
 *   - Offline verification
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const MODELS_DIR = path.join(__dirname, '..', 'models');
if (!fs.existsSync(MODELS_DIR)) {
  try { fs.mkdirSync(MODELS_DIR, { recursive: true }); } catch {}
}

const MODEL_CONFIGS = {
  fast: {
    key: 'fast',
    realName: 'sceneflow-timing-fast',
    label: 'Fast',
    description: 'Fast AI timing model (about 145 MB). Fast, good for clear voiceovers.',
    folder: 'base',
    approxMb: 145,
    minExpectedBinSize: 100 * 1024 * 1024,
    repo: 'Systran/faster-whisper-base',
    files: ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']
  },
  best: {
    key: 'best',
    realName: 'sceneflow-timing-best',
    label: 'Best',
    description: 'Best AI timing model (about 470 MB). Slower, more accurate, better with accents and noise.',
    folder: 'small',
    approxMb: 470,
    minExpectedBinSize: 350 * 1024 * 1024,
    repo: 'Systran/faster-whisper-small',
    files: ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']
  }
};

/**
 * Check if a model is fully downloaded and valid on disk
 */
function getModelStatus(modelKey) {
  const cfg = MODEL_CONFIGS[modelKey];
  if (!cfg) return { downloaded: false, error: 'Unknown model' };

  const targetDir = path.join(MODELS_DIR, cfg.folder);
  if (!fs.existsSync(targetDir)) {
    return {
      key: cfg.key,
      label: cfg.label,
      realName: cfg.realName,
      description: cfg.description,
      approxMb: cfg.approxMb,
      downloaded: false,
      folder: targetDir
    };
  }

  // Check required files
  for (const f of cfg.files) {
    const fPath = path.join(targetDir, f);
    if (!fs.existsSync(fPath)) {
      return {
        key: cfg.key,
        label: cfg.label,
        realName: cfg.realName,
        description: cfg.description,
        approxMb: cfg.approxMb,
        downloaded: false,
        error: `Missing ${f}`,
        folder: targetDir
      };
    }
  }

  // Check model.bin size to ensure no corrupted partial download
  const binStat = fs.statSync(path.join(targetDir, 'model.bin'));
  if (binStat.size < cfg.minExpectedBinSize) {
    return {
      key: cfg.key,
      label: cfg.label,
      realName: cfg.realName,
      description: cfg.description,
      approxMb: cfg.approxMb,
      downloaded: false,
      corrupted: true,
      error: 'Model binary appears incomplete or corrupted. Please re-download.',
      folder: targetDir
    };
  }

  return {
    key: cfg.key,
    label: cfg.label,
    realName: cfg.realName,
    description: cfg.description,
    approxMb: cfg.approxMb,
    downloaded: true,
    folder: targetDir,
    sizeMb: Math.round(binStat.size / (1024 * 1024))
  };
}

/**
 * Get status of both models
 */
function getAllModelsStatus() {
  return {
    fast: getModelStatus('fast'),
    best: getModelStatus('best'),
    modelsDir: MODELS_DIR
  };
}

// Active downloads map: modelKey -> { cancel: Function }
const activeDownloads = new Map();

/**
 * Download a file with HTTP redirects
 */
function downloadFileWithRedirects(url, destPath, onProgress, cancelRef) {
  return new Promise((resolve, reject) => {
    function get(currentUrl, redirectCount = 0) {
      if (redirectCount > 10) {
        return reject(new Error('Too many HTTP redirects'));
      }
      if (cancelRef.cancelled) {
        return reject(new Error('Download cancelled by user'));
      }

      const client = currentUrl.startsWith('https') ? https : http;
      const req = client.get(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SceneFlow/3.2'
        }
      }, (res) => {
        if (cancelRef.cancelled) {
          res.resume();
          return reject(new Error('Download cancelled by user'));
        }

        // Follow redirects (301, 302, 303, 307, 308)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          let nextUrl = res.headers.location;
          if (!nextUrl.startsWith('http')) {
            const parsed = new URL(currentUrl);
            nextUrl = new URL(nextUrl, parsed.origin).href;
          }
          return get(nextUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Server returned HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        cancelRef.cancel = () => {
          cancelRef.cancelled = true;
          req.destroy();
          fileStream.close();
          try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
          reject(new Error('Download cancelled by user'));
        };

        res.on('data', (chunk) => {
          if (cancelRef.cancelled) return;
          downloadedBytes += chunk.length;
          fileStream.write(chunk);
          if (onProgress) {
            onProgress(downloadedBytes, totalBytes);
          }
        });

        res.on('end', () => {
          fileStream.end(() => {
            if (cancelRef.cancelled) {
              try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
              reject(new Error('Download cancelled by user'));
            } else {
              resolve();
            }
          });
        });

        res.on('error', (err) => {
          fileStream.close();
          try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
          reject(err);
        });
      });

      req.on('error', (err) => {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    }

    get(url);
  });
}

/**
 * Download a faster-whisper model from Hugging Face
 */
async function downloadModel(modelKey, onProgress = null) {
  const cfg = MODEL_CONFIGS[modelKey];
  if (!cfg) throw new Error(`Unknown model key: ${modelKey}`);

  if (activeDownloads.has(modelKey)) {
    throw new Error(`Download for '${modelKey}' is already in progress.`);
  }

  const targetDir = path.join(MODELS_DIR, cfg.folder);
  const tempDir = path.join(MODELS_DIR, `.downloading_${cfg.folder}_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const cancelRef = { cancelled: false, cancel: null };
  activeDownloads.set(modelKey, cancelRef);

  const baseUrl = `https://huggingface.co/${cfg.repo}/resolve/main/`;
  const startTime = Date.now();

  try {
    // Total sizes approx
    const totalExpectedBytes = cfg.approxMb * 1024 * 1024;
    let overallDownloaded = 0;

    for (let i = 0; i < cfg.files.length; i++) {
      const fileName = cfg.files[i];
      const fileUrl = `${baseUrl}${fileName}`;
      const destPath = path.join(tempDir, fileName);

      let prevFileDownloaded = 0;
      await downloadFileWithRedirects(fileUrl, destPath, (chunkBytes, fileTotal) => {
        const delta = chunkBytes - prevFileDownloaded;
        prevFileDownloaded = chunkBytes;
        overallDownloaded += delta;

        if (onProgress) {
          const elapsedSec = (Date.now() - startTime) / 1000;
          const speedBps = elapsedSec > 0 ? (overallDownloaded / elapsedSec) : 0;
          const percent = Math.min(100, Math.round((overallDownloaded / totalExpectedBytes) * 100));
          const mbDownloaded = (overallDownloaded / (1024 * 1024)).toFixed(1);
          const mbTotal = cfg.approxMb;
          const remainingBytes = Math.max(0, totalExpectedBytes - overallDownloaded);
          const etaSec = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;

          onProgress({
            model: modelKey,
            file: fileName,
            fileIndex: i + 1,
            totalFiles: cfg.files.length,
            percent,
            mbDownloaded: parseFloat(mbDownloaded),
            mbTotal,
            speedMb: (speedBps / (1024 * 1024)).toFixed(1),
            etaSec
          });
        }
      }, cancelRef);
    }

    // Verify model.bin size before finalizing
    const downloadedBin = path.join(tempDir, 'model.bin');
    const stat = fs.statSync(downloadedBin);
    if (stat.size < cfg.minExpectedBinSize) {
      throw new Error(`Download incomplete: expected at least ${Math.round(cfg.minExpectedBinSize / 1024 / 1024)}MB but got ${Math.round(stat.size / 1024 / 1024)}MB.`);
    }

    // Atomic swap: remove old targetDir if exists, then rename tempDir
    if (fs.existsSync(targetDir)) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    }
    fs.renameSync(tempDir, targetDir);

    activeDownloads.delete(modelKey);
    return getModelStatus(modelKey);

  } catch (err) {
    activeDownloads.delete(modelKey);
    // Safe cleanup of temporary folder so no partial files remain
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
    throw err;
  }
}

/**
 * Cancel an active download
 */
function cancelModelDownload(modelKey) {
  const download = activeDownloads.get(modelKey);
  if (download && download.cancel) {
    download.cancel();
    activeDownloads.delete(modelKey);
    return true;
  }
  return false;
}

module.exports = {
  MODELS_DIR,
  MODEL_CONFIGS,
  getModelStatus,
  getAllModelsStatus,
  downloadModel,
  cancelModelDownload
};
