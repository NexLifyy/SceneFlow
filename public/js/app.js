/**
 * app.js — Main controller for SceneFlow Studio
 */

import { formatTime } from './parser.js';
import { renderWaveform, renderClipRuler } from './waveform.js';
import { icons } from './icons.js';
import { initTimingUI } from './timing_ui.js';
import { initVoiceoverUI } from './voice_ui.js';
import { initPromptsUI } from './prompts_ui.js';
import { initImagesUI } from './images_ui.js';
import { getBlockFilename } from './timing_client.js';

// ── State ────────────────────────────────────────────────────────────────
const state = {
  files: [],           // { name, path, objectUrl, file, type, uploading }
  clips: [],           // built timeline clips
  voiceover: null,     // { file, path, duration, name }
  music: null,         // { file, path, duration, name }
  settings: {},
  captionLines: [],    // [{ startSec, endSec, duration, timeSec, text }]
  captionWords: [],    // [{ word, startSec, endSec, lineIndex, lineStart, lineEnd }]
  captionStyle: 'none',
  captionColor: '#FFFFFF',
  captionHighlight: '#FACC15',
  captionFont: 'Poppins',
  captionSize: 48,
  captionPosition: { x: 50, y: 80 },
  wordsPerLine: 'all',
  previewCurrentTime: 0,
  totalDuration: 0,
  activeJobId: null,
  exportStartTime: null,
};

// ── API helpers ───────────────────────────────────────────────────────────
const api = async (method, path, body) => {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
};

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function getMediaSrc(fileItem) {
  if (!fileItem) return '';
  if (fileItem.objectUrl) return fileItem.objectUrl;
  if (fileItem.path) return `/api/media-preview?path=${encodeURIComponent(fileItem.path)}`;
  return '';
}

function setPreviewFrame(clipOrFile) {
  if (!clipOrFile) {
    const firstImg = state.files.find(f => f.type === 'image') || state.clips.find(c => c.type === 'image');
    if (!firstImg) {
      if ($('preview-placeholder')) $('preview-placeholder').classList.remove('hidden');
      if ($('preview-frame-img')) $('preview-frame-img').classList.add('hidden');
      if ($('preview-clip-tag')) $('preview-clip-tag').classList.add('hidden');
      state.previewCurrentTime = 0;
      updateCaptionPreview(0);
      updatePlayheadVisuals(0);
      return;
    }
    clipOrFile = firstImg;
  }

  const fileItem = state.files.find(f => f.name === clipOrFile.name) || clipOrFile;
  const src = getMediaSrc(fileItem);

  const clipTime = (clipOrFile.startSec !== undefined) ? clipOrFile.startSec : 0;
  state.previewCurrentTime = clipTime;

  if (src && fileItem.type !== 'gap') {
    const imgEl = $('preview-frame-img');
    if (imgEl) {
      imgEl.src = src;
      imgEl.classList.remove('hidden');
    }
    if ($('preview-placeholder')) $('preview-placeholder').classList.add('hidden');
    if ($('preview-clip-tag')) $('preview-clip-tag').classList.add('hidden');

    $$('#timeline-body tr').forEach(row => row.classList.remove('active-preview'));
    if (clipOrFile.index) {
      const activeRow = $(`timeline-row-${clipOrFile.index}`);
      if (activeRow) activeRow.classList.add('active-preview');
    }
  }

  updatePlayheadVisuals(clipTime);
  updateCaptionPreview(clipTime);
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 1 — MEDIA
// ══════════════════════════════════════════════════════════════════════════

$('btn-add-folder').onclick = () => $('input-folder').click();
$('btn-add-files').onclick  = () => $('input-files').click();
$('btn-clear').onclick      = clearMedia;

if ($('btn-add-zip') && $('input-zip')) {
  $('btn-add-zip').onclick = () => $('input-zip').click();
  $('input-zip').onchange = async (e) => {
    const zipFile = e.target.files?.[0];
    if (zipFile) await uploadZipFile(zipFile);
    e.target.value = '';
  };
}

// Legacy optional Folder Scan Modal (kept null-safe when Add Zip replaces it)
if ($('btn-browse-folder') && $('modal-folder-scan')) {
  $('btn-browse-folder').onclick = () => {
    $('modal-folder-scan').classList.remove('hidden');
  };
}
if ($('btn-cancel-scan-modal') && $('modal-folder-scan')) {
  $('btn-cancel-scan-modal').onclick = () => {
    $('modal-folder-scan').classList.add('hidden');
  };
}
if ($('btn-close-scan-modal') && $('modal-folder-scan')) {
  $('btn-close-scan-modal').onclick = () => {
    $('modal-folder-scan').classList.add('hidden');
  };
}

if ($('btn-native-pick-folder')) {
  $('btn-native-pick-folder').onclick = async () => {
    const btn = $('btn-native-pick-folder');
    btn.disabled = true;
    btn.textContent = 'Opening…';
    try {
      const res = await api('POST', '/api/select-folder');
      if (res && res.path && $('scan-folder-path')) {
        $('scan-folder-path').value = res.path;
      }
    } catch (err) {
      console.warn('Native picker error:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Browse…';
    }
  };
}

if ($('btn-confirm-scan-modal')) {
  $('btn-confirm-scan-modal').onclick = async () => {
    const folderPath = $('scan-folder-path')?.value.trim();
    if (!folderPath) {
      alert('Please enter or select a folder path.');
      return;
    }
    $('btn-confirm-scan-modal').textContent = 'Scanning…';
    try {
      const res = await api('POST', '/api/scan-folder', { folderPath });
      if (res.error) {
        alert(`Error: ${res.error}`);
        return;
      }
      if (res.files && res.files.length) {
        for (const file of res.files) {
          if (state.files.some(f => f.name === file.name)) continue;
          state.files.push({
            name: file.name,
            path: file.path,
            objectUrl: null,
            file: null,
            type: file.type,
            uploading: false,
          });
        }
        renderMediaGrid();
        await rebuildTimeline();
        if ($('modal-folder-scan')) $('modal-folder-scan').classList.add('hidden');
      } else {
        alert('No supported image or video files found in that folder.');
      }
    } catch (err) {
      alert(`Failed to scan folder: ${err.message}`);
    } finally {
      $('btn-confirm-scan-modal').textContent = 'Scan & Load';
    }
  };
}

$('input-folder').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('input-files').onchange  = (e) => { addFiles(e.target.files); e.target.value = ''; };

// Drop zone
const dropZone = $('drop-zone');
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
dropZone.addEventListener('click', (e) => {
  if (!state.files.length && !e.target.closest('#media-viewport')) {
    $('input-files').click();
  }
});
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') $('input-files').click();
});

let isUploadingMedia = false;

async function uploadZipFile(zipFile) {
  isUploadingMedia = true;
  const statusEl = $('media-upload-status');
  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = `Extracting ${zipFile.name}...`;
  }

  const formData = new FormData();
  formData.append('zip', zipFile, zipFile.name);

  try {
    const res = await fetch('/api/upload-zip', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.ok && Array.isArray(data.files)) {
      let added = 0;
      for (const zf of data.files) {
        if (state.files.some(f => f.name === zf.name)) continue;
        state.files.push({
          name: zf.name,
          path: zf.path,
          objectUrl: null,
          file: null,
          type: zf.type,
          uploading: false,
        });
        added++;
      }
      renderMediaGrid();
      await rebuildTimeline();
      if (statusEl) {
        statusEl.textContent = added > 0 ? `✓ Extracted ${added} media file(s)` : 'No new media files in zip';
        setTimeout(() => statusEl.classList.add('hidden'), 3000);
      }
    } else if (statusEl) {
      statusEl.textContent = data.error || 'Zip extraction failed';
      setTimeout(() => statusEl.classList.add('hidden'), 4000);
    }
  } catch (err) {
    console.error('Error extracting zip:', err);
    if (statusEl) {
      statusEl.textContent = `Zip error: ${err.message}`;
      setTimeout(() => statusEl.classList.add('hidden'), 4000);
    }
  } finally {
    isUploadingMedia = false;
  }
}

async function addFiles(fileList) {
  const IMAGE_EXT = /\.(png|jpg|jpeg|gif|bmp|webp|tiff?)$/i;
  const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;
  const ZIP_EXT = /\.zip$/i;

  const toUpload = [];
  const zipFiles = [];

  for (const file of fileList) {
    if (ZIP_EXT.test(file.name)) {
      zipFiles.push(file);
      continue;
    }
    if (!IMAGE_EXT.test(file.name) && !VIDEO_EXT.test(file.name)) continue;
    if (state.files.some(f => f.name === file.name)) continue;
    const objectUrl = URL.createObjectURL(file);
    const item = {
      name: file.name,
      path: file.path || null,
      objectUrl,
      file,
      type: VIDEO_EXT.test(file.name) ? 'video' : 'image',
      uploading: !file.path
    };
    state.files.push(item);
    if (!file.path) {
      toUpload.push(file);
    }
  }

  renderMediaGrid();
  await rebuildTimeline();

  for (const zf of zipFiles) {
    await uploadZipFile(zf);
  }

  if (toUpload.length > 0) {
    await uploadMediaFiles(toUpload);
    await rebuildTimeline();
  }
}

async function uploadMediaFiles(files) {
  isUploadingMedia = true;
  const statusEl = $('media-upload-status');
  statusEl.classList.remove('hidden');

  const BATCH = 50;
  let completed = 0;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    statusEl.textContent = `Uploading ${completed + 1}–${Math.min(completed + batch.length, files.length)} of ${files.length}...`;

    const formData = new FormData();
    for (const f of batch) {
      formData.append('media', f, f.name);
    }

    try {
      const res = await fetch('/api/upload-media', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.ok && data.files) {
        for (const uf of data.files) {
          const item = state.files.find(f => f.name === uf.name);
          if (item) {
            item.path = uf.path;
            item.uploading = false;
          }
        }
      }
    } catch (err) {
      console.error('Error uploading media batch:', err);
    }
    completed += batch.length;
  }

  statusEl.textContent = '✓ Media ready';
  setTimeout(() => statusEl.classList.add('hidden'), 3000);
  isUploadingMedia = false;
}

function clearMedia() {
  state.files.forEach(f => { if (f.objectUrl) URL.revokeObjectURL(f.objectUrl); });
  state.files = [];
  state.clips = [];
  state.totalDuration = 0;
  state.previewCurrentTime = 0;

  // Reset Voiceover
  state.voiceover = null;
  if ($('voiceover-name')) $('voiceover-name').textContent = 'No voiceover added';
  if ($('btn-remove-voiceover')) $('btn-remove-voiceover').classList.add('hidden');
  if ($('input-voiceover')) $('input-voiceover').value = '';
  if (typeof timelineAudio !== 'undefined' && timelineAudio) {
    try { timelineAudio.pause(); } catch {}
    timelineAudio = null;
  }

  // Reset Background Music
  state.music = null;
  if ($('music-name')) $('music-name').textContent = 'No music added';
  if ($('btn-remove-music')) $('btn-remove-music').classList.add('hidden');
  if ($('music-vol-row')) $('music-vol-row').style.display = 'none';
  if ($('input-music')) $('input-music').value = '';

  // Reset Captions & Sync warnings
  const capEl = $('caption-text') || $('captions-text');
  if (capEl) capEl.value = '';
  state.captionLines = [];
  state.captionWords = [];
  if ($('caption-word-count')) $('caption-word-count').classList.add('hidden');
  if ($('block-sync-warning')) {
    $('block-sync-warning').classList.add('hidden');
    $('block-sync-warning').innerHTML = '';
  }

  // Clear file inputs & status badges
  if ($('input-folder')) $('input-folder').value = '';
  if ($('input-files')) $('input-files').value = '';
  if ($('input-zip')) $('input-zip').value = '';
  if ($('media-upload-status')) $('media-upload-status').classList.add('hidden');

  renderMediaGrid();
  renderTimeline();
  setPreviewFrame(null);
  updateSizeEstimate();
  checkImageBlockSync();
}

function renderMediaGrid() {
  const viewport = $('media-viewport');
  const grid = $('media-grid');
  const sliderWrap = $('media-slider-wrap');
  const slider = $('media-slider');
  const sliderCount = $('media-slider-count');
  const hintWrap = dropZone.querySelector('.drop-hint-wrap');
  grid.innerHTML = '';
  grid.scrollLeft = 0;

  if (state.files.length === 0) {
    hintWrap.style.display = 'flex';
    if (viewport) viewport.classList.add('hidden');
    if (sliderWrap) sliderWrap.classList.add('hidden');
    return;
  }
  hintWrap.style.display = 'none';
  if (viewport) viewport.classList.remove('hidden');

  for (const f of state.files) {
    const wrap = document.createElement('div');
    wrap.className = 'media-thumb-wrap';

    const src = getMediaSrc(f);

    if (f.type === 'image') {
      const img = document.createElement('img');
      img.className = 'media-thumb';
      img.src = src || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="76" height="76"><rect fill="%23171b26" width="76" height="76"/><text fill="%2364748b" font-size="10" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">IMAGE</text></svg>';
      img.alt = f.name;
      img.title = f.name;
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else {
      const vid = document.createElement('div');
      vid.className = 'media-thumb';
      vid.style.cssText = 'display:flex;align-items:center;justify-content:center;color:var(--text3);';
      vid.innerHTML = icons.video;
      vid.title = f.name;
      const icon = document.createElement('span');
      icon.className = 'thumb-video-icon';
      icon.textContent = 'VIDEO';
      wrap.appendChild(vid);
      wrap.appendChild(icon);
    }

    const rm = document.createElement('button');
    rm.className = 'thumb-remove';
    rm.innerHTML = icons.x;
    rm.title = `Remove ${f.name}`;
    rm.onclick = (e) => {
      e.stopPropagation();
      if (f.objectUrl) URL.revokeObjectURL(f.objectUrl);
      state.files = state.files.filter(x => x !== f);
      renderMediaGrid();
      rebuildTimeline();
    };

    const lbl = document.createElement('div');
    lbl.className = 'thumb-label';
    lbl.textContent = f.name;

    wrap.appendChild(rm);
    wrap.appendChild(lbl);

    wrap.onclick = (e) => {
      e.stopPropagation();
      setPreviewFrame(f);
    };

    grid.appendChild(wrap);
  }

  const showSlider = state.files.length > 8;
  if (sliderWrap) {
    sliderWrap.classList.toggle('hidden', !showSlider);
    sliderWrap.onclick = (e) => e.stopPropagation();
  }
  if (sliderCount) {
    sliderCount.textContent = `${state.files.length} items`;
  }
  if (slider && showSlider) {
    const syncSliderBounds = () => {
      const maxScroll = Math.max(1, grid.scrollWidth - grid.clientWidth);
      slider.min = '0';
      slider.max = String(maxScroll);
      slider.value = String(Math.round(grid.scrollLeft));
    };
    requestAnimationFrame(syncSliderBounds);
    slider.oninput = (e) => {
      e.stopPropagation();
      grid.scrollLeft = Number(e.target.value);
    };
    grid.onscroll = () => {
      slider.value = String(Math.round(grid.scrollLeft));
    };
    grid.onwheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        grid.scrollLeft += e.deltaY;
      }
    };
  } else {
    grid.onscroll = null;
    grid.onwheel = null;
  }
}

// ── Voiceover ─────────────────────────────────────────────────────────────
$('btn-add-voiceover').onclick = () => $('input-voiceover').click();
$('input-voiceover').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('voiceover-name').textContent = `Uploading ${file.name}...`;

  const formData = new FormData();
  formData.append('audio', file, file.name);

  try {
    const res = await fetch('/api/upload-audio', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.ok) {
      state.voiceover = { file, path: data.path, duration: data.duration, name: data.name };
      $('voiceover-name').textContent = `${data.name} (${formatTime(data.duration)})`;
      $('btn-remove-voiceover').classList.remove('hidden');
      const canvas = $('timeline-canvas') || $('waveform-canvas');
      if (canvas) await renderWaveform(canvas, file, state.totalDuration || data.duration);
      initTimelineAudio();
      updateTimeline();
    } else {
      $('voiceover-name').textContent = `Upload failed: ${data.error || 'Unknown error'}`;
    }
  } catch (err) {
    $('voiceover-name').textContent = `Upload failed: ${err.message}`;
  }
};
$('btn-remove-voiceover').onclick = () => {
  state.voiceover = null;
  $('voiceover-name').textContent = 'No voiceover added';
  $('btn-remove-voiceover').classList.add('hidden');
  const canvas = $('timeline-canvas') || $('waveform-canvas');
  if (canvas) renderWaveform(canvas, null, state.totalDuration);
  if (timelineAudio) {
    timelineAudio.pause();
    timelineAudio = null;
  }
  updateTimeline();
};

// ── Background Music ──────────────────────────────────────────────────────
$('btn-add-music').onclick = () => $('input-music').click();
$('input-music').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('music-name').textContent = `Uploading ${file.name}...`;

  const formData = new FormData();
  formData.append('audio', file, file.name);

  try {
    const res = await fetch('/api/upload-audio', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.ok) {
      state.music = { file, path: data.path, duration: data.duration, name: data.name };
      $('music-name').textContent = data.name;
      $('btn-remove-music').classList.remove('hidden');
      $('music-vol-row').style.display = 'flex';
    } else {
      $('music-name').textContent = `Upload failed: ${data.error || 'Unknown error'}`;
    }
  } catch (err) {
    $('music-name').textContent = `Upload failed: ${err.message}`;
  }
};
$('btn-remove-music').onclick = () => {
  state.music = null;
  $('music-name').textContent = 'No music added';
  $('btn-remove-music').classList.add('hidden');
  $('music-vol-row').style.display = 'none';
};
$('music-volume').oninput = (e) => {
  $('music-volume-val').textContent = `${Math.round(e.target.value * 100)}%`;
};

// ══════════════════════════════════════════════════════════════════════════
// SECTION 2 — SETTINGS
// ══════════════════════════════════════════════════════════════════════════

function getSettings() {
  return {
    videoSize:    $('s-video-size').value,
    quality:      $('s-quality').value,
    fps:          parseInt($('s-fps').value),
    fitMode:      $('s-fit-mode').value,
    imageMotion:  $('s-motion').value,
    motionSpeed:  $('s-motion-speed').value,
    gapMode:      $('s-gap-mode').value,
    transitions:  $('s-transitions').value !== 'off',
    musicVolume:  parseFloat($('music-volume').value),
    motionEffects: {
      zoomIn:   $('fx-zoomIn').checked,
      zoomOut:  $('fx-zoomOut').checked,
      panLeft:  $('fx-panLeft').checked,
      panRight: $('fx-panRight').checked,
    },
    transitionTypes: {
      fade:     $('tr-fade').checked,
      dissolve: $('tr-dissolve').checked,
      slide:    $('tr-slide').checked,
      wipe:     $('tr-wipe').checked,
      zoom:     $('tr-zoom').checked,
    },
    transitionSoundsVolume: parseFloat($('s-trans-vol').value),
  };
}

function applySettings(s) {
  if (!s) return;
  const set = (id, val) => { if ($(id) && val !== undefined) $(id).value = val; };
  set('s-video-size',   s.videoSize);
  set('s-quality',      s.quality);
  set('s-fps',          s.fps);
  set('s-fit-mode',     s.fitMode);
  set('s-motion',       s.imageMotion);
  set('s-motion-speed', s.motionSpeed);
  set('s-gap-mode',     s.gapMode);
  set('music-volume',   s.musicVolume);
  if (s.transitions !== undefined) {
    $('s-transitions').value = s.transitions ? 'on' : 'off';
    toggleTransitionTypes(s.transitions);
  }
  if (s.motionEffects) {
    $('fx-zoomIn').checked   = !!s.motionEffects.zoomIn;
    $('fx-zoomOut').checked  = !!s.motionEffects.zoomOut;
    $('fx-panLeft').checked  = !!s.motionEffects.panLeft;
    $('fx-panRight').checked = !!s.motionEffects.panRight;
  }
  if (s.captionStyle) {
    const hasCard = Array.from($$('.template-card')).some(c => c.dataset.style === s.captionStyle);
    selectCaptionStyle(hasCard ? s.captionStyle : 'none');
  } else {
    selectCaptionStyle('none');
  }
  if (s.captionColor) {
    state.captionColor = s.captionColor;
    if ($('s-caption-color')) $('s-caption-color').value = s.captionColor;
    selectCaptionColor(s.captionColor);
  }
  if (s.captionHighlight) {
    state.captionHighlight = s.captionHighlight;
    if ($('s-caption-highlight')) $('s-caption-highlight').value = s.captionHighlight;
  }
  if (s.captionFont) {
    state.captionFont = s.captionFont;
    if ($('s-caption-font')) $('s-caption-font').value = s.captionFont;
  }
  if (s.captionSize && ($('caption-size') || $('s-caption-size'))) {
    ($('caption-size') || $('s-caption-size')).value = s.captionSize;
    updateCaptionSizeLabel();
  }
  state.wordsPerLine = 'all';
  const folderEl = $('export-folder') || $('out-dir');
  if (s.saveFolder && folderEl) folderEl.value = s.saveFolder;
  $('music-volume-val').textContent = `${Math.round(($('music-volume').value) * 100)}%`;
}

function toggleTransitionTypes(show) {
  $('transition-types').classList.toggle('hidden', !show);
}
$('s-transitions').onchange = (e) => toggleTransitionTypes(e.target.value === 'on');

$('btn-save-settings').onclick = async () => {
  const s = {
    ...getSettings(),
    captionStyle: state.captionStyle,
    captionColor: state.captionColor,
    captionHighlight: state.captionHighlight,
    captionFont: state.captionFont,
    captionSize: state.captionSize,
    wordsPerLine: 'all',
  };
  await api('POST', '/api/settings', s);
  $('settings-saved-msg').classList.remove('hidden');
  setTimeout(() => $('settings-saved-msg').classList.add('hidden'), 3000);
};

// Rebuild timeline when gap mode changes
$('s-gap-mode').onchange = () => rebuildTimeline();

// ══════════════════════════════════════════════════════════════════════════
// SECTION 3 — CAPTIONS
// ══════════════════════════════════════════════════════════════════════════

let highlightCustom = false;
const PRESET_HIGHLIGHTS = {
  beast: '#FFFF00',
  hustle: '#22C55E',
  pupcaps: '#FFFF00',
  'bold-highlight': '#FACC15',
  poppin: '#FACC15',
  podcast: '#00E676',
  aarit: '#F97316',
  'gaming-stream': '#00FFFF',
};

// Template cards
$$('.template-card').forEach(card => {
  card.onclick = () => {
    selectCaptionStyle(card.dataset.style);
  };
});

// Font selector
if ($('s-caption-font')) {
  $('s-caption-font').onchange = (e) => {
    state.captionFont = e.target.value || 'Poppins';
    updateCaptionPreview();
  };
}

// Text & Highlight color pickers
if ($('s-caption-color')) {
  $('s-caption-color').oninput = (e) => {
    state.captionColor = e.target.value || '#FFFFFF';
    updateCaptionPreview();
    checkImageBlockSync();
  };
}
if ($('s-caption-highlight')) {
  $('s-caption-highlight').oninput = (e) => {
    highlightCustom = true;
    state.captionHighlight = e.target.value || '#FACC15';
    updateCaptionPreview();
    checkImageBlockSync();
  };
}

function selectCaptionStyle(style) {
  state.captionStyle = style || 'none';

  $$('.template-card').forEach(c => {
    const isAct = c.dataset.style === state.captionStyle;
    c.classList.toggle('active', isAct);
    c.classList.toggle('bg-obsidian-800', isAct);
    c.classList.toggle('border-2', isAct);
    c.classList.toggle('border-brand-primary', isAct);
    c.classList.toggle('bg-obsidian-950/70', !isAct);
    c.classList.toggle('border', !isAct);
    c.classList.toggle('border-obsidian-750', !isAct);
  });

  if (!highlightCustom && PRESET_HIGHLIGHTS[state.captionStyle]) {
    state.captionHighlight = PRESET_HIGHLIGHTS[state.captionStyle];
    if ($('s-caption-highlight')) $('s-caption-highlight').value = state.captionHighlight;
  }
  state.captionColor = $('s-caption-color')?.value || state.captionColor || '#FFFFFF';

  updateCaptionPreview();
  checkImageBlockSync();
}

// Colour swatches
$$('.color-swatch').forEach(swatch => {
  swatch.onclick = () => {
    $$('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    state.captionColor = swatch.dataset.color;
    updateCaptionPreview();
  };
});

function selectCaptionColor(color) {
  state.captionColor = color;
  if ($('s-caption-color')) $('s-caption-color').value = color;
  $$('.color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));
  updateCaptionPreview();
  checkImageBlockSync();
}

if ($('caption-color-picker')) {
  $('caption-color-picker').oninput = (e) => {
    $$('.color-swatch').forEach(s => s.classList.remove('active'));
    state.captionColor = e.target.value;
    updateCaptionPreview();
    checkImageBlockSync();
  };
}

// Caption size
const captionSizeEl = $('caption-size') || $('s-caption-size');
if (captionSizeEl) {
  captionSizeEl.oninput = () => { updateCaptionSizeLabel(); updateCaptionPreview(); };
}
if ($('btn-size-down')) {
  $('btn-size-down').onclick = () => {
    if (captionSizeEl) {
      captionSizeEl.value = Math.max(20, parseInt(captionSizeEl.value) - 4);
      updateCaptionSizeLabel(); updateCaptionPreview();
    }
  };
}
if ($('btn-size-up')) {
  $('btn-size-up').onclick = () => {
    if (captionSizeEl) {
      captionSizeEl.value = Math.min(120, parseInt(captionSizeEl.value) + 4);
      updateCaptionSizeLabel(); updateCaptionPreview();
    }
  };
}
function updateCaptionSizeLabel() {
  if (!captionSizeEl) return;
  state.captionSize = parseInt(captionSizeEl.value);
  if ($('caption-size-val')) $('caption-size-val').textContent = `${state.captionSize}px`;
}

// Draggable caption overlay & Position Control
let dragStartY = 0, dragStartPct = 80;
const overlay = $('caption-overlay') || $('caption-preview-text');

function applyCaptionPosition(posVal) {
  if (posVal === 'top') {
    state.captionPosition = { x: 50, y: 15 };
  } else if (posVal === 'center') {
    state.captionPosition = { x: 50, y: 50 };
  } else {
    // bottom (default)
    state.captionPosition = { x: 50, y: 80 };
  }
  if (overlay) {
    overlay.style.top = `${state.captionPosition.y}%`;
    overlay.style.left = `${state.captionPosition.x}%`;
    overlay.style.transform = 'translate(-50%, -50%)';
  }
  updateCaptionPreview();
}

if ($('s-caption-pos')) {
  $('s-caption-pos').onchange = (e) => {
    applyCaptionPosition(e.target.value);
  };
}

if (overlay) {
  overlay.addEventListener('mousedown', (e) => {
    dragStartY = e.clientY;
    dragStartPct = state.captionPosition?.y ?? 80;
    const preview = $('caption-preview') || $('caption-preview-box');
    if (!preview) return;
    const h = preview.getBoundingClientRect().height;

    const onMove = (ev) => {
      const dy = ev.clientY - dragStartY;
      const pct = Math.max(8, Math.min(92, Math.round(dragStartPct + (dy / h) * 100)));
      state.captionPosition = { x: 50, y: pct };
      overlay.style.top = `${pct}%`;
      overlay.style.left = '50%';
      overlay.style.transform = 'translate(-50%, -50%)';

      const posSelect = $('s-caption-pos');
      if (posSelect) {
        if (pct >= 68) posSelect.value = 'bottom';
        else if (pct <= 32) posSelect.value = 'top';
        else posSelect.value = 'center';
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

if ($('btn-reset-pos')) {
  $('btn-reset-pos').onclick = () => {
    state.captionPosition = { x: 50, y: 80 };
    if (overlay) {
      overlay.style.top = '80%';
      overlay.style.left = '50%';
      overlay.style.transform = 'translate(-50%, -50%)';
    }
    if ($('s-caption-pos')) $('s-caption-pos').value = 'bottom';
    updateCaptionPreview();
    checkImageBlockSync();
  };
}

// Caption text change → parse words
let captionDebounce;
const captionTextEl = $('caption-text') || $('captions-text');
if (captionTextEl) {
  captionTextEl.oninput = () => {
    clearTimeout(captionDebounce);
    captionDebounce = setTimeout(parseCaptionWords, 500);
  };
}

async function parseCaptionWords() {
  const textEl = $('caption-text') || $('captions-text');
  if (!textEl) return;
  const text = textEl.value.trim();
  if (!text) {
    state.captionWords = [];
    state.captionLines = [];
    if ($('caption-word-count')) $('caption-word-count').classList.add('hidden');
    updateCaptionPreview();
    return;
  }
  const { lines, words, wordCount } = await api('POST', '/api/parse-captions', { text });
  state.captionWords = words || [];
  state.captionLines = lines || [];
  if (wordCount > 0) {
    if ($('caption-word-count')) $('caption-word-count').classList.remove('hidden');
    if ($('word-count-num')) $('word-count-num').textContent = wordCount;
  } else {
    if ($('caption-word-count')) $('caption-word-count').classList.add('hidden');
  }
  updateCaptionPreview();
  checkImageBlockSync();
}

// Load txt/srt
const btnLoadTxt = $('btn-load-txt') || $('btn-captions-file');
const inputCaptionFile = $('input-caption-file') || $('input-captions-file');
if (btnLoadTxt && inputCaptionFile) {
  btnLoadTxt.onclick = () => inputCaptionFile.click();
  inputCaptionFile.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    if ($('captions-file-name')) $('captions-file-name').textContent = file.name;
    const txt = $('caption-text') || $('captions-text');
    if (txt) txt.value = text;
    parseCaptionWords();
  };
}
if ($('btn-preview-refresh')) {
  $('btn-preview-refresh').onclick = () => parseCaptionWords();
}

const btnUploadSrt = $('btn-upload-srt');
const inputSrtFile = $('input-srt-file');
if (btnUploadSrt && inputSrtFile) {
  btnUploadSrt.onclick = () => inputSrtFile.click();
  inputSrtFile.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const srt = await file.text();
    const lines = [];
    const blocks = srt.split(/\n\n+/);
    for (const block of blocks) {
      const rows = block.trim().split('\n');
      if (rows.length < 3) continue;
      const timeRow = rows[1];
      const m = timeRow.match(/(\d+):(\d+):(\d+),(\d+)\s*-->/);
      if (!m) continue;
      const totalSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const text = rows.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
      lines.push(`(${mins}:${String(secs).padStart(2,'0')}) ${text}`);
    }
    const captionTxt = $('caption-text') || $('captions-text');
    if (captionTxt) captionTxt.value = lines.join('\n');
    parseCaptionWords();
  };
}

// ── Real-Time Preview Playback Engine (Line 1 Animation) ──
let previewPlaying = true;
let previewLoop = true;
let previewTimeOffset = 0; // seconds into first line
let lastFrameTime = performance.now();

function getActiveCaptionLine(timeSec) {
  if (state.captionLines && state.captionLines.length > 0) {
    const t = timeSec !== undefined ? timeSec : state.previewCurrentTime;
    const match = state.captionLines.find(l => t >= l.startSec && t <= l.endSec);
    if (match) return match;
    const prev = state.captionLines.filter(l => l.startSec <= t);
    if (prev.length) return prev[prev.length - 1];
    return state.captionLines[0];
  }
  // Default sample line if no captions are loaded yet
  return {
    startSec: 0,
    endSec: 3.0,
    text: "You've been exhausted all day, and yet your mind switches on like a stadium light",
    words: [
      { word: "You've", startSec: 0.0, endSec: 0.35 },
      { word: "been", startSec: 0.35, endSec: 0.65 },
      { word: "exhausted", startSec: 0.65, endSec: 1.2 },
      { word: "all", startSec: 1.2, endSec: 1.45 },
      { word: "day,", startSec: 1.45, endSec: 1.8 },
      { word: "and", startSec: 1.8, endSec: 1.95 },
      { word: "yet", startSec: 1.95, endSec: 2.15 },
      { word: "your", startSec: 2.15, endSec: 2.35 },
      { word: "mind", startSec: 2.35, endSec: 2.55 },
      { word: "switches", startSec: 2.55, endSec: 2.8 },
      { word: "on", startSec: 2.8, endSec: 3.0 }
    ]
  };
}

function chunkWords(words, option = '3-4') {
  if (!words || !words.length) return [];
  if (option === 'all') return [words];

  if (option === '3-4') {
    const n = words.length;
    if (n <= 4) return [words];
    const numChunks = Math.ceil(n / 4);
    const baseSize = Math.floor(n / numChunks);
    const remainder = n % numChunks;
    const chunks = [];
    let start = 0;
    for (let c = 0; c < numChunks; c++) {
      const size = baseSize + (c < remainder ? 1 : 0);
      chunks.push(words.slice(start, start + size));
      start += size;
    }
    return chunks;
  }

  const chunkSize = parseInt(option, 10);
  if (!chunkSize || isNaN(chunkSize) || chunkSize <= 0) return [words];

  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize));
  }
  return chunks;
}

function updateCaptionPreview() {
  renderRealtimeCaption(previewTimeOffset);
}

function renderRealtimeCaption(offsetSec) {
  const textEl = $('caption-preview-text');
  if (!textEl) return;
  const style = state.captionStyle || 'none';
  const font = state.captionFont || $('s-caption-font')?.value || 'Poppins';
  const textColor = state.captionColor || $('s-caption-color')?.value || '#FFFFFF';
  const highlightColor = state.captionHighlight || $('s-caption-highlight')?.value || '#FACC15';

  // Apply explicit position & sizing styles so they are NEVER lost or reset
  const pos = state.captionPosition || { x: 50, y: 80 };
  const baseSize = Math.round(state.captionSize * 0.42);
  textEl.style.fontSize = `${baseSize}px`;
  textEl.style.fontFamily = `'${font}', sans-serif`;
  textEl.style.position = 'absolute';
  textEl.style.left = `${pos.x ?? 50}%`;
  textEl.style.top = `${pos.y ?? 80}%`;
  textEl.style.transform = 'translate(-50%, -50%)';
  textEl.style.width = '90%';
  textEl.style.maxWidth = '90%';
  textEl.style.textAlign = 'center';
  textEl.style.pointerEvents = 'auto';

  if (style === 'none') {
    textEl.innerHTML = '';
    return;
  }

  const line = getActiveCaptionLine(state.previewCurrentTime);
  const dur = Math.max(0.5, line.endSec - line.startSec);
  const currentOffset = offsetSec !== undefined ? offsetSec : previewTimeOffset;
  const currentAbsTime = line.startSec + currentOffset;

  // Words list
  let words = line.words;
  if (!words || !words.length) {
    const rawTokens = (line.text || '').trim().split(/\s+/).filter(Boolean);
    const step = dur / Math.max(1, rawTokens.length);
    words = rawTokens.map((w, i) => ({
      word: w,
      startSec: line.startSec + i * step,
      endSec: line.startSec + (i + 1) * step
    }));
  }

  // One Word Theme (Single focal point)
  if (style === 'simple-one-word') {
    let activeIdx = words.findIndex(w => currentAbsTime >= w.startSec && currentAbsTime < w.endSec);
    if (activeIdx === -1) {
      activeIdx = (currentAbsTime >= line.endSec) ? words.length - 1 : 0;
    }
    const currentWord = words[activeIdx] ? words[activeIdx].word.toUpperCase() : '';
    textEl.innerHTML = `<span class="caption-word word-active theme-simple-one-word" style="font-family:'${font}',sans-serif !important;color:${textColor} !important;">${currentWord}</span>`;
    return;
  }

  // Always show full caption line by default
  const chunks = chunkWords(words, 'all');

  let activeChunk = chunks.find(ch => currentAbsTime >= ch[0].startSec && currentAbsTime < ch[ch.length - 1].endSec);
  if (!activeChunk) {
    activeChunk = (currentAbsTime >= line.endSec) ? chunks[chunks.length - 1] : chunks[0];
  }
  if (!activeChunk || !activeChunk.length) return;

  let activeWordIdx = activeChunk.findIndex(w => currentAbsTime >= w.startSec && currentAbsTime < w.endSec);
  if (activeWordIdx === -1) {
    if (currentAbsTime >= activeChunk[activeChunk.length - 1].endSec) activeWordIdx = activeChunk.length - 1;
    else activeWordIdx = 0;
  }

  const isUppercase = ['bold', 'bold-highlight', 'poppin', 'poppin-clean', 'beast', 'hustle', 'aarit', 'gaming-stream', 'simple-one-word'].includes(style);
  const isHighlightStyle = ['bold-highlight', 'poppin', 'beast', 'hustle', 'pupcaps', 'podcast', 'aarit', 'gaming-stream'].includes(style);

  const html = activeChunk.map((w, idx) => {
    let wordText = isUppercase ? w.word.toUpperCase() : w.word;
    const isAct = idx === activeWordIdx;
    const isPast = idx < activeWordIdx;

    const fontRule = `font-family:'${font}',sans-serif !important;`;
    let cls = `caption-word theme-${style}`;
    let colorRule = `color:${textColor} !important;`;

    if (style === 'bold' || style === 'poppin-clean') {
      cls = 'caption-word theme-bold';
    } else if (isHighlightStyle) {
      if (isAct) {
        cls += ' word-active';
        colorRule = `color:${highlightColor} !important;`;
      } else if (isPast) {
        cls += ' word-passed';
      } else {
        cls += ' word-inactive';
      }
    }

    return `<span class="${cls}" style="${fontRule}${colorRule}">${wordText}</span>`;
  }).join(' ');

  textEl.innerHTML = html;
}

// Global real-time animation loop of the active line
function previewAnimationLoop(now) {
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  const line = getActiveCaptionLine(state.previewCurrentTime);
  const dur = Math.max(0.5, line.endSec - line.startSec);

  if (!isTimelinePlaying) {
    previewTimeOffset += dt;
    if (previewTimeOffset >= dur) {
      previewTimeOffset = 0; // seamless loop
    }
    renderRealtimeCaption(previewTimeOffset);
  }

  requestAnimationFrame(previewAnimationLoop);
}

// Start live preview loop
requestAnimationFrame(previewAnimationLoop);

// ══════════════════════════════════════════════════════════════════════════
// SECTION 4 — TIMELINE
// ══════════════════════════════════════════════════════════════════════════

async function rebuildTimeline() {
  if (!state.files.length) {
    state.clips = [];
    state.totalDuration = 0;
    renderTimeline();
    setPreviewFrame(null);
    return;
  }
  const { clips, totalDuration } = await api('POST', '/api/parse-filenames', {
    files: state.files.map(f => ({ name: f.name, path: f.path, type: f.type })),
    gapMode: $('s-gap-mode').value,
  });
  state.clips = clips;
  state.totalDuration = totalDuration;
  renderTimeline();
  updateSizeEstimate();
  setPreviewFrame(); // Show first image in preview
  checkImageBlockSync();
}

function updateTimeline() {
  renderTimeline();
  updateSizeEstimate();
}

function renderTimeline() {
  const clips = state.clips;
  const tbody = $('timeline-body');
  const empty = $('timeline-empty');
  const summary = $('timeline-summary');
  const ruler = $('clip-ruler') || $('timeline-ruler');
  const durEl = $('timeline-duration') || $('track-duration');
  const waveformEl = $('timeline-canvas') || $('waveform-canvas');

  if (tbody) tbody.innerHTML = '';

  if (!clips.length) {
    if (empty) empty.style.display = 'flex';
    if (summary) summary.textContent = '';
    if (ruler) ruler.innerHTML = '';
    if (durEl) durEl.textContent = '00:00.00';
    if (waveformEl) renderWaveform(waveformEl, null, 0);
    return;
  }
  if (empty) empty.style.display = 'none';

  const total = clips.length > 0 ? clips[clips.length - 1].endSec : (state.voiceover?.duration || 0);
  state.totalDuration = total;
  if (summary) summary.textContent = `· ${clips.length} clips · ${formatTime(total)}`;
  if (durEl) durEl.textContent = formatTime(total);

  if (tbody) {
    for (const clip of clips) {
      const tr = document.createElement('tr');
      tr.id = `timeline-row-${clip.index}`;
      tr.className = 'hover:bg-obsidian-850/60 border-b border-obsidian-800/50 transition cursor-pointer';

      const motionOpts = ['auto','zoomIn','zoomOut','panLeft','panRight','none']
        .map(m => `<option value="${m}"${clip.motion===m?' selected':''}>${m}</option>`).join('');

      tr.innerHTML = `
        <td class="py-2 px-3 text-slate-400 font-bold">${clip.index}</td>
        <td class="py-2 px-3 font-medium text-slate-200 max-w-[240px] truncate" title="${clip.name}">${clip.name}</td>
        <td class="py-2 px-3"><span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-teal-500/10 text-teal-400 border border-teal-500/30">${clip.type}</span></td>
        <td class="py-2 px-3 font-mono text-slate-400">${formatTime(clip.startSec)}</td>
        <td class="py-2 px-3 font-mono text-slate-400">${formatTime(clip.endSec)}</td>
        <td class="py-2 px-3 font-mono text-amber-400">${(clip.durationSec || 0).toFixed(1)}s</td>
        <td class="py-2 px-3"><select class="motion-select bg-obsidian-900 border border-obsidian-750 text-slate-300 text-xs rounded px-2 py-1" data-idx="${clip.index - 1}">${motionOpts}</select></td>
        <td class="py-2 px-3 text-right"><button class="btn btn-ghost btn-icon rm-clip p-1 hover:text-rose-400 text-slate-500" data-idx="${clip.index - 1}" title="Remove clip">${icons.x}</button></td>
      `;

      tr.onclick = (e) => {
        if (!e.target.closest('select, button')) {
          seekTimeline(clip.startSec, true);
        }
      };

      tbody.appendChild(tr);
    }
  }

  // Motion change handlers
  tbody.querySelectorAll('.motion-select').forEach(sel => {
    sel.onchange = (e) => {
      state.clips[parseInt(e.target.dataset.idx)].motion = e.target.value;
    };
  });

  // Remove clip handlers
  tbody.querySelectorAll('.rm-clip').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      const clip = state.clips[idx];
      state.files = state.files.filter(f => f.name !== clip.name);
      rebuildTimeline();
      renderMediaGrid();
    };
  });

  // Render clip ruler with interactive click preview
  if (ruler) {
    renderClipRuler(ruler, clips, total, (clip) => {
      seekTimeline(clip.startSec, true);
    });
  }

  // Render waveform
  if (waveformEl) {
    renderWaveform(waveformEl, state.voiceover?.file || null, total);
  }
}

// ── Multi-Track Timeline Playback & Audio Engine ──────────────────────────
let timelineAudio = null;
let isTimelinePlaying = false;
let timelinePlayheadRaf = null;

function getAudioSourceUrl() {
  if (state.voiceover) {
    if (state.voiceover.file) {
      if (!state.voiceover.objectUrl) {
        state.voiceover.objectUrl = URL.createObjectURL(state.voiceover.file);
      }
      return state.voiceover.objectUrl;
    }
    if (state.voiceover.path) {
      return `/api/media-preview?path=${encodeURIComponent(state.voiceover.path)}`;
    }
  }
  return null;
}

function initTimelineAudio() {
  const src = getAudioSourceUrl();
  if (!src) {
    if (timelineAudio) {
      timelineAudio.pause();
      timelineAudio = null;
    }
    return null;
  }
  if (!timelineAudio || timelineAudio.src !== src) {
    if (timelineAudio) timelineAudio.pause();
    timelineAudio = new Audio(src);
    timelineAudio.onended = () => {
      pauseTimeline();
      seekTimeline(0, false);
    };
  }
  return timelineAudio;
}

function formatTimelineClock(sec) {
  if (!sec || isNaN(sec) || sec < 0) sec = 0;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  const wholeSec = Math.floor(rem);
  const centis = Math.floor((rem - wholeSec) * 100);
  return `${String(mins).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function updatePlayheadVisuals(timeSec) {
  const total = state.totalDuration || (state.clips.length ? state.clips[state.clips.length - 1].endSec : 0) || (state.voiceover?.duration || 0);
  const timeEl = $('timeline-time');
  if (timeEl) {
    timeEl.textContent = formatTimelineClock(timeSec);
  }

  const playhead = $('timeline-playhead');
  if (playhead && total > 0) {
    const pct = Math.max(0, Math.min(100, (timeSec / total) * 100));
    playhead.style.left = `${pct}%`;
  }
}

function seekTimeline(timeSec, syncAudio = true) {
  const total = state.totalDuration || (state.clips.length ? state.clips[state.clips.length - 1].endSec : 0) || (state.voiceover?.duration || 0);
  const clampedTime = Math.max(0, Math.min(total > 0 ? total : 0, timeSec));
  state.previewCurrentTime = clampedTime;

  if (syncAudio && timelineAudio) {
    try {
      timelineAudio.currentTime = clampedTime;
    } catch (e) {}
  }

  updatePlayheadVisuals(clampedTime);

  // Sync preview frame image
  if (state.clips && state.clips.length > 0) {
    const activeClip = state.clips.find(c => clampedTime >= c.startSec && clampedTime < c.endSec) 
                    || (clampedTime >= total ? state.clips[state.clips.length - 1] : state.clips[0]);
    if (activeClip) {
      const fileItem = state.files.find(f => f.name === activeClip.name) || activeClip;
      const src = getMediaSrc(fileItem);
      if (src && fileItem.type !== 'gap') {
        const imgEl = $('preview-frame-img');
        if (imgEl) {
          imgEl.src = src;
          imgEl.classList.remove('hidden');
        }
        if ($('preview-placeholder')) $('preview-placeholder').classList.add('hidden');
      }

      $$('#timeline-body tr').forEach(row => row.classList.remove('active-preview'));
      if (activeClip.index) {
        const activeRow = $(`timeline-row-${activeClip.index}`);
        if (activeRow) activeRow.classList.add('active-preview');
      }
    }
  }

  // Sync caption line to clampedTime
  const activeLine = getActiveCaptionLine(clampedTime);
  const lineOffset = Math.max(0, clampedTime - activeLine.startSec);
  renderRealtimeCaption(lineOffset);
}

function toggleTimelinePlay() {
  if (isTimelinePlaying) {
    pauseTimeline();
  } else {
    playTimeline();
  }
}

function playTimeline() {
  const total = state.totalDuration || (state.clips.length ? state.clips[state.clips.length - 1].endSec : 0) || (state.voiceover?.duration || 0);
  if (total <= 0) return;

  if (state.previewCurrentTime >= total) {
    seekTimeline(0, true);
  }

  isTimelinePlaying = true;
  updatePlayButtonUI(true);

  const audio = initTimelineAudio();
  if (audio) {
    audio.currentTime = state.previewCurrentTime;
    audio.play().catch(err => console.warn('Audio play prevented:', err));
  }

  let lastTick = performance.now();
  function timelineTick(now) {
    if (!isTimelinePlaying) return;
    const dt = (now - lastTick) / 1000;
    lastTick = now;

    let newTime;
    if (timelineAudio && !timelineAudio.paused && !timelineAudio.ended) {
      newTime = timelineAudio.currentTime;
    } else {
      newTime = state.previewCurrentTime + dt;
    }

    if (newTime >= total) {
      pauseTimeline();
      seekTimeline(total, false);
      return;
    }

    seekTimeline(newTime, false);
    timelinePlayheadRaf = requestAnimationFrame(timelineTick);
  }

  timelinePlayheadRaf = requestAnimationFrame(timelineTick);
}

function pauseTimeline() {
  isTimelinePlaying = false;
  if (timelinePlayheadRaf) {
    cancelAnimationFrame(timelinePlayheadRaf);
    timelinePlayheadRaf = null;
  }
  if (timelineAudio) {
    timelineAudio.pause();
  }
  updatePlayButtonUI(false);
}

function updatePlayButtonUI(playing) {
  const btn = $('btn-timeline-play');
  if (!btn) return;
  if (playing) {
    btn.innerHTML = `
      <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      <span>PAUSE</span>
    `;
    btn.classList.add('bg-amber-600', 'hover:bg-amber-500');
    btn.classList.remove('bg-brand-primary', 'hover:bg-brand-primary/90');
  } else {
    btn.innerHTML = `
      <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      <span>PLAY</span>
    `;
    btn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
    btn.classList.add('bg-brand-primary', 'hover:bg-brand-primary/90');
  }
}

function setupTimelineScrubbing() {
  const tracksEl = $('timeline-tracks');
  const rulerEl = $('timeline-ruler');
  const cursorEl = $('timeline-cursor');

  function handleScrub(e, container) {
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = x / rect.width;
    const total = state.totalDuration || (state.clips.length ? state.clips[state.clips.length - 1].endSec : 0) || (state.voiceover?.duration || 0);
    if (total <= 0) return;
    const targetTime = pct * total;
    seekTimeline(targetTime, true);
  }

  let isScrubbing = false;

  if (tracksEl) {
    tracksEl.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      handleScrub(e, tracksEl);
    });

    tracksEl.addEventListener('mousemove', (e) => {
      const rect = tracksEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      if (cursorEl) {
        cursorEl.classList.remove('hidden');
        cursorEl.style.left = `${x}px`;
      }
      if (isScrubbing) {
        handleScrub(e, tracksEl);
      }
    });

    tracksEl.addEventListener('mouseleave', () => {
      if (cursorEl && !isScrubbing) cursorEl.classList.add('hidden');
    });
  }

  if (rulerEl) {
    rulerEl.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      handleScrub(e, rulerEl);
    });
    rulerEl.addEventListener('mousemove', (e) => {
      if (isScrubbing) handleScrub(e, rulerEl);
    });
  }

  window.addEventListener('mousemove', (e) => {
    if (isScrubbing && tracksEl) {
      handleScrub(e, tracksEl);
    }
  });

  window.addEventListener('mouseup', () => {
    if (isScrubbing) {
      isScrubbing = false;
      if (cursorEl) cursorEl.classList.add('hidden');
    }
  });

  // Timeline Scale / Zoom slider
  const scaleInput = $('timeline-scale');
  if (scaleInput) {
    scaleInput.oninput = (e) => {
      const scale = parseFloat(e.target.value);
      applyTimelineZoom(scale);
    };
  }

  // Fit button
  const fitBtn = $('btn-timeline-fit');
  if (fitBtn) {
    fitBtn.onclick = () => {
      if (scaleInput) scaleInput.value = 1;
      applyTimelineZoom(1);
    };
  }

  // Play button
  const playBtn = $('btn-timeline-play');
  if (playBtn) {
    playBtn.onclick = toggleTimelinePlay;
  }
}

function applyTimelineZoom(scale) {
  const rulerEl = $('timeline-ruler');
  const canvasEl = $('timeline-canvas');
  if (rulerEl) {
    rulerEl.style.width = scale === 1 ? '100%' : `${scale * 100}%`;
  }
  if (canvasEl) {
    canvasEl.style.width = scale === 1 ? '100%' : `${scale * 100}%`;
    const total = state.totalDuration || (state.clips.length ? state.clips[state.clips.length - 1].endSec : 0);
    renderWaveform(canvasEl, state.voiceover?.file || null, total);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 5 — EXPORT
// ══════════════════════════════════════════════════════════════════════════

let customDirHandle = null;
const btnChooseFolder = $('btn-choose-folder') || $('btn-browse-out-dir');
if (btnChooseFolder) {
  btnChooseFolder.onclick = async () => {
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await window.showDirectoryPicker({
          id: 'sceneflow-export-folder',
          mode: 'readwrite',
        });
        if (!dirHandle) return;
        customDirHandle = dirHandle;
        const outInput = $('export-folder') || $('out-dir');
        if (outInput) {
          outInput.value = dirHandle.name;
          outInput.title = `Selected folder: ${dirHandle.name}`;
        }
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.warn('Directory picker error:', err);
      }
    }

    btnChooseFolder.disabled = true;
    const oldText = btnChooseFolder.textContent;
    btnChooseFolder.textContent = 'Opening…';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const r = await fetch('/api/select-folder', { method: 'POST', signal: controller.signal });
      clearTimeout(timer);
      const res = await r.json();
      if (res && res.path) {
        customDirHandle = null;
        const outInput = $('export-folder') || $('out-dir');
        if (outInput) outInput.value = res.path;
        checkDiskSpace(res.path);
        api('POST', '/api/settings', { saveFolder: res.path }).catch(() => {});
      }
    } catch (err) {
      console.warn('Native picker not available:', err);
    } finally {
      btnChooseFolder.disabled = false;
      btnChooseFolder.textContent = oldText;
    }
  };
}

async function loadQuickFolders() {
  const container = $('quick-folder-chips') || $('out-dir-presets');
  if (!container) return;
  try {
    const list = await api('GET', '/api/quick-folders');
    if (!list || !list.length) return;
    container.innerHTML = '<span class="text-xs text-slate-500 mr-1">Quick Path:</span>';
    list.forEach(item => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'px-2.5 py-1 rounded bg-obsidian-850 hover:bg-obsidian-800 text-slate-300 text-xs font-mono border border-obsidian-700 transition flex items-center gap-1.5';
      chip.title = item.path;
      chip.innerHTML = `<span>📁 ${item.label}</span>`;
      chip.onclick = () => {
        customDirHandle = null;
        const outInput = $('export-folder') || $('out-dir');
        if (outInput) outInput.value = item.path;
        checkDiskSpace(item.path);
        api('POST', '/api/settings', { saveFolder: item.path }).catch(() => {});
      };
      container.appendChild(chip);
    });
  } catch (err) {
    console.warn('Could not load quick folders:', err);
  }
}

const exportFolderEl = $('export-folder') || $('out-dir');
if (exportFolderEl) {
  exportFolderEl.oninput = (e) => {
    customDirHandle = null;
    checkDiskSpace(e.target.value.trim());
  };
  exportFolderEl.onchange = (e) => {
    const val = e.target.value.trim();
    if (val && !customDirHandle) api('POST', '/api/settings', { saveFolder: val }).catch(() => {});
  };
}

function updateSizeEstimate() {
  const clips = state.clips;
  const sizeEstimateEl = $('size-estimate');
  if (!sizeEstimateEl) return;
  if (!clips.length) { sizeEstimateEl.classList.add('hidden'); return; }

  const total = state.totalDuration || clips.reduce((s, c) => s + (c.durationSec || 0), 0);
  const qualityMap = { draft: 2, web: 4, youtube: 8, high: 16, max: 24 };
  const qualityEl = $('s-quality');
  const mbps = qualityEl ? (qualityMap[qualityEl.value] || 8) : 8;
  const bytes = (mbps * 1_000_000 / 8) * total;
  const mb = bytes / 1_048_576;

  sizeEstimateEl.classList.remove('hidden');
  sizeEstimateEl.textContent = `Estimated size: ~${mb >= 1024 ? (mb/1024).toFixed(2) + ' GB' : mb.toFixed(0) + ' MB'} · Total Duration: ${formatTime(total)}`;
}

async function checkDiskSpace(folderPath) {
  if (!folderPath) return;
  try {
    const { free } = await api('POST', '/api/disk-space', { folderPath });
    const totalMb = estimatedBytes();
    if ($('disk-warning')) {
      if (free > 0 && free < totalMb) {
        $('disk-warning').classList.remove('hidden');
      } else {
        $('disk-warning').classList.add('hidden');
      }
    }
    if ($('folder-info')) {
      $('folder-info').textContent = free > 0
        ? `Free space: ${(free / 1_073_741_824).toFixed(1)} GB`
        : '';
    }
  } catch {}
}

function estimatedBytes() {
  const clips = state.clips;
  const total = state.totalDuration || clips.reduce((s, c) => s + (c.durationSec || 0), 0);
  const qualityMap = { draft: 2, web: 4, youtube: 8, high: 16, max: 24 };
  const qualityEl = $('s-quality');
  const mbps = qualityEl ? (qualityMap[qualityEl.value] || 8) : 8;
  return (mbps * 1_000_000 / 8) * total;
}

const btnCreateVideo = $('btn-create-video') || $('btn-render');
if (btnCreateVideo) btnCreateVideo.onclick = startExport;

const btnCancelExport = $('btn-cancel-export') || $('btn-cancel-render');
if (btnCancelExport) btnCancelExport.onclick = cancelExport;

if ($('btn-dismiss-error')) {
  $('btn-dismiss-error').onclick = () => {
    if ($('export-error')) $('export-error').classList.add('hidden');
  };
}
if ($('btn-new-export')) {
  $('btn-new-export').onclick = () => {
    if ($('export-done')) $('export-done').classList.add('hidden');
    if (btnCreateVideo) btnCreateVideo.classList.remove('hidden');
  };
}

async function startExport() {
  if (!state.clips.length) {
    showExportError('No clips in timeline. Add images or videos first.');
    return;
  }

  if (isUploadingMedia) {
    showExportError('Media files are still uploading to the local server. Please wait a moment until upload finishes.');
    return;
  }

  const missing = state.clips.filter(c => c.type !== 'gap' && !c.path);
  if (missing.length > 0) {
    showExportError(`Media file "${missing[0].name}" is missing a local file path. Please re-add your files or use "Add Zip".`);
    return;
  }

  if (customDirHandle && typeof customDirHandle.requestPermission === 'function') {
    try {
      const perm = await customDirHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        showExportError('Permission to write into the selected folder was denied.');
        return;
      }
    } catch {}
  }

  const fileNameInput = $('out-filename') || $('export-filename');
  const fileName = ((fileNameInput ? fileNameInput.value.trim() : '') || 'export') + '.mp4';
  const saveFolderInput = $('out-dir') || $('export-folder');
  const saveFolder = customDirHandle ? '' : (saveFolderInput ? saveFolderInput.value.trim() : '');

  if (saveFolder) {
    await checkDiskSpace(saveFolder);
  }

  let activeRenderObjectUrl = null;
  function resetRenderPlayer() {
    const player = $('render-video-player');
    if (player) {
      try { player.pause(); } catch {}
      player.removeAttribute('src');
      player.load();
    }
    if (activeRenderObjectUrl) {
      try { URL.revokeObjectURL(activeRenderObjectUrl); } catch {}
      activeRenderObjectUrl = null;
    }
    if ($('render-player-wrap')) $('render-player-wrap').classList.add('hidden');
    if ($('render-modal-card')) {
      $('render-modal-card').classList.remove('max-w-2xl');
      $('render-modal-card').classList.add('max-w-md');
    }
  }
  resetRenderPlayer();

  if ($('export-error')) $('export-error').classList.add('hidden');
  if ($('export-done')) $('export-done').classList.add('hidden');
  if ($('export-progress')) $('export-progress').classList.remove('hidden');
  if ($('render-modal')) $('render-modal').classList.remove('hidden');
  if ($('btn-create-video')) $('btn-create-video').classList.add('hidden');
  if ($('btn-render')) $('btn-render').classList.add('hidden');
  if ($('btn-cancel-export')) $('btn-cancel-export').classList.remove('hidden');
  if ($('btn-cancel-render')) $('btn-cancel-render').classList.remove('hidden');
  if ($('render-complete-actions')) $('render-complete-actions').classList.add('hidden');
  if ($('btn-close-modal')) $('btn-close-modal').classList.add('hidden');
  if ($('render-modal-dot')) {
    $('render-modal-dot').className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
  }

  if ($('progress-bar')) $('progress-bar').style.width = '0%';
  if ($('progress-pct')) $('progress-pct').textContent = '0%';
  if ($('progress-stage')) $('progress-stage').textContent = 'Starting render…';
  if ($('render-progress-bar')) $('render-progress-bar').style.width = '0%';
  if ($('render-progress-val')) $('render-progress-val').textContent = '0%';
  if ($('render-status-text')) $('render-status-text').textContent = 'Starting render…';
  if ($('render-eta-text')) $('render-eta-text').textContent = 'ETA: calculating…';

  state.exportStartTime = Date.now();

  const syncModeEl = $('s-sync-mode') || $('s-vo-mode');
  const jobPayload = {
    clips: state.clips,
    voiceover: state.voiceover?.path || null,
    music: state.music?.path || null,
    musicVolume: $('music-volume') ? parseFloat($('music-volume').value) : 0.15,
    captionWords: state.captionWords,
    captionStyle: state.captionStyle,
    captionColor: state.captionColor,
    captionHighlight: state.captionHighlight,
    captionFont: state.captionFont,
    captionSize: state.captionSize,
    captionPosition: state.captionPosition,
    wordsPerLine: 'all',
    fileName,
    saveFolder,
    useBrowserDir: !!customDirHandle,
    voiceoverMode: syncModeEl ? syncModeEl.value : 'cut',
    ...getSettings(),
  };

  const res = await api('POST', '/api/export', jobPayload);
  if (res.error) {
    showExportError(res.error);
    return;
  }

  const jobId = res.jobId;
  state.activeJobId = jobId;

  // Listen for SSE progress
  const es = new EventSource(`/api/export/${jobId}/progress`);
  es.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'progress') {
      const pct = data.pct || 0;
      if ($('progress-bar')) $('progress-bar').style.width = `${pct}%`;
      if ($('progress-pct')) $('progress-pct').textContent = `${pct}%`;
      if ($('progress-stage')) $('progress-stage').textContent = data.stage || '';
      if ($('render-progress-bar')) $('render-progress-bar').style.width = `${pct}%`;
      if ($('render-progress-val')) $('render-progress-val').textContent = `${pct}%`;
      if ($('render-status-text')) $('render-status-text').textContent = data.stage || 'Rendering frames…';

      if (pct > 0 && pct < 100) {
        const elapsed = (Date.now() - state.exportStartTime) / 1000;
        const etaSec = Math.round((elapsed / pct) * (100 - pct));
        const etaStr = `ETA: ${formatTime(etaSec)}`;
        if ($('progress-eta')) $('progress-eta').textContent = etaStr;
        if ($('render-eta-text')) $('render-eta-text').textContent = etaStr;
      }
    } else if (data.type === 'done') {
      es.close();
      data.jobId = jobId;
      if (customDirHandle) {
        try {
          if ($('render-status-text')) $('render-status-text').textContent = `Saving to ${customDirHandle.name}…`;
          const dlRes = await fetch(`/api/export/${jobId}/download`);
          if (!dlRes.ok) throw new Error('Could not download rendered video');
          const fileHandle = await customDirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await dlRes.body.pipeTo(writable);
          data.savedBrowserFolder = customDirHandle.name;
          data.savedFileName = fileName;
          data.savedFileHandle = fileHandle;
        } catch (saveErr) {
          showExportError(`Rendered video, but could not save to folder "${customDirHandle.name}": ${saveErr.message}`);
          return;
        }
      }
      showExportDone(data, () => resetRenderPlayer(), (url) => { activeRenderObjectUrl = url; });
    } else if (data.type === 'error') {
      es.close();
      showExportError(data.message);
    }
  };
  es.onerror = () => {
    es.close();
    showExportError('Connection to local server lost during export.');
  };
}

async function cancelExport() {
  if (!state.activeJobId) return;
  await api('POST', `/api/export/${state.activeJobId}/cancel`, {});
  state.activeJobId = null;
  if ($('export-progress')) $('export-progress').classList.add('hidden');
  if ($('render-modal')) $('render-modal').classList.add('hidden');
  if ($('btn-create-video')) $('btn-create-video').classList.remove('hidden');
  if ($('btn-render')) $('btn-render').classList.remove('hidden');
  if ($('btn-cancel-export')) $('btn-cancel-export').classList.add('hidden');
  if ($('btn-cancel-render')) $('btn-cancel-render').classList.add('hidden');
}

function showExportDone(data, resetPlayerCb, trackUrlCb) {
  const elapsed = ((Date.now() - state.exportStartTime) / 1000).toFixed(1);
  if ($('export-progress')) $('export-progress').classList.add('hidden');
  if ($('btn-create-video')) $('btn-create-video').classList.remove('hidden');
  if ($('btn-render')) $('btn-render').classList.remove('hidden');
  if ($('btn-cancel-export')) $('btn-cancel-export').classList.add('hidden');
  if ($('btn-cancel-render')) $('btn-cancel-render').classList.add('hidden');
  if ($('export-done')) $('export-done').classList.remove('hidden');

  if ($('render-modal-dot')) {
    $('render-modal-dot').className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
  }

  const mb = data.fileSize ? (data.fileSize / 1_048_576).toFixed(1) : '?';
  if ($('done-details')) {
    $('done-details').innerHTML = `
      <strong>Video Rendered Successfully!</strong><br>
      Clips: ${data.clips || state.clips.length} &nbsp;·&nbsp;
      Duration: ${formatTime(data.duration || 0)} &nbsp;·&nbsp;
      Size: ${mb} MB<br>
      Rendered in ${elapsed}s &nbsp;·&nbsp;
      Resolution: ${data.resolution || '?'} &nbsp;·&nbsp;
      Encoder: ${data.encoder || '?'}
    `;
  }

  // Handle render modal actions
  if ($('render-progress-bar')) $('render-progress-bar').style.width = '100%';
  if ($('render-progress-val')) $('render-progress-val').textContent = '100%';
  if ($('render-status-text')) {
    $('render-status-text').textContent = data.savedBrowserFolder
      ? `Saved to "${data.savedBrowserFolder}/${data.savedFileName || ''}"!`
      : 'Render completed successfully!';
  }
  if ($('render-eta-text')) $('render-eta-text').textContent = `Done in ${elapsed}s (${mb} MB)`;
  if ($('render-complete-actions')) $('render-complete-actions').classList.remove('hidden');
  if ($('btn-close-modal')) {
    $('btn-close-modal').classList.remove('hidden');
    $('btn-close-modal').onclick = () => {
      if (resetPlayerCb) resetPlayerCb();
      $('render-modal').classList.add('hidden');
    };
  }

  const outDirInput = $('out-dir') || $('export-folder');
  if ($('btn-open-export')) {
    $('btn-open-export').onclick = async () => {
      const player = $('render-video-player');
      const wrap = $('render-player-wrap');
      const card = $('render-modal-card');
      if (!player || !wrap) return;
      try {
        let srcUrl = '';
        if (data.savedFileHandle && typeof data.savedFileHandle.getFile === 'function') {
          const file = await data.savedFileHandle.getFile();
          srcUrl = URL.createObjectURL(file);
          if (trackUrlCb) trackUrlCb(srcUrl);
        } else if (data.jobId || state.activeJobId) {
          srcUrl = `/api/export/${data.jobId || state.activeJobId}/stream`;
        }
        if (!srcUrl) return;
        if (card) {
          card.classList.remove('max-w-md');
          card.classList.add('max-w-2xl');
        }
        wrap.classList.remove('hidden');
        player.src = srcUrl;
        player.play().catch(() => {});
      } catch (err) {
        console.warn('Could not play rendered video:', err);
      }
    };
  }
  if ($('btn-open-folder')) {
    $('btn-open-folder').onclick = async () => {
      if (customDirHandle && typeof window.showDirectoryPicker === 'function') {
        try {
          await window.showDirectoryPicker({
            id: 'sceneflow-export-folder',
            startIn: customDirHandle,
          });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      const p = data.outputPath || (outDirInput ? outDirInput.value : '');
      if (p) api('POST', '/api/open-folder', { folderPath: p });
    };
  }

  // Automatically open video location in Windows Explorer
  const targetPath = data.outputPath || (outDirInput ? outDirInput.value : '');
  if (!data.savedBrowserFolder && targetPath) {
    api('POST', '/api/open-folder', { folderPath: targetPath }).catch(() => {});
  }

  if ($('btn-open-output')) {
    $('btn-open-output').onclick = () => {
      api('POST', '/api/open-folder', { folderPath: targetPath });
    };
  }

  loadHistory();
}

function showExportError(msg) {
  if ($('export-progress')) $('export-progress').classList.add('hidden');
  if ($('btn-create-video')) $('btn-create-video').classList.remove('hidden');
  if ($('btn-render')) $('btn-render').classList.remove('hidden');
  if ($('btn-cancel-export')) $('btn-cancel-export').classList.add('hidden');
  if ($('btn-cancel-render')) $('btn-cancel-render').classList.add('hidden');
  if ($('export-error')) $('export-error').classList.remove('hidden');
  if ($('export-error-msg')) $('export-error-msg').textContent = msg;

  if ($('render-status-text')) $('render-status-text').textContent = `Render Error: ${msg}`;
  if ($('btn-close-modal')) {
    $('btn-close-modal').classList.remove('hidden');
    $('btn-close-modal').onclick = () => $('render-modal').classList.add('hidden');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HISTORY DRAWER
// ══════════════════════════════════════════════════════════════════════════

if ($('btn-history')) $('btn-history').onclick = () => openHistoryDrawer();
if ($('btn-close-history')) $('btn-close-history').onclick = () => closeHistoryDrawer();
if ($('history-backdrop')) $('history-backdrop').onclick = () => closeHistoryDrawer();

function openHistoryDrawer() {
  $('history-drawer').classList.add('open');
  $('history-backdrop').classList.remove('hidden');
  loadHistory();
}
function closeHistoryDrawer() {
  $('history-drawer').classList.remove('open');
  $('history-backdrop').classList.add('hidden');
}

async function loadHistory() {
  const history = await api('GET', '/api/history');
  const list = $('history-list');
  const empty = $('history-empty');
  list.innerHTML = '';

  if (!history.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  for (const item of history) {
    const div = document.createElement('div');
    div.className = 'history-item';
    const mb = item.fileSize ? (item.fileSize / 1_048_576).toFixed(1) : '?';
    const date = new Date(item.date).toLocaleString();
    div.innerHTML = `
      <div class="history-item-title">${item.fileName}</div>
      <div class="history-item-meta">
        ${formatTime(item.duration || 0)} &nbsp;·&nbsp; ${mb} MB &nbsp;·&nbsp; ${item.resolution || ''}<br>
        ${date}
      </div>
      <div class="history-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="openFolder('${item.folder.replace(/\\/g, '\\\\')}')">
          ${icons.folderOpen}
          <span>Open Folder</span>
        </button>
      </div>
    `;
    list.appendChild(div);
  }
}

$('btn-clear-history').onclick = async () => {
  await api('DELETE', '/api/history');
  loadHistory();
};

window.openFolder = (path) => api('POST', '/api/open-folder', { folderPath: path });

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    if (!e.target.matches('input,textarea,select')) openHistoryDrawer();
  }
  if (e.code === 'Space') {
    if (!e.target.matches('input,textarea,select')) {
      e.preventDefault();
      toggleTimelinePlay();
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

async function init() {
  // Initialize navigation and Studio pipeline page controllers immediately
  // (do not block tab switching or deep-link routing on /api/probe-encoder)
  initVoiceoverUI();
  initTimingUI();
  initPromptsUI();
  initImagesUI();

  // Initialize Studio waveform & scrubbing
  const waveformEl = $('timeline-canvas') || $('waveform-canvas');
  if (waveformEl) renderWaveform(waveformEl, null, 0);
  setupTimelineScrubbing();

  try {
    // Load settings
    const settings = await api('GET', '/api/settings');
    state.settings = settings;
    applySettings(settings);
  } catch (err) {
    console.warn('Could not load settings:', err);
  }

  try {
    // Probe encoder
    const enc = await api('GET', '/api/probe-encoder');
    if ($('encoder-badge')) $('encoder-badge').textContent = enc.label || 'CPU (libx264)';
  } catch {}

  try {
    // Load history count
    const history = await api('GET', '/api/history');
    if (history && history.length && $('btn-history')) {
      const span = $('btn-history').querySelector('span');
      if (span) span.textContent = `History (${history.length})`;
    }
  } catch {}
}

// ── Studio Hand-Off Voiceover Setter ────────────────────────────────────────
window.setStudioVoiceoverFile = async (file) => {
  if (!file) return;
  if ($('voiceover-name')) $('voiceover-name').textContent = `Uploading ${file.name}...`;
  const formData = new FormData();
  formData.append('audio', file, file.name);
  try {
    const res = await fetch('/api/upload-audio', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.ok) {
      state.voiceover = { file, path: data.path, duration: data.duration, name: data.name };
      if ($('voiceover-name')) $('voiceover-name').textContent = `${data.name} (${formatTime(data.duration)})`;
      if ($('btn-remove-voiceover')) $('btn-remove-voiceover').classList.remove('hidden');
      const canvas = $('timeline-canvas') || $('waveform-canvas');
      if (canvas) await renderWaveform(canvas, file, state.totalDuration || data.duration);
      initTimelineAudio();
      updateTimeline();
    }
  } catch (err) {
    console.warn('Voiceover set failed:', err);
  }
};

// ── Check Image Block Sync Warning ─────────────────────────────────────────
function checkImageBlockSync() {
  const container = $('block-sync-warning');
  if (!container) return;

  const scriptText = $('caption-text')?.value || '';
  if (!scriptText.trim() || !state.files.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  // Parse caption timestamps (m:ss)
  const lines = scriptText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const timeRegex = /\((\d+):(\d{2})(?::(\d{2}))?\)/;
  const blocks = [];

  for (const line of lines) {
    const m = line.match(timeRegex);
    if (m) {
      const sec = m[3] !== undefined
        ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
        : parseInt(m[1]) * 60 + parseInt(m[2]);
      blocks.push(sec);
    }
  }

  if (blocks.length === 0) {
    container.classList.add('hidden');
    return;
  }

  // Build expected filenames list
  const expectedFilenames = [];
  for (let i = 0; i < blocks.length; i++) {
    const start = blocks[i];
    const end = (i < blocks.length - 1) ? blocks[i + 1] : start + 3;
    expectedFilenames.push(getBlockFilename(start, end));
  }

  const loadedNames = new Set(state.files.map(f => f.name.toLowerCase()));
  const missing = expectedFilenames.filter(f => !loadedNames.has(f.toLowerCase()));
  const expectedSet = new Set(expectedFilenames.map(f => f.toLowerCase()));
  const unmatched = state.files.filter(f => !expectedSet.has(f.name.toLowerCase())).map(f => f.name);

  if (!missing.length && !unmatched.length) {
    container.innerHTML = `
      <div class="sync-alert sync-alert-success">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>All ${expectedFilenames.length} caption blocks match loaded images perfectly.</span>
      </div>
    `;
    container.classList.remove('hidden');
  } else {
    let html = '';
    if (missing.length) {
      html += `
        <div class="sync-alert sync-alert-warning">
          <div class="sync-alert-title" style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <strong>Missing images for ${missing.length} block${missing.length > 1 ? 's' : ''}:</strong>
          </div>
          <div class="sync-tags-wrap">
            ${missing.slice(0, 15).map(m => `<span class="missing-chip">${m}</span>`).join('')}
            ${missing.length > 15 ? `<span class="more-chip">+${missing.length - 15} more</span>` : ''}
          </div>
        </div>
      `;
    }
    if (unmatched.length) {
      html += `
        <div class="sync-alert sync-alert-info">
          <div class="sync-alert-title" style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <strong>${unmatched.length} loaded file${unmatched.length > 1 ? 's' : ''} do not match any caption block:</strong>
          </div>
          <div class="sync-tags-wrap">
            ${unmatched.slice(0, 15).map(u => `<span class="unmatched-chip">${u}</span>`).join('')}
            ${unmatched.length > 15 ? `<span class="more-chip">+${unmatched.length - 15} more</span>` : ''}
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
    container.classList.remove('hidden');
  }
}

init();
