/**
 * timing_ui.js — UI Controller for SceneFlow Timing
 */

import {
  splitTranscript,
  validateRules,
  getBlockFilename,
  formatCaptionTime,
  parseTimeString,
  exportCaptionsTxt,
  exportSRT,
  exportFilenamesListTxt,
  exportCSV,
  exportWordLevelJSON,
  exportBlocksJSON
} from './timing_client.js';

import {
  checkDeviceSupport,
  checkClientModelCached,
  loadWhisperModel,
  transcribeInBrowser
} from './whisper_browser.js';

// State for Timing engine
export const splitterState = {
  audioFile: null,
  audioPath: null,
  audioDuration: 0,
  words: [],          // Word-level timestamps: [{ word, start, end, probability }]
  blocks: [],         // Split blocks: [{ number, filename, start, end, caption, silent }]
  model: 'fast',      // 'fast' (base) or 'best' (small)
  language: 'auto',
  mode: '3s',         // '3s' | '5s' | 'sentences' | 'custom'
  avoidMidSentenceCut: true,
  pauseThreshold: 0.6,
  minSentenceBlockSec: 2,
  maxSentenceBlockSec: 8,
  rules: [
    { from: '0:00', to: '1:00', mode: '3s' },
    { from: '1:00', to: '3:00', mode: '5s' }
  ],
  defaultRestMode: '3s',
  modelsStatus: null,
  whisperEnv: null,
  activeTranscribeJobId: null,
  activeTranscribeEventSource: null
};

// DOM helper
const $ = (id) => document.getElementById(id);

let modelStatusPromise = null;

function sanitizeProgressText(msg) {
  return String(msg || '').replace(/\b(faster[- ]?)?whisper\b/gi, 'SceneFlow AI');
}

function setSegmentedActive(btns, activeBtn) {
  btns.forEach(b => {
    const isCurrent = b === activeBtn;
    b.classList.toggle('active', isCurrent);
    b.classList.toggle('bg-[#14B8A6]', isCurrent);
    b.classList.toggle('text-[#0B0F14]', isCurrent);
    b.classList.toggle('font-bold', isCurrent);
    b.classList.toggle('text-slate-400', !isCurrent);
  });
}

export function initTimingUI() {
  bindNavTabs();
  bindModelControls();
  bindModeControls();
  bindAudioInputs();
  bindCustomRules();
  bindActionButtons();
  bindExports();
  modelStatusPromise = checkModelStatus();
}

export const initSplitterUI = initTimingUI;

// ─── 1. Navigation Between SceneFlow Pages ──────────────────────────────────

const LEGACY_TAB_MAP = {
  'vo-hunter': 'voice',
  'voiceover': 'voice',
  'voice': 'voice',
  'script-splitter': 'timing',
  'script-hunter': 'timing',
  'timing': 'timing',
  'prompt': 'prompts',
  'prompt-hunter': 'prompts',
  'prompt-mapper': 'prompts',
  'prompts': 'prompts',
  'image': 'images',
  'image-batch': 'images',
  'images': 'images',
  'frame-hunter': 'studio',
  'studio': 'studio'
};

const TAB_META = {
  voice: { btnId: 'nav-btn-voice', pageId: 'page-voice', route: '/voice', title: 'SceneFlow — Voice', idleIconClass: 'text-[#8A99A8]' },
  timing: { btnId: 'nav-btn-timing', pageId: 'page-timing', route: '/timing', title: 'SceneFlow — Timing', idleIconClass: 'text-[#8A99A8]' },
  prompts: { btnId: 'nav-btn-prompts', pageId: 'page-prompts', route: '/prompts', title: 'SceneFlow — Prompts', idleIconClass: 'text-[#8A99A8]' },
  images: { btnId: 'nav-btn-images', pageId: 'page-images', route: '/images', title: 'SceneFlow — Images', idleIconClass: 'text-[#8A99A8]' },
  studio: { btnId: 'nav-btn-studio', pageId: 'page-studio', route: '/studio', title: 'SceneFlow — Studio', idleIconClass: 'text-[#8A99A8]' }
};

export function resolveTabTarget(raw) {
  if (!raw || typeof raw !== 'string') return 'voice';
  const clean = raw.replace(/^[/#]+/, '').replace(/\/+$/, '').toLowerCase();
  return LEGACY_TAB_MAP[clean] || 'voice';
}

function bindNavTabs() {
  const brandLogoBtn = $('brand-logo-btn');

  function switchTab(rawTarget, updateUrl = true) {
    const target = resolveTabTarget(rawTarget);

    // Reset all 5 tabs & hide all 5 pages
    Object.values(TAB_META).forEach(({ btnId, pageId, idleIconClass }) => {
      const btn = $(btnId);
      const page = $(pageId);
      if (btn) {
        btn.classList.remove('active', 'bg-brand-primary', 'bg-[#14B8A6]', 'text-white', 'text-[#0B0F14]', 'font-bold', 'shadow-glow-subtle');
        btn.classList.add('text-[#8A99A8]', 'hover:text-[#E8EEF4]', 'hover:bg-[#1A2430]');
        const icon = btn.querySelector('svg');
        if (icon) {
          icon.classList.remove('text-white', 'text-[#0B0F14]');
          icon.classList.add(idleIconClass);
        }
      }
      if (page) page.classList.add('hidden');
    });

    const active = TAB_META[target] || TAB_META.voice;
    const activeBtn = $(active.btnId);
    const activePage = $(active.pageId);

    if (activeBtn) {
      activeBtn.classList.add('active', 'bg-[#14B8A6]', 'text-[#0B0F14]', 'font-bold', 'shadow-glow-subtle');
      activeBtn.classList.remove('text-[#8A99A8]', 'hover:text-[#E8EEF4]', 'hover:bg-[#1A2430]');
      const icon = activeBtn.querySelector('svg');
      if (icon) {
        icon.classList.remove(active.idleIconClass);
        icon.classList.add('text-[#0B0F14]');
      }
    }

    if (activePage) activePage.classList.remove('hidden');
    if (typeof document !== 'undefined') document.title = active.title;

    if (updateUrl && typeof window !== 'undefined' && window.history) {
      const targetUrl = active.route;
      if (window.location.pathname !== targetUrl || window.location.hash) {
        window.history.replaceState({ tab: target }, '', targetUrl);
      }
    }
  }

  window.switchToTab = switchTab;

  Object.entries(TAB_META).forEach(([tabKey, { btnId }]) => {
    const btn = $(btnId);
    if (btn) {
      btn.onclick = (e) => {
        if (e) e.preventDefault();
        switchTab(tabKey);
      };
    }
  });

  if (brandLogoBtn) {
    brandLogoBtn.onclick = () => switchTab('voice');
  }

  function resolveInitialFromLocation() {
    if (window.location.hash) {
      return resolveTabTarget(window.location.hash);
    }
    if (window.location.pathname && window.location.pathname !== '/') {
      return resolveTabTarget(window.location.pathname);
    }
    return 'voice';
  }

  window.addEventListener('hashchange', () => {
    switchTab(resolveTabTarget(window.location.hash || window.location.pathname));
  });

  window.addEventListener('popstate', () => {
    switchTab(resolveTabTarget(window.location.hash || window.location.pathname), false);
  });

  // Initial route on load (defaults / -> Voice)
  switchTab(resolveInitialFromLocation());

  // Expose helper to share captions with Prompts page
  window.getTimingCaptionsTxt = () => {
    if (splitterState.blocks && splitterState.blocks.length > 0) {
      return exportCaptionsTxt(splitterState.blocks);
    }
    return '';
  };
  window.getSplitterCaptionsTxt = window.getTimingCaptionsTxt;
}

// ─── 2. Model & Accuracy Controls ────────────────────────────────────────────

async function checkModelStatus() {
  try {
    splitterState.fastCached = await checkClientModelCached('fast');
    splitterState.bestCached = await checkClientModelCached('best');
  } catch {}

  try {
    const res = await fetch('/api/whisper/status').then(r => r.json());
    splitterState.modelsStatus = res.models;
    splitterState.whisperEnv = res.env;
  } catch (err) {
    console.warn('Could not check AI engine status:', err);
  }
  renderModelStatusCard();
}

function bindModelControls() {
  const modelBtns = document.querySelectorAll('#sp-model-segmented .seg-btn');
  modelBtns.forEach(btn => {
    btn.onclick = async () => {
      setSegmentedActive(modelBtns, btn);
      splitterState.model = btn.getAttribute('data-model');
      renderModelStatusCard();
      try {
        if (modelStatusPromise) await modelStatusPromise;
        if (splitterState.model === 'fast') {
          splitterState.fastCached = await checkClientModelCached('fast');
        } else {
          splitterState.bestCached = await checkClientModelCached('best');
        }
      } catch {}
      renderModelStatusCard();
    };
  });

  const langSelect = $('sp-language');
  if (langSelect) {
    langSelect.onchange = (e) => {
      splitterState.language = e.target.value;
    };
  }
}

function renderModelStatusCard() {
  const container = $('sp-model-status');
  const dotFast = $('dot-model-fast');
  const dotBest = $('dot-model-best');

  // Update readiness dots on Fast and Best buttons
  const isFastDownloaded = Boolean((splitterState.modelsStatus && splitterState.modelsStatus['fast']?.downloaded) || splitterState.fastCached);
  const isBestDownloaded = Boolean((splitterState.modelsStatus && splitterState.modelsStatus['best']?.downloaded) || splitterState.bestCached);

  if (dotFast) {
    dotFast.className = isFastDownloaded ? 'model-dot ready' : 'model-dot not-downloaded';
    dotFast.title = isFastDownloaded ? 'Fast model downloaded & ready' : 'Fast model (~145 MB)';
  }

  if (dotBest) {
    dotBest.className = isBestDownloaded ? 'model-dot ready' : 'model-dot not-downloaded';
    dotBest.title = isBestDownloaded ? 'Best model downloaded & ready' : 'Best model (~470 MB)';
  }

  if (!container) return;

  // Do not flash download prompt before initial status check completes
  if (!splitterState.modelsStatus && !splitterState.fastCached && !splitterState.bestCached) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  const modelKey = splitterState.model || 'fast';
  const approxMb = modelKey === 'best' ? 470 : 145;
  const isCurrentDownloaded = modelKey === 'best' ? isBestDownloaded : isFastDownloaded;

  // Hide download button & prompt completely whenever the selected model is already downloaded
  if (isCurrentDownloaded) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="model-download-prompt">
      <span class="prompt-text">Downloads once (about ${approxMb} MB) on first use</span>
      <button type="button" id="btn-download-model-now" class="btn btn-secondary btn-xs">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        <span>Download now</span>
      </button>
    </div>
    <div id="sp-download-progress-box" class="download-progress-box hidden">
      <div class="d-prog-header">
        <span id="sp-dl-text">Preparing ${modelKey === 'best' ? 'Best' : 'Fast'} model…</span>
        <button type="button" id="btn-cancel-dl-model" class="btn btn-ghost btn-xs">Cancel</button>
      </div>
      <div class="progress-bar-wrap" style="height: 6px; margin: 4px 0;">
        <div id="sp-dl-bar" class="progress-bar" style="width: 0%;"></div>
      </div>
      <div class="d-prog-meta">
        <span id="sp-dl-pct">0%</span>
        <span id="sp-dl-mb" class="hidden"></span>
      </div>
    </div>
  `;

  const btnDl = $('btn-download-model-now');
  if (btnDl) btnDl.onclick = () => startModelDownload(splitterState.model);
}

async function startModelDownload(modelKey) {
  const box = $('sp-download-progress-box');
  const btnDl = $('btn-download-model-now');
  const modelLabel = modelKey === 'best' ? 'Best' : 'Fast';
  const approxMb = modelKey === 'best' ? 470 : 145;
  if (box) box.classList.remove('hidden');
  if (btnDl) btnDl.classList.add('hidden');
  if ($('sp-dl-text')) $('sp-dl-text').textContent = `Preparing ${modelLabel} model…`;
  if ($('sp-dl-mb')) {
    $('sp-dl-mb').textContent = '';
    $('sp-dl-mb').classList.add('hidden');
  }

  // If local backend AI engine is available, download cleanly to server models directory
  if (splitterState.whisperEnv?.ready) {
    try {
      await fetch('/api/whisper/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelKey })
      });
      await new Promise((resolve, reject) => {
        const es = new EventSource(`/api/whisper/download/${modelKey}/progress`);
        const btnCancel = $('btn-cancel-dl-model');
        if (btnCancel) {
          btnCancel.onclick = () => {
            fetch('/api/whisper/download/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: modelKey })
            }).catch(() => {});
            es.close();
            resolve();
          };
        }
        es.onmessage = (e) => {
          try {
            const p = JSON.parse(e.data);
            if (p.type === 'progress') {
              const hasMb = Number(p.mbDownloaded) > 0;
              if ($('sp-dl-bar')) $('sp-dl-bar').style.width = `${p.percent || 0}%`;
              if ($('sp-dl-pct')) $('sp-dl-pct').textContent = `${p.percent || 0}%`;
              if (hasMb) {
                if ($('sp-dl-text')) $('sp-dl-text').textContent = `Downloading ${modelLabel} model…`;
                if ($('sp-dl-mb')) {
                  $('sp-dl-mb').classList.remove('hidden');
                  $('sp-dl-mb').textContent = `${p.mbDownloaded} / ${p.mbTotal || approxMb} MB`;
                }
              } else {
                if ($('sp-dl-text')) $('sp-dl-text').textContent = `Preparing ${modelLabel} model…`;
                if ($('sp-dl-mb')) {
                  $('sp-dl-mb').textContent = '';
                  $('sp-dl-mb').classList.add('hidden');
                }
              }
            } else if (p.type === 'done') {
              es.close();
              resolve();
            } else if (p.type === 'error') {
              es.close();
              reject(new Error(p.message || 'Download error'));
            }
          } catch {}
        };
        es.onerror = () => { es.close(); reject(new Error('Download stream interrupted')); };
      });
      await checkModelStatus();
      return;
    } catch (err) {
      console.warn('Server model download fallback:', err);
    }
  }

  try {
    await loadWhisperModel(modelKey, (p) => {
      if (p.isDownloading) {
        if ($('sp-dl-text')) $('sp-dl-text').textContent = `Downloading ${modelLabel} model…`;
        if ($('sp-dl-bar')) $('sp-dl-bar').style.width = `${p.percent}%`;
        if ($('sp-dl-pct')) $('sp-dl-pct').textContent = `${p.percent}%`;
        if ($('sp-dl-mb')) {
          $('sp-dl-mb').classList.remove('hidden');
          $('sp-dl-mb').textContent = `${p.mbDownloaded} / ${p.mbTotal} MB`;
        }
      } else {
        if ($('sp-dl-text')) $('sp-dl-text').textContent = `Preparing ${modelLabel} model…`;
        if ($('sp-dl-mb')) {
          $('sp-dl-mb').textContent = '';
          $('sp-dl-mb').classList.add('hidden');
        }
      }
    });
    if (modelKey === 'best') splitterState.bestCached = true;
    else splitterState.fastCached = true;
    renderModelStatusCard();
  } catch (err) {
    console.warn('Client-side model download warning:', err);
    renderModelStatusCard();
  }
}

// ─── 3. Split Mode Selector & Custom Rules ────────────────────────────────────

function bindModeControls() {
  const modeBtns = document.querySelectorAll('#sp-mode-segmented .seg-btn');
  modeBtns.forEach(btn => {
    btn.onclick = () => {
      setSegmentedActive(modeBtns, btn);
      splitterState.mode = btn.getAttribute('data-mode');
      updateModeSuboptionsVisibility();
      reSplitIfWordsAvailable();
    };
  });

  const avoidCutCheck = $('sp-avoid-cut');
  if (avoidCutCheck) {
    avoidCutCheck.onchange = (e) => {
      splitterState.avoidMidSentenceCut = e.target.checked;
      reSplitIfWordsAvailable();
    };
  }

  const pauseSlider = $('sp-pause-thresh');
  if (pauseSlider) {
    pauseSlider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      splitterState.pauseThreshold = val;
      $('val-pause-thresh').textContent = `${val.toFixed(1)}s`;
      reSplitIfWordsAvailable();
    };
  }

  const minSentence = $('sp-min-sentence-dur');
  if (minSentence) {
    minSentence.onchange = (e) => {
      splitterState.minSentenceBlockSec = parseInt(e.target.value);
      reSplitIfWordsAvailable();
    };
  }

  const maxSentence = $('sp-max-sentence-dur');
  if (maxSentence) {
    maxSentence.onchange = (e) => {
      splitterState.maxSentenceBlockSec = parseInt(e.target.value);
      reSplitIfWordsAvailable();
    };
  }

  const defaultRest = $('sp-default-rest-mode');
  if (defaultRest) {
    defaultRest.onchange = (e) => {
      splitterState.defaultRestMode = e.target.value;
      reSplitIfWordsAvailable();
    };
  }
}

function updateModeSuboptionsVisibility() {
  const mode = splitterState.mode;
  $('sp-fixed-options').classList.toggle('hidden', mode !== '3s' && mode !== '5s');
  $('sp-sentence-options').classList.toggle('hidden', mode !== 'sentences');
  $('sp-custom-options').classList.toggle('hidden', mode !== 'custom');
  if (mode === 'custom') renderCustomRules();
}

function bindCustomRules() {
  const btnAdd = $('btn-add-rule');
  if (btnAdd) {
    btnAdd.onclick = () => {
      const lastRule = splitterState.rules[splitterState.rules.length - 1];
      const from = lastRule ? lastRule.to : '0:00';
      const to = from === 'end' ? 'end' : '1:00';
      splitterState.rules.push({ from, to, mode: '3s' });
      renderCustomRules();
      reSplitIfWordsAvailable();
    };
  }

  const presetSelect = $('sp-rule-presets');
  if (presetSelect) {
    presetSelect.onchange = (e) => {
      const val = e.target.value;
      if (val === 'fast_intro') {
        splitterState.rules = [
          { from: '0:00', to: '0:30', mode: '3s' },
          { from: '0:30', to: 'end', mode: '5s' }
        ];
      } else if (val === 'hook_body') {
        splitterState.rules = [
          { from: '0:00', to: '0:15', mode: '3s' },
          { from: '0:15', to: 'end', mode: 'sentences' }
        ];
      }
      renderCustomRules();
      reSplitIfWordsAvailable();
    };
  }

  const btnSavePreset = $('btn-save-rule-preset');
  if (btnSavePreset) {
    btnSavePreset.onclick = () => {
      const name = prompt('Enter a name for this custom rule preset:');
      if (name) {
        // Kept 'sp_preset_' localStorage key prefix so saved user rule presets survive the SceneFlow rename
        localStorage.setItem(`sp_preset_${name}`, JSON.stringify(splitterState.rules));
        alert(`Preset '${name}' saved.`);
      }
    };
  }
}

function renderCustomRules() {
  const list = $('rules-list');
  const errBox = $('rules-overlap-error');
  if (!list) return;

  const validation = validateRules(splitterState.rules, splitterState.audioDuration);
  if (!validation.valid) {
    errBox.classList.remove('hidden');
    errBox.innerHTML = validation.errors.map(e => `<div>⚠️ ${e.message}</div>`).join('');
  } else {
    errBox.classList.add('hidden');
    errBox.innerHTML = '';
  }

  list.innerHTML = '';
  splitterState.rules.forEach((r, idx) => {
    const isError = validation.errors.some(e => e.index === idx);
    const row = document.createElement('div');
    row.className = `rule-row ${isError ? 'rule-row-error' : ''}`;
    row.innerHTML = `
      <span class="rule-num">#${idx + 1}</span>
      <div class="rule-input-group">
        <label>From</label>
        <input type="text" class="text-input rule-from bg-[#0B0F14] text-[#E8EEF4] border border-[#202B36] rounded px-2 py-1 text-xs focus:border-[#14B8A6] focus:outline-none" value="${r.from}" placeholder="0:00">
      </div>
      <div class="rule-input-group">
        <label>To</label>
        <input type="text" class="text-input rule-to bg-[#0B0F14] text-[#E8EEF4] border border-[#202B36] rounded px-2 py-1 text-xs focus:border-[#14B8A6] focus:outline-none" value="${r.to}" placeholder="end">
      </div>
      <div class="rule-input-group">
        <label>Mode</label>
        <select class="form-select rule-mode bg-[#0B0F14] text-[#E8EEF4] border border-[#202B36] rounded px-2 py-1 text-xs focus:border-[#14B8A6] focus:outline-none">
          <option value="3s" ${r.mode === '3s' ? 'selected' : ''}>3s</option>
          <option value="5s" ${r.mode === '5s' ? 'selected' : ''}>5s</option>
          <option value="sentences" ${r.mode === 'sentences' ? 'selected' : ''}>Sentence</option>
          <option value="1s" ${r.mode === '1s' ? 'selected' : ''}>1s</option>
          <option value="2s" ${r.mode === '2s' ? 'selected' : ''}>2s</option>
          <option value="4s" ${r.mode === '4s' ? 'selected' : ''}>4s</option>
          <option value="8s" ${r.mode === '8s' ? 'selected' : ''}>8s</option>
          <option value="10s" ${r.mode === '10s' ? 'selected' : ''}>10s</option>
        </select>
      </div>
      <button type="button" class="btn btn-icon btn-ghost btn-xs btn-del-rule" title="Delete rule">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    `;

    row.querySelector('.rule-from').onchange = (e) => {
      r.from = e.target.value.trim();
      renderCustomRules();
      reSplitIfWordsAvailable();
    };
    row.querySelector('.rule-to').onchange = (e) => {
      r.to = e.target.value.trim();
      renderCustomRules();
      reSplitIfWordsAvailable();
    };
    row.querySelector('.rule-mode').onchange = (e) => {
      r.mode = e.target.value;
      renderCustomRules();
      reSplitIfWordsAvailable();
    };
    row.querySelector('.btn-del-rule').onclick = () => {
      splitterState.rules.splice(idx, 1);
      renderCustomRules();
      reSplitIfWordsAvailable();
    };

    list.appendChild(row);
  });

  renderPlanBar();
}

function renderPlanBar() {
  const bar = $('sp-plan-bar');
  if (!bar) return;
  const dur = splitterState.audioDuration || 60;
  bar.innerHTML = '';

  const validation = validateRules(splitterState.rules, dur);
  const activeRules = validation.parsed || [];

  let cur = 0;
  const segments = [];
  for (const r of activeRules) {
    const from = Math.min(dur, Math.max(0, r.from));
    const to = Math.min(dur, Math.max(from, r.to === Infinity ? dur : r.to));
    if (from > cur) segments.push({ from: cur, to: from, mode: splitterState.defaultRestMode });
    segments.push({ from, to, mode: r.mode });
    cur = to;
  }
  if (cur < dur) segments.push({ from: cur, to: dur, mode: splitterState.defaultRestMode });

  for (const seg of segments) {
    const segDur = seg.to - seg.from;
    const pct = Math.max(1, (segDur / dur) * 100);
    const item = document.createElement('div');
    item.className = `plan-seg seg-mode-${seg.mode}`;
    item.style.width = `${pct}%`;
    item.title = `${formatCaptionTime(seg.from)} - ${formatCaptionTime(seg.to)} (${seg.mode})`;
    bar.appendChild(item);
  }
}

// ─── 4. Voiceover & Audio Inputs ─────────────────────────────────────────────

function bindAudioInputs() {
  const dropzone = $('sp-audio-dropzone');
  const fileInput = $('sp-audio-file-input');

  if (dropzone && fileInput) {
    dropzone.onclick = () => fileInput.click();

    dropzone.ondragover = (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-active');
    };
    dropzone.ondragleave = () => dropzone.classList.remove('drag-active');
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-active');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleAudioSelected(e.dataTransfer.files[0]);
      }
    };

    fileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleAudioSelected(e.target.files[0]);
      }
    };
  }

  // Custom Audio Player Wire-up
  const audioEl = $('sp-audio-el');
  const playBtn = $('sp-audio-play-btn');
  const playIcon = $('sp-play-icon');
  const pauseIcon = $('sp-pause-icon');
  const timeCurr = $('sp-audio-time-curr');
  const scrubWrap = $('sp-audio-scrub-wrap');
  const scrubFill = $('sp-audio-scrub-fill');

  if (playBtn && audioEl) {
    playBtn.onclick = () => {
      if (audioEl.paused) {
        audioEl.play();
      } else {
        audioEl.pause();
      }
    };

    audioEl.onplay = () => {
      if (playIcon) playIcon.classList.add('hidden');
      if (pauseIcon) pauseIcon.classList.remove('hidden');
    };

    audioEl.onpause = () => {
      if (playIcon) playIcon.classList.remove('hidden');
      if (pauseIcon) pauseIcon.classList.add('hidden');
    };

    audioEl.ontimeupdate = () => {
      if (timeCurr) timeCurr.textContent = formatCaptionTime(audioEl.currentTime).replace(/[()]/g, '');
      if (scrubFill && audioEl.duration) {
        const pct = (audioEl.currentTime / audioEl.duration) * 100;
        scrubFill.style.width = `${pct}%`;
        scrubFill.classList.toggle('hidden', pct <= 0.1);
      }
    };

    audioEl.onended = () => {
      if (playIcon) playIcon.classList.remove('hidden');
      if (pauseIcon) pauseIcon.classList.add('hidden');
      if (scrubFill) {
        scrubFill.style.width = '0%';
        scrubFill.classList.add('hidden');
      }
    };

    if (scrubWrap) {
      scrubWrap.onclick = (e) => {
        if (!audioEl.duration) return;
        const rect = scrubWrap.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        audioEl.currentTime = pct * audioEl.duration;
      };
    }
  }

  const btnRemoveAudio = $('btn-remove-audio');
  if (btnRemoveAudio) {
    btnRemoveAudio.onclick = clearTimingAudio;
  }

  // Paste Script button (replaces Upload SRT/VTT)
  const btnPasteScript = $('btn-paste-script');
  const scriptText = $('sp-script-text');
  const scriptStatus = $('sp-script-status');
  if (btnPasteScript && scriptText) {
    btnPasteScript.onclick = async () => {
      try {
        const clip = navigator.clipboard && navigator.clipboard.readText
          ? await navigator.clipboard.readText()
          : '';
        if (clip && clip.trim()) {
          scriptText.value = clip.trim();
          scriptText.dispatchEvent(new Event('input', { bubbles: true }));
          if (scriptStatus) scriptStatus.textContent = '✓ Script pasted from clipboard.';
          return;
        }
      } catch {}
      scriptText.focus();
      if (scriptStatus) scriptStatus.textContent = 'Paste your script directly here (Ctrl+V).';
    };
  }

  // Textarea input
  if (scriptText) {
    scriptText.oninput = () => {
      const val = scriptText.value.trim();
      if (val.includes('(') && val.includes(')')) {
        parseAlternativeInput(val, 'script');
      } else if (scriptStatus && !val) {
        scriptStatus.textContent = '';
      }
    };
  }
}

function clearTimingAudio() {
  const audioEl = $('sp-audio-el');
  const playIcon = $('sp-play-icon');
  const pauseIcon = $('sp-pause-icon');
  const scrubFill = $('sp-audio-scrub-fill');

  if (audioEl) {
    try { audioEl.pause(); } catch {}
    audioEl.removeAttribute('src');
    audioEl.load();
  }
  if (playIcon) playIcon.classList.remove('hidden');
  if (pauseIcon) pauseIcon.classList.add('hidden');
  if (scrubFill) {
    scrubFill.style.width = '0%';
    scrubFill.classList.add('hidden');
  }
  splitterState.audioFile = null;
  splitterState.audioPath = null;
  splitterState.audioDuration = 0;
  if ($('sp-audio-player-wrap')) $('sp-audio-player-wrap').classList.add('hidden');
  if ($('sp-audio-dropzone')) $('sp-audio-dropzone').classList.remove('hidden');
  if ($('sp-waveform-bars')) $('sp-waveform-bars').innerHTML = '';
}

function renderTimingWaveformBars(heights = null) {
  const container = $('sp-waveform-bars');
  if (!container) return;

  const fallback = [
    14, 22, 34, 40, 26, 36, 18, 28, 40, 32, 24, 30,
    38, 16, 32, 40, 24, 34, 20, 32, 40, 18, 28, 36,
    20, 30, 40, 36, 22, 34, 18, 30, 40, 32, 24, 28,
    38, 16, 28, 40, 22, 32, 18, 28, 36, 16, 24, 30
  ];
  const bars = Array.isArray(heights) && heights.length ? heights : fallback;

  container.innerHTML = bars
    .map(h => `<span class="w-1 bg-[#14B8A6] rounded-full" style="height: ${Math.max(8, Math.min(40, Math.round(h)))}px;"></span>`)
    .join('');
}

async function decodeTimingWaveformPeaks(file, bucketCount = 48) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !file) return;
    const buf = await file.arrayBuffer();
    const ctx = new AudioCtx();
    const audioBuf = await ctx.decodeAudioData(buf);
    const ch = audioBuf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / bucketCount));
    const peaks = [];
    for (let i = 0; i < bucketCount; i++) {
      let maxAmp = 0;
      const start = i * step;
      const end = Math.min(ch.length, start + step);
      for (let j = start; j < end; j += Math.max(1, Math.floor(step / 64))) {
        const a = Math.abs(ch[j]);
        if (a > maxAmp) maxAmp = a;
      }
      peaks.push(10 + Math.round(maxAmp * 30));
    }
    try { await ctx.close(); } catch {}
    // Ensure we still belong to the same audio file
    if (splitterState.audioFile === file) {
      renderTimingWaveformBars(peaks);
    }
  } catch {}
}

async function handleAudioSelected(file) {
  splitterState.audioFile = file;
  splitterState.audioFileName = file.name;
  const formData = new FormData();
  formData.append('audio', file);

  $('sp-audio-name').textContent = file.name;
  $('sp-audio-dropzone').classList.add('hidden');
  $('sp-audio-player-wrap').classList.remove('hidden');

  const scrubFill = $('sp-audio-scrub-fill');
  if (scrubFill) {
    scrubFill.style.width = '0%';
    scrubFill.classList.add('hidden');
  }
  renderTimingWaveformBars();
  decodeTimingWaveformPeaks(file);

  // Preview locally in audio element
  const audioEl = $('sp-audio-el');
  audioEl.src = URL.createObjectURL(file);
  audioEl.onloadedmetadata = () => {
    splitterState.audioDuration = audioEl.duration;
    const durStr = formatCaptionTime(audioEl.duration).replace(/[()]/g, '');
    if ($('sp-audio-dur')) $('sp-audio-dur').textContent = durStr;
    if ($('sp-audio-time-total')) $('sp-audio-time-total').textContent = durStr;
    if ($('sp-audio-time-curr')) $('sp-audio-time-curr').textContent = '0:00';
    renderPlanBar();
  };

  splitterState.uploadPromise = fetch('/api/timing/upload-audio', {
    method: 'POST',
    body: formData
  }).then(r => r.json()).then(res => {
    if (res.ok) {
      splitterState.audioPath = res.path;
      if (res.durationSec) {
        splitterState.audioDuration = res.durationSec;
        const durStr = formatCaptionTime(res.durationSec).replace(/[()]/g, '');
        if ($('sp-audio-dur')) $('sp-audio-dur').textContent = durStr;
        if ($('sp-audio-time-total')) $('sp-audio-time-total').textContent = durStr;
        renderPlanBar();
      }
    }
    return res;
  }).catch(err => {
    console.warn('Audio upload warning:', err);
  });
}

// Expose handleAudioSelected so Voice page can pass synthesized audio directly to Timing
if (typeof window !== 'undefined') {
  window.__loadTimingAudio = handleAudioSelected;
  window.__loadSplitterAudio = handleAudioSelected;
}

async function parseAlternativeInput(text, type) {
  try {
    const res = await fetch('/api/timing/parse-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        type,
        durationSec: splitterState.audioDuration
      })
    }).then(r => r.json());

    if (res.ok && res.words && res.words.length) {
      splitterState.words = res.words;
      $('sp-script-status').textContent = `Loaded ${res.wordCount} timed words from ${type.toUpperCase()}.`;
      executeSplitting();
    }
  } catch (err) {
    console.warn('Error parsing alternative input:', err);
  }
}

// ─── 5. Trigger Transcription & Splitting ─────────────────────────────────────

function bindActionButtons() {
  const btnGetTimestamps = $('btn-get-timestamps');
  if (btnGetTimestamps) {
    btnGetTimestamps.onclick = async () => {
      if (!splitterState.audioPath && !splitterState.audioFile) {
        // If user provided script or SRT text directly
        const scriptVal = $('sp-script-text').value.trim();
        if (scriptVal) {
          parseAlternativeInput(scriptVal, 'script');
          return;
        }
        alert('Please choose or drop a voiceover audio file first.');
        return;
      }

      runTranscription();
    };
  }

  // Reset
  const btnClear = $('btn-clear-splitter');
  if (btnClear) {
    btnClear.onclick = () => {
      splitterState.words = [];
      splitterState.blocks = [];
      if ($('sp-results-card')) $('sp-results-card').classList.add('hidden');
      if ($('sp-progress-card')) $('sp-progress-card').classList.add('hidden');
      if ($('sp-detected-lang')) $('sp-detected-lang').classList.add('hidden');
      if ($('sp-script-text')) $('sp-script-text').value = '';
      if ($('sp-script-status')) $('sp-script-status').textContent = '';
      clearTimingAudio();
    };
  }
}

async function runTranscription() {
  const progCard = $('sp-progress-card');
  const progBar = $('sp-progress-bar');
  const progText = $('sp-progress-status-text');
  const progEta = $('sp-progress-eta');
  const progPct = $('sp-progress-pct');
  const progProcessed = $('sp-progress-processed');

  progCard.classList.remove('hidden');
  progBar.style.width = '0%';
  progPct.textContent = '0%';
  progText.textContent = 'Preparing audio...';
  progEta.textContent = 'ETA: calculating…';
  progProcessed.textContent = '0.0s / 0.0s';

  if (modelStatusPromise) {
    try { await modelStatusPromise; } catch {}
  }

  const modelKey = splitterState.model || 'fast';
  const isWebDeployment = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  const isServerReady = Boolean(splitterState.whisperEnv?.ready);
  const isServerModelReady = Boolean(isServerReady && splitterState.modelsStatus?.[modelKey]?.downloaded);
  const isBrowserCached = modelKey === 'best' ? Boolean(splitterState.bestCached) : Boolean(splitterState.fastCached);

  // 1. In-browser Whisper transcription (Runs 100% locally in browser via WebGPU / WASM)
  // Always use browser Whisper on web deployments (Vercel) or when Python server backend is not ready, or when browser model is cached
  if (splitterState.audioFile && window.isSecureContext && (isWebDeployment || !isServerModelReady || isBrowserCached)) {
    try {
      progText.textContent = 'Preparing SceneFlow AI engine...';
      const clientResult = await transcribeInBrowser(
        splitterState.audioFile,
        { model: modelKey, language: splitterState.language },
        (p) => {
          if (p.percent !== undefined) {
            progBar.style.width = `${p.percent}%`;
            progPct.textContent = `${p.percent}%`;
          }
          if (p.text) progText.textContent = sanitizeProgressText(p.text);
          if (p.processedSec !== undefined && p.totalSec) {
            progProcessed.textContent = `${p.processedSec}s / ${p.totalSec}s`;
          }
          if (p.etaSec) progEta.textContent = `ETA: ${p.etaSec}s`;
        }
      );

      if (clientResult && clientResult.ok && clientResult.words && clientResult.words.length > 0) {
        progBar.style.width = '100%';
        progPct.textContent = '100%';
        progText.textContent = 'Completed! Formatting blocks...';
        setTimeout(() => {
          progCard.classList.add('hidden');
          splitterState.words = clientResult.words;
          if (clientResult.duration) splitterState.audioDuration = clientResult.duration;
          if (modelKey === 'best') splitterState.bestCached = true;
          else splitterState.fastCached = true;
          renderModelStatusCard();
          executeSplitting();
        }, 350);
        return;
      }
    } catch (clientErr) {
      console.warn('In-browser transcription error:', clientErr);
      if (isWebDeployment || !isServerReady) {
        progCard.classList.add('hidden');
        alert(`Transcription error: ${sanitizeProgressText(clientErr.message || 'Browser AI model failed')}. Please retry or paste your script/SRT.`);
        return;
      }
    }
  }

  // If on web deployment or Python backend is not ready, never attempt server Python fallback
  if (isWebDeployment || !isServerReady) {
    progCard.classList.add('hidden');
    alert('Browser AI transcription is not available on this device. Please paste a timestamped script or SRT text directly.');
    return;
  }

  // 2. Fallback: Backend transcription
  // If upload is in flight, wait for it
  if (splitterState.uploadPromise && !splitterState.audioPath) {
    progText.textContent = 'Uploading voiceover to server...';
    try {
      await splitterState.uploadPromise;
    } catch {}
  }

  // If still no audioPath, try uploading directly now
  if (!splitterState.audioPath && splitterState.audioFile) {
    progText.textContent = 'Uploading voiceover to server...';
    try {
      const formData = new FormData();
      formData.append('audio', splitterState.audioFile);
      const upRes = await fetch('/api/timing/upload-audio', {
        method: 'POST',
        body: formData
      }).then(r => r.json());
      if (upRes.ok && upRes.path) {
        splitterState.audioPath = upRes.path;
      }
    } catch {}
  }

  progText.textContent = 'Transcribing voiceover audio...';

  try {
    const startRes = await fetch('/api/timing/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioPath: splitterState.audioPath,
        fileName: splitterState.audioFileName || splitterState.audioFile?.name,
        model: splitterState.model,
        language: splitterState.language
      })
    }).then(r => r.json());

    if (!startRes.ok) throw new Error(startRes.error || 'Failed to start transcription');

    const jobId = startRes.jobId;
    splitterState.activeTranscribeJobId = jobId;

    const es = new EventSource(`/api/timing/transcribe/${jobId}/progress`);
    splitterState.activeTranscribeEventSource = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'progress') {
          const pct = Math.min(100, Math.max(0, msg.percent || 0));
          progBar.style.width = `${pct}%`;
          progPct.textContent = `${pct}%`;
          progProcessed.textContent = `${msg.processedSec}s / ${msg.totalSec}s`;
          if (msg.etaSec) progEta.textContent = `ETA: ${msg.etaSec}s`;
          progText.textContent = `Transcribing voiceover audio... (${msg.processedSec}s / ${msg.totalSec}s)`;
        } else if (msg.type === 'done') {
          es.close();
          progBar.style.width = '100%';
          progPct.textContent = '100%';
          progText.textContent = 'Completed! Formatting blocks...';
          setTimeout(() => {
            progCard.classList.add('hidden');
            splitterState.words = msg.words || [];
            if (msg.duration) splitterState.audioDuration = msg.duration;
            if (msg.language) {
              $('sp-detected-lang').textContent = `${msg.language.toUpperCase()} (auto)`;
              $('sp-detected-lang').classList.remove('hidden');
            }
            executeSplitting();
          }, 350);
        } else if (msg.type === 'error') {
          es.close();
          progCard.classList.add('hidden');
          alert(`Transcription error: ${sanitizeProgressText(msg.message)}`);
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      progCard.classList.add('hidden');
    };

  } catch (err) {
    progCard.classList.add('hidden');
    alert(`Could not start transcription: ${sanitizeProgressText(err.message)}`);
  }
}

// ─── 6. Execute Splitting & Render Results Table ──────────────────────────────

function reSplitIfWordsAvailable() {
  if (splitterState.words && splitterState.words.length) {
    executeSplitting();
  }
}

function executeSplitting() {
  const result = splitTranscript(
    splitterState.words,
    splitterState.audioDuration,
    {
      mode: splitterState.mode,
      avoidMidSentenceCut: splitterState.avoidMidSentenceCut,
      pauseThreshold: splitterState.pauseThreshold,
      minSentenceBlockSec: splitterState.minSentenceBlockSec,
      maxSentenceBlockSec: splitterState.maxSentenceBlockSec,
      rules: splitterState.rules,
      defaultRestMode: splitterState.defaultRestMode
    }
  );

  splitterState.blocks = result.blocks;
  renderResultsTable();
}

function renderResultsTable() {
  const resultsCard = $('sp-results-card');
  const tbody = $('sp-blocks-tbody');
  const liveCount = $('sp-live-count');

  if (!resultsCard || !tbody) return;
  resultsCard.classList.remove('hidden');

  const count = splitterState.blocks.length;
  liveCount.textContent = `${count} blocks, ${count} images needed`;

  tbody.innerHTML = '';

  splitterState.blocks.forEach((b, idx) => {
    const tr = document.createElement('tr');
    tr.className = b.silent ? 'block-row-silent hover:bg-obsidian-elevated/40 transition' : 'hover:bg-obsidian-elevated/40 transition';
    tr.innerHTML = `
      <td class="col-num py-2 px-3 font-mono text-slate-400 font-bold">${b.number}</td>
      <td class="col-time py-2 px-3 font-mono text-slate-300 text-xs">${formatCaptionTime(b.start)}</td>
      <td class="col-time py-2 px-3 font-mono text-slate-300 text-xs">${formatCaptionTime(b.end)}</td>
      <td class="col-caption py-2 px-3">
        <textarea class="caption-edit-input w-full bg-transparent text-slate-100 text-xs font-sans rounded px-2 py-1 border border-transparent hover:border-obsidian-border focus:border-teal-500 focus:bg-obsidian-elevated" rows="1">${b.caption || ''}</textarea>
        ${b.silent ? '<span class="silent-tag text-[10px] text-amber-400 font-mono ml-1">[Silent]</span>' : ''}
      </td>
      <td class="col-actions py-2 px-3 text-right">
        <div class="inline-flex items-center gap-1">
          <button type="button" class="btn btn-icon btn-ghost btn-xs btn-copy-block p-1.5 rounded hover:bg-obsidian-elevated text-slate-400 hover:text-white transition" title="Copy block caption">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
        </div>
      </td>
    `;

    // Live edit caption text with auto-height adjustment
    const txtArea = tr.querySelector('.caption-edit-input');
    function autoResize() {
      txtArea.style.height = 'auto';
      txtArea.style.height = Math.max(26, txtArea.scrollHeight) + 'px';
    }
    txtArea.oninput = (e) => {
      b.caption = e.target.value;
      b.silent = !b.caption.trim();
      autoResize();
    };
    setTimeout(autoResize, 0);

    // Copy caption
    tr.querySelector('.btn-copy-block').onclick = () => {
      const line = `${formatCaptionTime(b.start)} ${b.caption || ''}`;
      navigator.clipboard.writeText(line);
      showToast('Block caption copied!');
    };

    tbody.appendChild(tr);
  });
}

function mergeBlocks(idx) {
  if (idx >= splitterState.blocks.length - 1) return;
  const b1 = splitterState.blocks[idx];
  const b2 = splitterState.blocks[idx + 1];

  b1.end = b2.end;
  b1.filename = getBlockFilename(b1.start, b1.end);
  b1.caption = `${b1.caption || ''} ${b2.caption || ''}`.trim();
  b1.silent = !b1.caption;

  splitterState.blocks.splice(idx + 1, 1);
  // Re-number
  splitterState.blocks.forEach((b, i) => b.number = i + 1);
  renderResultsTable();
}

function splitSingleBlock(idx) {
  const b = splitterState.blocks[idx];
  const dur = b.end - b.start;
  if (dur < 2) {
    alert('Block is too short to split (under 2 seconds).');
    return;
  }
  const mid = Math.round(b.start + dur / 2);
  const origEnd = b.end;

  b.end = mid;
  b.filename = getBlockFilename(b.start, b.end);

  const words1 = [];
  const words2 = [];
  if (b.words) {
    b.words.forEach(w => {
      if (w.start < mid) words1.push(w);
      else words2.push(w);
    });
  }

  b.caption = words1.map(w => w.word).join(' ');
  b.silent = !b.caption.trim();

  const newBlock = {
    number: b.number + 1,
    filename: getBlockFilename(mid, origEnd),
    start: mid,
    end: origEnd,
    caption: words2.map(w => w.word).join(' '),
    silent: words2.length === 0,
    words: words2
  };

  splitterState.blocks.splice(idx + 1, 0, newBlock);
  splitterState.blocks.forEach((item, i) => item.number = i + 1);
  renderResultsTable();
}

// ─── 7. Exports & Hand-off to Studio ──────────────────────────────────────────

function bindExports() {
  // One-click copy captions
  const btnCopy = $('btn-copy-captions');
  if (btnCopy) {
    btnCopy.onclick = () => {
      const txt = exportCaptionsTxt(splitterState.blocks);
      navigator.clipboard.writeText(txt);
      showToast('All captions copied to clipboard!');
    };
  }

  // Export dropdown
  const btnExportDrop = $('btn-export-dropdown');
  const exportMenu = $('export-menu');
  if (btnExportDrop && exportMenu) {
    btnExportDrop.onclick = (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('hidden');
    };
    document.addEventListener('click', () => exportMenu.classList.add('hidden'));

    exportMenu.querySelectorAll('a').forEach(a => {
      a.onclick = async (e) => {
        e.preventDefault();
        const fmt = a.getAttribute('data-export');
        await triggerExportDownload(fmt);
      };
    });
  }

  // Send to Prompts
  const btnSend = $('btn-send-to-prompts') || $('btn-send-to-studio') || $('btn-send-to-frame-hunter');
  if (btnSend) {
    btnSend.onclick = () => {
      sendToPrompts();
    };
  }

  // Project Save & Reopen
  const btnSaveProj = $('btn-save-project');
  if (btnSaveProj) {
    btnSaveProj.onclick = () => {
      const projData = {
        type: 'sceneflow_timing_project',
        audioPath: splitterState.audioPath,
        audioDuration: splitterState.audioDuration,
        words: splitterState.words,
        blocks: splitterState.blocks,
        mode: splitterState.mode,
        model: splitterState.model,
        rules: splitterState.rules
      };
      const blob = new Blob([JSON.stringify(projData, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sceneflow_timing_project_${Date.now()}.json`;
      a.click();
    };
  }

  const btnOpenProj = $('btn-open-project');
  const inputOpenProj = $('input-open-project');
  if (btnOpenProj && inputOpenProj) {
    btnOpenProj.onclick = () => inputOpenProj.click();
    inputOpenProj.onchange = async (e) => {
      if (e.target.files && e.target.files[0]) {
        try {
          const text = await e.target.files[0].text();
          const p = JSON.parse(text);
          if (p.words) splitterState.words = p.words;
          if (p.audioDuration) splitterState.audioDuration = p.audioDuration;
          if (p.mode) splitterState.mode = p.mode;
          if (p.rules) splitterState.rules = p.rules;
          if (p.blocks) splitterState.blocks = p.blocks;
          renderResultsTable();
          showToast('Project loaded successfully!');
        } catch {
          alert('Invalid project JSON file.');
        }
      }
    };
  }
}

async function triggerExportDownload(format) {
  try {
    const res = await fetch('/api/timing/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: splitterState.blocks,
        words: splitterState.words,
        format
      })
    }).then(r => r.json());

    if (res.ok) {
      const blob = new Blob([res.content], { type: res.mimeType });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = res.filename;
      a.click();
    }
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
}

/**
 * Hand-off: Send timestamped captions to Prompts (and pre-sync Studio captions & voiceover)
 */
function sendToPrompts() {
  const captionsTxt = exportCaptionsTxt(splitterState.blocks);

  // 1. Fill Prompts' captions textarea
  const promptsInput = $('pr-captions-input');
  if (promptsInput) {
    promptsInput.value = captionsTxt;
    promptsInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptsInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 2. Also pre-fill Studio captions & voiceover in background for later video assembly
  const captionInput = $('caption-text') || $('caption-script');
  if (captionInput) {
    captionInput.value = captionsTxt;
    captionInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const setVoiceover = window.setStudioVoiceoverFile || window.setFrameHunterVoiceoverFile;
  if (splitterState.audioFile && setVoiceover) {
    setVoiceover(splitterState.audioFile);
  }

  // 3. Switch nav tab to Prompts
  const navPrompts = $('nav-btn-prompts');
  if (navPrompts) {
    navPrompts.click();
  } else if (typeof window.switchToTab === 'function') {
    window.switchToTab('prompts');
  }

  // 4. Notify and scroll smoothly to Prompts captions input
  showToast('✓ Captions sent to Prompts!');
  if (promptsInput) promptsInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showToast(msg) {
  let toast = $('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('toast-visible');
  setTimeout(() => toast.classList.remove('toast-visible'), 3200);
}
