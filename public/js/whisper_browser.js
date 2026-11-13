/**
 * whisper_browser.js — In-browser client-side Whisper AI (WebGPU / WASM)
 * Powered by Hugging Face Transformers.js v3.
 *
 * Downloads models ONCE into the user's browser cache (CacheStorage).
 * Runs 100% locally on the user's device (no server audio uploads needed).
 */

let transformersModule = null;

async function getTransformers() {
  if (transformersModule) return transformersModule;
  try {
    transformersModule = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3');
    // Ensure browser caching is active
    if (transformersModule.env) {
      transformersModule.env.allowLocalModels = false;
      transformersModule.env.useBrowserCache = true;
    }
    return transformersModule;
  } catch (err) {
    console.error('Failed to load Transformers.js from CDN:', err);
    throw new Error('Could not load in-browser AI engine. Please check your internet connection.');
  }
}

export async function checkDeviceSupport() {
  let hasWebGPU = false;
  let hasFp16 = false;
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        hasWebGPU = true;
        hasFp16 = Boolean(adapter.features && adapter.features.has('shader-f16'));
      }
    } catch {}
  }
  return {
    webgpu: hasWebGPU,
    recommendedDevice: hasWebGPU ? 'webgpu' : 'wasm',
    dtype: hasWebGPU ? (hasFp16 ? 'fp16' : 'q4') : 'q8'
  };
}

export async function checkClientModelCached(modelKey) {
  const modelId = modelKey === 'best' ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base';
  if (typeof window === 'undefined' || !('caches' in window)) return false;
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      if (name.includes('transformers') || name.includes('huggingface')) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        if (requests.some(req => req.url.includes(modelId) || req.url.includes(encodeURIComponent(modelId)))) {
          return true;
        }
      }
    }
  } catch {}
  return false;
}

let activePipeline = null;
let activeModelKey = null;

export function formatModelLoadProgress({
  modelKey = 'fast',
  status = '',
  isCached = false,
  loadedBytes = 0,
  totalBytes = 0,
  progressPercent = 0
} = {}) {
  const modelLabel = modelKey === 'best' ? 'Best' : 'Fast';
  const approxMb = modelKey === 'best' ? 470 : 145;
  const loadedMbNum = loadedBytes / (1024 * 1024);
  const loadedMb = loadedMbNum.toFixed(1);
  const isDownloading = !isCached && status === 'progress' && totalBytes > 0 && parseFloat(loadedMb) > 0;

  if (isDownloading) {
    const totalMb = Math.max(approxMb, Math.round(totalBytes / (1024 * 1024)));
    const pct = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
    return {
      isDownloading: true,
      percent: pct,
      mbDownloaded: loadedMb,
      mbTotal: totalMb,
      text: `Downloading ${modelLabel} AI model: ${loadedMb} / ${totalMb} MB (${pct}%)`
    };
  }

  return {
    isDownloading: false,
    percent: Math.min(100, Math.max(0, Math.round(progressPercent || 0))),
    mbDownloaded: null,
    mbTotal: null,
    text: `Preparing ${modelLabel} AI model...`
  };
}

export async function loadWhisperModel(modelKey = 'fast', onProgress = null) {
  if (activePipeline && activeModelKey === modelKey) {
    return activePipeline;
  }

  const isCached = await checkClientModelCached(modelKey);
  const { pipeline } = await getTransformers();
  const modelId = modelKey === 'best' ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base';
  const { recommendedDevice, dtype } = await checkDeviceSupport();

  const fileProgressMap = new Map();
  const progressCallback = (p) => {
    if (!p) return;
    if (p.file) {
      const prev = fileProgressMap.get(p.file) || { loaded: 0, total: 0, progress: 0 };
      fileProgressMap.set(p.file, {
        loaded: typeof p.loaded === 'number' ? p.loaded : prev.loaded,
        total: typeof p.total === 'number' ? Math.max(p.total, prev.total) : prev.total,
        progress: typeof p.progress === 'number' ? p.progress : prev.progress
      });
    }

    if (onProgress) {
      let totalLoaded = 0;
      let totalExpected = 0;
      for (const item of fileProgressMap.values()) {
        totalLoaded += item.loaded;
        totalExpected += Math.max(item.total, item.loaded);
      }

      const formatted = formatModelLoadProgress({
        modelKey,
        status: p.status,
        isCached,
        loadedBytes: totalLoaded,
        totalBytes: totalExpected,
        progressPercent: p.progress || 0
      });

      onProgress({
        status: p.status,
        isCached,
        isDownloading: formatted.isDownloading,
        file: p.file || '',
        percent: formatted.percent,
        mbDownloaded: formatted.mbDownloaded,
        mbTotal: formatted.mbTotal,
        text: formatted.text
      });
    }
  };

  let transcriber;
  if (recommendedDevice === 'webgpu') {
    try {
      transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device: 'webgpu',
        dtype: dtype,
        progress_callback: progressCallback
      });
    } catch (gpuErr) {
      console.warn('WebGPU pipeline failed, falling back to WASM engine:', gpuErr);
      if (onProgress) {
        onProgress({
          status: 'fallback',
          isDownloading: false,
          percent: 25,
          text: 'Falling back to standard CPU engine...'
        });
      }
      transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: progressCallback
      });
    }
  } else {
    transcriber = await pipeline('automatic-speech-recognition', modelId, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: progressCallback
    });
  }

  activePipeline = transcriber;
  activeModelKey = modelKey;
  return transcriber;
}

export async function decodeAudioToMono(fileOrBlob) {
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioCtx;
  let audioBuffer;

  // Try creating with 16000Hz first, or fallback to default audioCtx
  try {
    audioCtx = new AudioContextClass({ sampleRate: 16000 });
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    if (audioCtx) { try { await audioCtx.close(); } catch {} }
    audioCtx = new AudioContextClass();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  }

  // Ensure resampled to 16000Hz mono Float32Array
  if (audioBuffer.sampleRate !== 16000 || audioBuffer.numberOfChannels > 1) {
    const OfflineCtxClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineCtxClass) {
      const offlineCtx = new OfflineCtxClass(
        1,
        Math.ceil(audioBuffer.duration * 16000),
        16000
      );
      const bufferSource = offlineCtx.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(offlineCtx.destination);
      bufferSource.start(0);
      audioBuffer = await offlineCtx.startRendering();
    }
  }

  const mono = audioBuffer.getChannelData(0);
  if (audioCtx) { try { await audioCtx.close(); } catch {} }

  return {
    audioData: mono,
    duration: audioBuffer.duration
  };
}

/**
 * Transcribe an audio file client-side in the user's browser.
 */
export async function transcribeInBrowser(audioFile, options = {}, onProgress = null) {
  const modelKey = options.model || 'fast';
  const language = options.language && options.language !== 'auto' ? options.language : null;

  if (onProgress) {
    onProgress({
      type: 'progress',
      status: 'decoding',
      percent: 5,
      processedSec: 0,
      totalSec: 0,
      text: 'Decoding audio on your device...'
    });
  }

  const { audioData, duration } = await decodeAudioToMono(audioFile);

  if (onProgress) {
    onProgress({
      type: 'progress',
      status: 'loading_model',
      percent: 15,
      processedSec: 0,
      totalSec: Math.round(duration),
      text: 'Initializing SceneFlow AI engine...'
    });
  }

  const modelLabel = modelKey === 'best' ? 'Best' : 'Fast';
  const transcriber = await loadWhisperModel(modelKey, (dl) => {
    if (onProgress) {
      if (dl.isDownloading) {
        onProgress({
          type: 'download',
          isDownloading: true,
          percent: dl.percent,
          loadedMb: dl.mbDownloaded,
          totalMb: dl.mbTotal,
          file: dl.file,
          text: dl.text
        });
      } else {
        onProgress({
          type: 'preparing',
          isDownloading: false,
          percent: dl.isCached ? 22 : 18,
          file: dl.file,
          text: `Preparing ${modelLabel} AI model...`
        });
      }
    }
  });

  if (onProgress) {
    onProgress({
      type: 'progress',
      status: 'transcribing',
      percent: 30,
      processedSec: Math.round(duration * 0.3),
      totalSec: Math.round(duration),
      text: 'Transcribing voiceover audio...'
    });
  }

  let result;
  try {
    result = await transcriber(audioData, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      language: language,
      task: 'transcribe'
    });
  } catch (inferErr) {
    console.warn('Primary transcription failed, retrying on standard WASM engine:', inferErr);
    if (onProgress) {
      onProgress({
        type: 'progress',
        status: 'transcribing_fallback',
        percent: 35,
        processedSec: 0,
        totalSec: Math.round(duration),
        text: 'Retrying on standard CPU engine...'
      });
    }

    try {
      const { pipeline } = await getTransformers();
      const modelId = modelKey === 'best' ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base';
      const wasmTranscriber = await pipeline('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: 'q8'
      });
      activePipeline = wasmTranscriber;
      result = await wasmTranscriber(audioData, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        language: language,
        task: 'transcribe'
      });
    } catch (retryErr) {
      // If word-level timestamps failed, retry once with basic timestamps
      console.warn('Word-timestamp inference failed, falling back to segment timestamps:', retryErr);
      const fallbackTranscriber = activePipeline || transcriber;
      result = await fallbackTranscriber(audioData, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: language,
        task: 'transcribe'
      });
    }
  }

  if (onProgress) {
    onProgress({
      type: 'progress',
      status: 'finishing',
      percent: 95,
      processedSec: Math.round(duration),
      totalSec: Math.round(duration),
      text: 'Formatting word timestamps and sentences...'
    });
  }

  // Extract word-level timestamps
  const words = [];
  if (result.chunks && Array.isArray(result.chunks)) {
    for (const chunk of result.chunks) {
      const text = (chunk.text || '').trim();
      if (!text) continue;
      const start = Array.isArray(chunk.timestamp) ? (chunk.timestamp[0] ?? 0) : 0;
      const end = Array.isArray(chunk.timestamp)
        ? (chunk.timestamp[1] !== null && chunk.timestamp[1] !== undefined ? chunk.timestamp[1] : (start + 0.35))
        : (start + 0.35);
      const chunkDur = Math.max(0.1, end - start);

      if (chunk.words && Array.isArray(chunk.words) && chunk.words.length > 0) {
        for (const w of chunk.words) {
          const wText = (w.word || w.text || '').trim();
          if (!wText) continue;
          const wStart = Array.isArray(w.timestamp) ? (w.timestamp[0] ?? start) : start;
          const wEnd = Array.isArray(w.timestamp) ? (w.timestamp[1] ?? (wStart + 0.3)) : (wStart + 0.3);
          words.push({
            word: wText,
            start: Math.round(wStart * 100) / 100,
            end: Math.round(wEnd * 100) / 100,
            probability: 0.95
          });
        }
      } else {
        const rawTokens = text.split(/\s+/).filter(Boolean);
        if (rawTokens.length <= 1) {
          words.push({
            word: text,
            start: Math.round(start * 100) / 100,
            end: Math.round(end * 100) / 100,
            probability: 0.95
          });
        } else {
          const durPerWord = chunkDur / rawTokens.length;
          rawTokens.forEach((rw, idx) => {
            const wStart = start + idx * durPerWord;
            const wEnd = start + (idx + 1) * durPerWord;
            words.push({
              word: rw,
              start: Math.round(wStart * 100) / 100,
              end: Math.round(wEnd * 100) / 100,
              probability: 0.95
            });
          });
        }
      }
    }
  }

  // Fallback: If word chunks aren't returned, split transcript text evenly
  if (words.length === 0 && result.text) {
    const rawWords = result.text.trim().split(/\s+/).filter(Boolean);
    const durPerWord = duration / Math.max(1, rawWords.length);
    rawWords.forEach((w, i) => {
      words.push({
        word: (i > 0 ? ' ' : '') + w,
        start: Math.round(i * durPerWord * 100) / 100,
        end: Math.round((i + 1) * durPerWord * 100) / 100,
        probability: 0.9
      });
    });
  }

  return {
    ok: true,
    words,
    duration: Math.round(duration * 100) / 100,
    text: result.text
  };
}
