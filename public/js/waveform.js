/**
 * waveform.js — Professional Audio & Clip Timeline Visualizer
 */

import { formatTime } from './parser.js';

/**
 * Render studio-quality audio waveform onto a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {File|null} audioFile
 * @param {number} totalDuration
 */
export async function renderWaveform(canvas, audioFile, totalDuration = 0) {
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight || 64;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);

  if (!audioFile) {
    // Draw sleek empty state
    ctx.strokeStyle = '#202B36';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.fillStyle = '#8A99A8';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Voiceover audio track · Add voiceover above to view waveform', width / 2, height / 2);
    return;
  }

  try {
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = decoded.getChannelData(0);

    // Number of bars
    const barWidth = 2;
    const barGap = 1.5;
    const step = barWidth + barGap;
    const totalBars = Math.floor(width / step);
    const samplesPerBar = Math.floor(channelData.length / totalBars);

    // Create Cinema Teal gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#5EEAD4');
    gradient.addColorStop(0.5, '#14B8A6');
    gradient.addColorStop(1, '#0D9488');

    ctx.fillStyle = gradient;

    const centerY = height / 2;
    const maxAmplitude = height * 0.44;

    for (let i = 0; i < totalBars; i++) {
      let sum = 0;
      const offset = i * samplesPerBar;
      for (let j = 0; j < samplesPerBar; j += 4) {
        sum += Math.abs(channelData[offset + j] || 0);
      }
      const avg = sum / (samplesPerBar / 4);
      // Smooth scaling
      const barHeight = Math.max(2, Math.min(maxAmplitude, avg * maxAmplitude * 3.5));

      const x = i * step;
      const y = centerY - barHeight;
      const h = barHeight * 2;

      // Draw rounded bar
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, h, 1);
      ctx.fill();
    }
    audioCtx.close();
  } catch (err) {
    console.warn('Could not decode audio for waveform:', err);
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, height / 2 - 1, width, 2);
  }
}

/**
 * Render clip timeline track and time markers.
 * @param {HTMLElement} container
 * @param {Array} clips
 * @param {number} totalDuration
 * @param {Function} onSelectClip
 */
export function renderClipRuler(container, clips, totalDuration, onSelectClip) {
  if (!container) return;
  container.innerHTML = '';

  if (!clips || !clips.length || totalDuration <= 0) {
    return;
  }

  // 1. Timecode markers row
  const timeMarkers = document.createElement('div');
  timeMarkers.className = 'timeline-timecodes';
  const markCount = 5;
  for (let i = 0; i < markCount; i++) {
    const pct = (i / (markCount - 1)) * 100;
    const t = (i / (markCount - 1)) * totalDuration;
    const mark = document.createElement('span');
    mark.className = 'time-mark';
    if (i === 0) {
      mark.style.left = '0px';
      mark.style.transform = 'none';
    } else if (i === markCount - 1) {
      mark.style.right = '0px';
      mark.style.left = 'auto';
      mark.style.transform = 'none';
    } else {
      mark.style.left = `${pct}%`;
      mark.style.transform = 'translateX(-50%)';
    }
    mark.textContent = formatTime(t);
    timeMarkers.appendChild(mark);
  }
  container.appendChild(timeMarkers);

  // 2. Clip track container
  const track = document.createElement('div');
  track.className = 'clip-track';

  for (const clip of clips) {
    const leftPct = (clip.startSec / totalDuration) * 100;
    const widthPct = Math.max(0.2, (clip.durationSec / totalDuration) * 100);

    const block = document.createElement('div');
    block.className = `clip-item clip-item-${clip.type || 'image'}`;
    block.style.left = `${leftPct}%`;
    block.style.width = `${widthPct}%`;

    // Only show label if width allows
    const label = document.createElement('span');
    label.className = 'clip-item-label';
    label.textContent = `#${clip.index} ${clip.name}`;
    block.appendChild(label);

    // Tooltip
    block.title = `#${clip.index}: ${clip.name}\n${formatTime(clip.startSec)} → ${formatTime(clip.endSec)} (${clip.durationSec.toFixed(1)}s)`;

    block.onclick = () => {
      if (onSelectClip) onSelectClip(clip);
    };

    track.appendChild(block);
  }

  container.appendChild(track);
}
