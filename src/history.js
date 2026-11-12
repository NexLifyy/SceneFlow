/**
 * history.js — Persist export history to a local JSON file.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const isVercel = Boolean(process.env.VERCEL);
const HISTORY_FILE = isVercel
  ? path.join(os.tmpdir(), 'sceneflow_history.json')
  : path.join(__dirname, '..', 'data', 'history.json');

function ensureDir() {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function load() {
  try {
    ensureDir();
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

function add(entry) {
  ensureDir();
  const history = load();
  history.unshift({ ...entry, id: Date.now() });
  // Keep last 50 entries
  if (history.length > 50) history.length = 50;
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  return history;
}

function clear() {
  ensureDir();
  fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');
  return [];
}

module.exports = { load, add, clear };
