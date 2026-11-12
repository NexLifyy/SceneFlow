/**
 * parser.js (browser) — identical logic to server-side src/parser.js
 * but as an ES module for the frontend.
 */

const DASH = '(?:\u2014|\u2013|-)';
const PART = '(\\d+)_(\\d+)(?:_(\\d+))?';
const TIME_RE = new RegExp(`^${PART}${DASH}${PART}`, 'u');

export function parseFilename(name) {
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
  if (endSec < startSec) return null;
  return { startSec, endSec };
}

export function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
