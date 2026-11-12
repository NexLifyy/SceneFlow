/**
 * parser.js — Filename → clip time parser
 * Supports:
 *   0_30—0_33.png        → start=30s, end=33s
 *   1_02—1_05.png        → start=62s, end=65s
 *   1_02_30—1_02_33.png  → start=3750s, end=3753s (H_MM_SS)
 * Accepts em dash (—), en dash (–), or hyphen (-) as separator.
 */

'use strict';

// Regex: optional H_MM_SS or MM_SS on each side of a dash separator
const DASH = '(?:—|–|-)';
const PART = '(\\d+)_(\\d+)(?:_(\\d+))?';
const TIME_RE = new RegExp(`^${PART}${DASH}${PART}`, 'u');

/**
 * Parse a single filename into { startSec, endSec } or null.
 * @param {string} name - basename (with or without extension)
 */
function parseFilename(name) {
  // Strip extension
  const base = name.replace(/\.[^.]+$/, '');
  const m = TIME_RE.exec(base);
  if (!m) return null;

  const [, a1, a2, a3, b1, b2, b3] = m;

  const startSec = a3 !== undefined
    ? parseInt(a1) * 3600 + parseInt(a2) * 60 + parseInt(a3)
    : parseInt(a1) * 60 + parseInt(a2);

  const endSec = b3 !== undefined
    ? parseInt(b1) * 3600 + parseInt(b2) * 60 + parseInt(b3)
    : parseInt(b1) * 60 + parseInt(b2);

  if (endSec < startSec) return null; // malformed

  return { startSec, endSec };
}

/**
 * Format seconds to M:SS or H:MM:SS
 */
function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Build a sorted timeline from a list of file objects.
 * Each file: { name, path, type }   type = 'image' | 'video'
 *
 * Returns array of clip objects:
 * { index, name, path, type, startSec, endSec, durationSec, timed, motion }
 *
 * Options:
 *   gapMode: 'extend' | 'black'
 */
function buildTimeline(files, options = {}) {
  const { gapMode = 'extend' } = options;

  const timed = [];
  const untimed = [];

  for (const file of files) {
    const parsed = parseFilename(file.name);
    if (parsed) {
      timed.push({ ...file, ...parsed, timed: true });
    } else {
      untimed.push({ ...file, timed: false });
    }
  }

  // Sort timed by start
  timed.sort((a, b) => a.startSec - b.startSec);

  // Fix overlaps: trim earlier clip's end to next clip's start
  for (let i = 0; i < timed.length - 1; i++) {
    if (timed[i].endSec > timed[i + 1].startSec) {
      timed[i].endSec = timed[i + 1].startSec;
    }
  }

  // Handle gaps between timed clips
  const resolved = [];
  for (let i = 0; i < timed.length; i++) {
    const clip = timed[i];
    const prev = resolved[resolved.length - 1];

    if (prev && prev.endSec < clip.startSec) {
      // There is a gap
      if (gapMode === 'extend' && prev) {
        // Extend previous clip to fill the gap
        prev.endSec = clip.startSec;
        prev.durationSec = prev.endSec - prev.startSec;
      } else {
        // Insert a black gap clip
        resolved.push({
          name: `[gap ${formatTime(prev.endSec)}–${formatTime(clip.startSec)}]`,
          path: null,
          type: 'gap',
          startSec: prev.endSec,
          endSec: clip.startSec,
          durationSec: clip.startSec - prev.endSec,
          timed: true,
          motion: 'none',
        });
      }
    }

    clip.durationSec = clip.endSec - clip.startSec;
    resolved.push(clip);
  }

  // Append untimed clips, 3 seconds each, after last timed clip
  let cursor = resolved.length > 0 ? resolved[resolved.length - 1].endSec : 0;
  for (const file of untimed) {
    file.startSec = cursor;
    file.endSec = cursor + 3;
    file.durationSec = 3;
    cursor += 3;
    resolved.push(file);
  }

  // Assign index and default motion
  resolved.forEach((clip, i) => {
    clip.index = i + 1;
    if (!clip.motion) clip.motion = 'auto';
  });

  return resolved;
}

module.exports = { parseFilename, buildTimeline, formatTime };
