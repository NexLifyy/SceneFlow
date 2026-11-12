/**
 * encoder.js — Probe available GPU encoders, return best available.
 */

'use strict';

const { execSync } = require('child_process');

let _cachedEncoder = null;

function getFfmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

/**
 * Returns the best available H.264 encoder.
 * Tries: h264_nvenc (NVIDIA), h264_videotoolbox (macOS), libx264 (fallback)
 */
function probeEncoder() {
  if (_cachedEncoder) return _cachedEncoder;

  const ffmpeg = getFfmpegPath();
  const candidates = [
    { name: 'h264_nvenc',        label: 'NVIDIA GPU (NVENC)' },
    { name: 'h264_videotoolbox', label: 'Apple GPU (VideoToolbox)' },
    { name: 'libx264',           label: 'CPU (libx264)' },
  ];

  for (const enc of candidates) {
    try {
      // Quick test: encode 1 frame to null
      execSync(
        `"${ffmpeg}" -f lavfi -i color=black:s=64x64:r=1 -t 0.1 -c:v ${enc.name} -f null -`,
        { stdio: 'pipe', timeout: 8000 }
      );
      _cachedEncoder = { encoder: enc.name, label: enc.label };
      return _cachedEncoder;
    } catch {
      // Not available, try next
    }
  }

  _cachedEncoder = { encoder: 'libx264', label: 'CPU (libx264)' };
  return _cachedEncoder;
}

module.exports = { probeEncoder, getFfmpegPath };
