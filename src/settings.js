/**
 * settings.js — Persist user settings to a local JSON file.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const isVercel = Boolean(process.env.VERCEL);
const SETTINGS_FILE = isVercel
  ? path.join(os.tmpdir(), 'sceneflow_settings.json')
  : path.join(__dirname, '..', 'data', 'settings.json');

const DEFAULTS = {
  videoSize: '1080p',
  quality: 'youtube',
  fps: 30,
  fitMode: 'fit',
  imageMotion: 'auto',
  motionEffects: { zoomIn: true, zoomOut: true, panLeft: true, panRight: true },
  motionSpeed: 'medium',
  transitions: { enabled: false, types: { fade: true, dissolve: false, slide: false, wipe: false, zoom: false } },
  transitionSounds: false,
  transitionSoundsVolume: 0.5,
  gapMode: 'extend',
  musicVolume: 0.3,
  captionStyle: 'none',
  captionColor: '#FFFFFF',
  captionHighlight: '#FACC15',
  captionFont: 'Poppins',
  wordsPerLine: 'all',
  captionPosition: { x: 50, y: 85 },
  captionSize: 48,
  captionLanguage: 'auto',
  voiceoverMode: 'cut',
  saveFolder: isVercel ? '' : (process.platform === 'win32' ? 'C:\\' : ''),
  lastFolder: '',
};

function ensureDir() {
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function load() {
  try {
    ensureDir();
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('Could not load settings:', e.message);
  }
  return { ...DEFAULTS };
}

function save(settings) {
  ensureDir();
  const merged = { ...load(), ...settings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { load, save, DEFAULTS };
