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
    throw new Error('Could not load in-browser AI engine. Please check internet connection.');
  }
}

export async function checkDeviceSupport() {
  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
  return {
    webgpu: hasWebGPU,
    recommendedDevice: hasWebGPU ? 'webgpu' : 'wasm',
    dtype: hasWebGPU ? 'fp16' : 'q8'
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

  const transcriber = await pipeline('automatic-speech-recognition', modelId, {
    device: recommendedDevice,
    dtype: dtype,
    progress_callback: (p) => {
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
    }
  });

  activePipeline = transcriber;
  activeModelKey = modelKey;
  return transcriber;
}

export async function decodeAudioToMono(fileOrBlob) {
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass({ sampleRate: 16000 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  if (numChannels === 1) {
    mono.set(audioBuffer.getChannelData(0));
  } else {
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < length; i++) {
      mono[i] = (ch0[i] + ch1[i]) / 2;
    }
  }

  await audioCtx.close();
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

  const result = await transcriber(audioData, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    language: language,
    task: 'transcribe'
  });

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
      const text = chunk.text;
      if (!text || !text.trim()) continue;
      const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] : 0;
      const end = Array.isArray(chunk.timestamp) ? (chunk.timestamp[1] !== null ? chunk.timestamp[1] : (start + 0.35)) : start + 0.35;
      words.push({
        word: chunk.text,
        start: Math.round(start * 100) / 100,
        end: Math.round(end * 100) / 100,
        probability: 0.95
      });
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
