/**
 * voice_ui.js — UI Controller for SceneFlow Voice (Fish Audio Neural Studio)
 */

import {
  DEFAULT_FISH_MODEL,
  FISH_AUDIO_MODELS,
  VOICE_PRESETS,
  getStoredFishApiKey,
  saveFishApiKey,
  removeFishApiKey,
  getStoredFishModel,
  saveFishModel,
  getStoredVoiceId,
  saveVoiceId,
  getStoredCustomVoices,
  saveCustomVoice,
  removeCustomVoice,
  maskApiKey,
  estimateSpeechDuration
} from './voice_storage.js';

import { testFishApiKey, synthesizeSpeech } from './voice_api.js';

const $ = (id) => document.getElementById(id);

const EYE_OPEN_SVG = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
const EYE_CLOSED_SVG = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>`;
const SPINNER_SVG = `<svg class="w-3 h-3 animate-spin text-teal-400" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`;

let currentGeneratedAudio = {
  blob: null,
  blobUrl: null,
  audioUrl: null,
  filename: null
};

let isKeyMasked = true;
let actualApiKey = '';

export function initVoiceoverUI() {
  actualApiKey = getStoredFishApiKey();

  initApiKeyControls();
  initModelControls();
  initVoiceControls();
  initAcousticToggle();
  initAcousticSliders();
  initScriptControls();
  initSynthesizer();
  initAudioDeck();
}

// ── 1. Collapsible API Key Setup (auto-hides once saved) ────────────────────

function initApiKeyControls() {
  const apiToggle = $('vo-api-toggle');
  const apiBody = $('vo-api-body');
  const apiChevron = $('vo-api-chevron');
  const apiHeaderSub = $('vo-api-header-sub');
  const keyInput = $('vo-api-key-input');
  const toggleVisBtn = $('vo-toggle-key-vis');
  const saveKeyBtn = $('vo-btn-save-key');
  const testKeyBtn = $('vo-btn-test-key');
  const removeKeyBtn = $('vo-btn-remove-key');
  const feedbackEl = $('vo-key-feedback');

  function updateHeaderSub(customMessage = '') {
    if (!apiHeaderSub) return;
    if (customMessage) {
      apiHeaderSub.textContent = customMessage;
      apiHeaderSub.className = 'text-[10px] text-emerald-400 font-medium';
      return;
    }
    if (actualApiKey) {
      apiHeaderSub.textContent = 'API Key saved in cookie';
      apiHeaderSub.className = 'text-[10px] text-[#14B8A6]';
    } else {
      apiHeaderSub.textContent = 'Fish Audio API Key';
      apiHeaderSub.className = 'text-[10px] text-slate-400';
    }
  }

  function setApiSectionExpanded(expanded, statusText = '') {
    if (apiBody) apiBody.classList.toggle('hidden', !expanded);
    if (apiToggle) apiToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (apiChevron) apiChevron.classList.toggle('rotate-180', expanded);
    updateHeaderSub(statusText);
  }

  function renderKeyInput() {
    if (!keyInput) return;
    if (actualApiKey) {
      keyInput.value = isKeyMasked ? maskApiKey(actualApiKey) : actualApiKey;
      keyInput.type = isKeyMasked ? 'password' : 'text';
    } else {
      keyInput.value = '';
      keyInput.type = 'text';
      keyInput.placeholder = 'Paste your Fish Audio API Key...';
    }
    if (toggleVisBtn) {
      toggleVisBtn.innerHTML = isKeyMasked ? EYE_OPEN_SVG : EYE_CLOSED_SVG;
    }
  }

  renderKeyInput();
  // Auto-collapse API section on load if key is already saved
  setApiSectionExpanded(!actualApiKey);

  if (apiToggle && apiBody) {
    apiToggle.onclick = () => {
      const willExpand = apiBody.classList.contains('hidden');
      setApiSectionExpanded(willExpand);
      if (willExpand && !actualApiKey && keyInput) {
        keyInput.focus();
      }
    };
  }

  if (toggleVisBtn) {
    toggleVisBtn.onclick = () => {
      isKeyMasked = !isKeyMasked;
      renderKeyInput();
    };
  }

  if (saveKeyBtn) {
    saveKeyBtn.onclick = () => {
      const val = keyInput.value.trim();
      if (val && !val.includes('••••')) {
        actualApiKey = val;
      }
      if (!actualApiKey) {
        showFeedback(feedbackEl, 'Please enter a valid API key first.', 'error');
        return;
      }
      saveFishApiKey(actualApiKey);
      isKeyMasked = true;
      renderKeyInput();
      showFeedback(feedbackEl, '✓ Key saved in cookie (SameSite=Strict)', 'success');
      // Hide API section cleanly once saved
      setApiSectionExpanded(false, '✓ Key saved in cookie');
    };
  }

  if (testKeyBtn) {
    testKeyBtn.onclick = async () => {
      const typed = keyInput.value.trim();
      const testVal = (typed && !typed.includes('••••') ? typed : actualApiKey) || actualApiKey;
      if (!testVal) {
        showFeedback(feedbackEl, 'Please enter an API key to test.', 'error');
        return;
      }

      const originalBtnHtml = testKeyBtn.innerHTML;
      testKeyBtn.disabled = true;
      testKeyBtn.innerHTML = `${SPINNER_SVG}<span>Testing...</span>`;
      showFeedback(feedbackEl, 'Testing key with Fish Audio...', 'info');

      try {
        const result = await testFishApiKey(testVal);
        if (result.success) {
          showFeedback(feedbackEl, '✓ Key works! Connected to Fish Audio.', 'success');
          actualApiKey = testVal;
          saveFishApiKey(actualApiKey);
          isKeyMasked = true;
          renderKeyInput();
          setApiSectionExpanded(false, '✓ Key verified & saved');
        } else {
          showFeedback(feedbackEl, `✗ ${result.error}`, 'error');
        }
      } catch (err) {
        showFeedback(feedbackEl, `✗ Test error: ${err.message}`, 'error');
      } finally {
        testKeyBtn.disabled = false;
        testKeyBtn.innerHTML = originalBtnHtml;
      }
    };
  }

  if (removeKeyBtn) {
    removeKeyBtn.onclick = () => {
      removeFishApiKey();
      actualApiKey = '';
      isKeyMasked = false;
      renderKeyInput();
      setApiSectionExpanded(true);
      showFeedback(feedbackEl, 'Key removed from browser cookie.', 'info');
    };
  }
}

function showFeedback(el, message, type = 'info') {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden', 'text-teal-400', 'text-emerald-400', 'text-rose-400', 'text-amber-400');
  if (type === 'success') {
    el.classList.add('text-emerald-400');
  } else if (type === 'error') {
    el.classList.add('text-rose-400');
  } else {
    el.classList.add('text-teal-400');
  }
}

// ── 2. Background Model Locking (s2.1-pro-free) ─────────────────────────────

function initModelControls() {
  // Model runs strictly as s2.1-pro-free in the background
  saveFishModel(DEFAULT_FISH_MODEL);
}

// ── 3. Voice Selection, Saved Custom Voices & Add-Voice Popup Modal ─────────

function initVoiceControls() {
  const addVoiceBtn = $('vo-btn-toggle-add-voice');
  const voiceModal = $('vo-voice-modal');
  const voiceModalClose = $('vo-voice-modal-close');
  const voiceModalCancel = $('vo-voice-modal-cancel');
  const voiceNameInput = $('vo-voice-name-input');
  const voiceIdInput = $('vo-voice-id-input');
  const saveVoiceBtn = $('vo-btn-save-voice-id');
  const voiceFeedback = $('vo-voice-feedback');
  const presetsList = $('vo-presets-list');
  const voiceTitle = $('vo-voice-title');
  const voiceSubtitle = $('vo-voice-subtitle');
  const voiceAvatar = $('vo-voice-avatar');
  const voiceTag = $('vo-voice-tag');
  const voiceLatency = $('vo-voice-latency');

  let currentVoiceId = getStoredVoiceId();

  function renderPresetsList() {
    if (!presetsList) return;
    presetsList.innerHTML = '';

    const customVoices = getStoredCustomVoices();
    const PRESET_LABELS = {
      'bf322df2096a46f18c579d0baa36f41d': 'Adrian (Narrator)',
      '933563129e564b19a115bedd57b7406a': 'Sarah (Explainer)',
      'c5f56a6cc2ec4fa8920cb4c5889a3fb7': 'Slax (Documentary)',
      '90e65eaaf50e4470b8e6d43ee6afd7d5': 'Cinematic Announcer'
    };
    const allVoices = [
      ...customVoices.map(v => ({ ...v, label: v.name })),
      ...VOICE_PRESETS.map(p => ({ ...p, label: PRESET_LABELS[p.id] || p.name, isCustom: false }))
    ];

    allVoices.forEach(item => {
      const isSelected = item.id === currentVoiceId;
      const chipWrap = document.createElement('div');
      chipWrap.className = 'inline-flex items-center';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-preset-id', item.id);
      btn.className = isSelected
        ? 'vo-preset-btn px-2.5 py-1 rounded-full bg-obsidian-elevated text-slate-200 text-xs border border-teal-500/60 transition cursor-pointer flex items-center gap-1.5'
        : 'vo-preset-btn px-2.5 py-1 rounded-full bg-obsidian-deepest text-slate-400 text-xs hover:text-white border border-obsidian-border transition cursor-pointer flex items-center gap-1.5';
      btn.textContent = item.label;
      btn.onclick = () => updateVoiceCard(item.id);

      if (item.isCustom) {
        btn.classList.add('pr-1.5');
        const removeSpan = document.createElement('span');
        removeSpan.textContent = '×';
        removeSpan.title = `Remove ${item.name}`;
        removeSpan.className = 'ml-1 text-slate-500 hover:text-rose-400 font-bold leading-none px-0.5';
        removeSpan.onclick = (e) => {
          e.stopPropagation();
          removeCustomVoice(item.id);
          if (currentVoiceId === item.id) {
            updateVoiceCard(VOICE_PRESETS[0].id);
          } else {
            renderPresetsList();
          }
        };
        btn.appendChild(removeSpan);
      }

      chipWrap.appendChild(btn);
      presetsList.appendChild(chipWrap);
    });
  }

  function updateVoiceCard(id) {
    currentVoiceId = (id || '').trim();
    saveVoiceId(currentVoiceId);

    const customMatch = getStoredCustomVoices().find(v => v.id === currentVoiceId);
    const preset = VOICE_PRESETS.find(p => p.id === currentVoiceId);

    if (customMatch) {
      if (voiceTitle) voiceTitle.textContent = customMatch.name;
      if (voiceSubtitle) voiceSubtitle.textContent = 'Custom voice saved in cookie';
      if (voiceAvatar) voiceAvatar.textContent = customMatch.initials;
      if (voiceTag) voiceTag.textContent = customMatch.tag;
      if (voiceLatency) voiceLatency.textContent = customMatch.latency;
    } else if (preset) {
      if (voiceTitle) voiceTitle.textContent = preset.title;
      if (voiceSubtitle) voiceSubtitle.textContent = 'Verified voice preset active';
      if (voiceAvatar) voiceAvatar.textContent = preset.initials;
      if (voiceTag) voiceTag.textContent = preset.tag;
      if (voiceLatency) voiceLatency.textContent = preset.latency;
    } else if (currentVoiceId) {
      if (voiceTitle) voiceTitle.textContent = 'Custom Voice';
      if (voiceSubtitle) voiceSubtitle.textContent = 'Custom voice saved in cookie';
      if (voiceAvatar) voiceAvatar.textContent = 'CV';
      if (voiceTag) voiceTag.textContent = 'Custom Voice';
      if (voiceLatency) voiceLatency.textContent = '< 400ms Latency';
    } else {
      if (voiceTitle) voiceTitle.textContent = 'System Default Voice';
      if (voiceSubtitle) voiceSubtitle.textContent = 'Default voice active';
      if (voiceAvatar) voiceAvatar.textContent = 'FA';
      if (voiceTag) voiceTag.textContent = 'Fish Audio Default';
      if (voiceLatency) voiceLatency.textContent = '< 350ms Latency';
    }

    renderPresetsList();
  }

  function openVoiceModal() {
    if (!voiceModal) return;
    voiceModal.classList.remove('hidden');
    if (voiceFeedback) voiceFeedback.classList.add('hidden');
    if (voiceNameInput) voiceNameInput.value = '';
    if (voiceIdInput) voiceIdInput.value = '';
    if (voiceNameInput) voiceNameInput.focus();
  }

  function closeVoiceModal() {
    if (!voiceModal) return;
    voiceModal.classList.add('hidden');
    if (voiceFeedback) voiceFeedback.classList.add('hidden');
  }

  function commitCustomVoiceModal() {
    const cleanName = (voiceNameInput?.value || '').trim();
    const cleanId = (voiceIdInput?.value || '').trim();
    if (!cleanName) {
      showFeedback(voiceFeedback, 'Please enter a Voice Name.', 'error');
      voiceNameInput?.focus();
      return;
    }
    if (!cleanId) {
      showFeedback(voiceFeedback, 'Please enter a Fish Audio Voice ID.', 'error');
      voiceIdInput?.focus();
      return;
    }

    saveCustomVoice({ id: cleanId, name: cleanName });
    updateVoiceCard(cleanId);
    closeVoiceModal();
  }

  if (addVoiceBtn) addVoiceBtn.onclick = openVoiceModal;
  if (voiceModalClose) voiceModalClose.onclick = closeVoiceModal;
  if (voiceModalCancel) voiceModalCancel.onclick = closeVoiceModal;
  if (voiceModal) {
    voiceModal.onclick = (e) => {
      if (e.target === voiceModal) closeVoiceModal();
    };
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && voiceModal && !voiceModal.classList.contains('hidden')) {
        closeVoiceModal();
      }
    });
  }

  if (saveVoiceBtn) {
    saveVoiceBtn.onclick = commitCustomVoiceModal;
  }

  [voiceNameInput, voiceIdInput].forEach(inp => {
    if (!inp) return;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCustomVoiceModal();
      }
    };
  });

  window.resetVoVoiceSelection = () => updateVoiceCard(VOICE_PRESETS[0].id);

  updateVoiceCard(currentVoiceId);
}

// ── 4. Collapsible Acoustic Synthetics & Sliders ────────────────────────────

function initAcousticToggle() {
  const toggleBtn = $('vo-acoustic-toggle');
  const body = $('vo-acoustic-body');
  const chevron = $('vo-acoustic-chevron');
  if (!toggleBtn || !body) return;

  toggleBtn.onclick = () => {
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !isHidden);
    toggleBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    if (chevron) {
      chevron.classList.toggle('rotate-180', isHidden);
    }
  };
}

function initAcousticSliders() {
  const speedSlider = $('vo-speed-slider');
  const speedVal = $('vo-speed-val');
  const gainSlider = $('vo-gain-slider');
  const gainVal = $('vo-gain-val');
  const tempSlider = $('vo-temp-slider');
  const tempVal = $('vo-temp-val');
  const toppSlider = $('vo-topp-slider');
  const toppVal = $('vo-topp-val');

  if (speedSlider && speedVal) {
    speedSlider.oninput = () => {
      const spd = parseFloat(speedSlider.value).toFixed(2);
      speedVal.textContent = `${spd}x`;
      if (typeof window.updateVoScriptStats === 'function') window.updateVoScriptStats();
    };
  }

  if (gainSlider && gainVal) {
    gainSlider.oninput = () => {
      const g = parseFloat(gainSlider.value).toFixed(1);
      gainVal.textContent = `${gainSlider.value >= 0 ? '+' : ''}${g} dB`;
    };
  }

  if (tempSlider && tempVal) {
    tempSlider.oninput = () => {
      tempVal.textContent = parseFloat(tempSlider.value).toFixed(2);
    };
  }

  if (toppSlider && toppVal) {
    toppSlider.oninput = () => {
      toppVal.textContent = parseFloat(toppSlider.value).toFixed(2);
    };
  }
}

// ── 5. Master Script Editor, Clear/Reset & Insertion Tokens ──────────────────

function initScriptControls() {
  const scriptTitle = $('vo-script-title');
  const scriptContent = $('vo-script-content');
  const charCountEl = $('vo-char-count');
  const timeEstEl = $('vo-time-est');
  const clearBtn = $('vo-btn-clear-script');
  const resetBtn = $('vo-btn-reset-script');

  function updateScriptStats() {
    if (!scriptContent) return;
    const text = scriptContent.value || '';
    if (charCountEl) charCountEl.textContent = text.length;

    const speed = parseFloat($('vo-speed-slider')?.value || '1.0');
    const estSec = estimateSpeechDuration(text, speed);
    if (timeEstEl) {
      timeEstEl.textContent = text.trim() ? `Est. ${estSec.toFixed(1)}s speech` : 'Est. 0.0s speech';
    }
  }

  window.updateVoScriptStats = updateScriptStats;

  if (scriptContent) {
    scriptContent.oninput = updateScriptStats;
    updateScriptStats();
  }

  document.querySelectorAll('.vo-token-btn').forEach(btn => {
    btn.onclick = () => {
      const token = btn.getAttribute('data-token');
      if (token && scriptContent) {
        insertTextAtCursor(scriptContent, token);
        updateScriptStats();
      }
    };
  });

  if (clearBtn && scriptContent) {
    clearBtn.onclick = () => {
      scriptContent.value = '';
      updateScriptStats();
      scriptContent.focus();
    };
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      if (scriptTitle) scriptTitle.value = '';
      if (scriptContent) scriptContent.value = '';
      updateScriptStats();

      // Collapse Acoustic Synthetics & reset sliders and format back to defaults
      const acousticBody = $('vo-acoustic-body');
      const acousticToggle = $('vo-acoustic-toggle');
      const acousticChevron = $('vo-acoustic-chevron');
      if (acousticBody) acousticBody.classList.add('hidden');
      if (acousticToggle) acousticToggle.setAttribute('aria-expanded', 'false');
      if (acousticChevron) acousticChevron.classList.remove('rotate-180');

      const speedSlider = $('vo-speed-slider');
      const speedVal = $('vo-speed-val');
      if (speedSlider) speedSlider.value = '1.0';
      if (speedVal) speedVal.textContent = '1.00x';

      const gainSlider = $('vo-gain-slider');
      const gainVal = $('vo-gain-val');
      if (gainSlider) gainSlider.value = '0.0';
      if (gainVal) gainVal.textContent = '+0.0 dB';

      const tempSlider = $('vo-temp-slider');
      const tempVal = $('vo-temp-val');
      if (tempSlider) tempSlider.value = '0.70';
      if (tempVal) tempVal.textContent = '0.70';

      const toppSlider = $('vo-topp-slider');
      const toppVal = $('vo-topp-val');
      if (toppSlider) toppSlider.value = '0.80';
      if (toppVal) toppVal.textContent = '0.80';

      const formatSelect = $('vo-format-select');
      if (formatSelect) formatSelect.value = 'mp3';

      // Reset active voice back to default preset & close voice modal if open
      const voiceModal = $('vo-voice-modal');
      if (voiceModal) voiceModal.classList.add('hidden');
      if (typeof window.resetVoVoiceSelection === 'function') {
        window.resetVoVoiceSelection();
      }

      // Clear active generated audio deck back to muted idle state
      if (currentGeneratedAudio.blobUrl) {
        try { URL.revokeObjectURL(currentGeneratedAudio.blobUrl); } catch {}
      }
      currentGeneratedAudio = { blob: null, blobUrl: null, audioUrl: null, filename: null };

      const audioEl = $('vo-audio-el');
      if (audioEl) {
        try { audioEl.pause(); } catch {}
        audioEl.removeAttribute('src');
        audioEl.load();
      }
      if ($('vo-deck-notification')) $('vo-deck-notification').classList.add('hidden');
      if ($('vo-audio-name')) $('vo-audio-name').textContent = 'No audio generated yet';
      if ($('vo-audio-time-curr')) $('vo-audio-time-curr').textContent = '0:00';
      if ($('vo-audio-time-total')) $('vo-audio-time-total').textContent = '0:00';
      if ($('vo-play-icon')) $('vo-play-icon').classList.remove('hidden');
      if ($('vo-pause-icon')) $('vo-pause-icon').classList.add('hidden');
      renderIdleWaveformBars();
    };
  }
}

function insertTextAtCursor(textarea, textToInsert) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const val = textarea.value;
  textarea.value = val.substring(0, start) + textToInsert + val.substring(end);
  textarea.selectionStart = textarea.selectionEnd = start + textToInsert.length;
  textarea.focus();
}

// ── 6. Speech Synthesis Trigger ──────────────────────────────────────────────

function initSynthesizer() {
  const synthBtn = $('vo-btn-synthesize');
  const synthSpinner = $('vo-synth-spinner');
  const synthIcon = $('vo-synth-icon');
  const synthText = $('vo-synth-text');
  const scriptContent = $('vo-script-content');
  const formatSelect = $('vo-format-select');

  if (!synthBtn) return;

  synthBtn.onclick = async () => {
    const key = actualApiKey || getStoredFishApiKey();
    if (!key) {
      alert('Please enter and save your Fish Audio API Key first in the API Configuration panel.');
      $('vo-api-key-input')?.focus();
      return;
    }

    const text = scriptContent ? scriptContent.value.trim() : '';
    if (!text) {
      alert('Please enter text in the Master Script box to synthesize.');
      scriptContent?.focus();
      return;
    }

    const model = DEFAULT_FISH_MODEL;
    const voiceId = getStoredVoiceId();
    const format = formatSelect?.value || 'mp3';
    const speed = parseFloat($('vo-speed-slider')?.value || '1.0');
    const volume = parseFloat($('vo-gain-slider')?.value || '0.0');
    const temperature = parseFloat($('vo-temp-slider')?.value || '0.7');
    const topP = parseFloat($('vo-topp-slider')?.value || '0.8');

    synthBtn.disabled = true;
    if (synthSpinner) synthSpinner.classList.remove('hidden');
    if (synthIcon) synthIcon.classList.add('hidden');
    if (synthText) synthText.textContent = 'Synthesizing audio...';

    try {
      const result = await synthesizeSpeech({
        apiKey: key,
        text,
        voiceId,
        model,
        format,
        speed,
        volume,
        temperature,
        topP
      });

      if (currentGeneratedAudio.blobUrl) {
        try { URL.revokeObjectURL(currentGeneratedAudio.blobUrl); } catch {}
      }

      currentGeneratedAudio = result;
      loadAudioIntoPlayer(result);
    } catch (err) {
      alert(`Synthesis Error: ${err.message}`);
    } finally {
      synthBtn.disabled = false;
      if (synthSpinner) synthSpinner.classList.add('hidden');
      if (synthIcon) synthIcon.classList.remove('hidden');
      if (synthText) synthText.textContent = 'Generate Speech';
    }
  };
}

// ── 7. Master Audio Deck Player & Splitter Handoff ────────────────────────────

function initAudioDeck() {
  const audioEl = $('vo-audio-el');
  const playBtn = $('vo-play-btn');
  const playIcon = $('vo-play-icon');
  const pauseIcon = $('vo-pause-icon');
  const timeCurr = $('vo-audio-time-curr');
  const timeTotal = $('vo-audio-time-total');
  const scrubWrap = $('vo-audio-scrub-wrap');
  const scrubFill = $('vo-audio-scrub-fill');
  const exportBtn = $('vo-btn-export-audio');
  const sendTimingBtn = $('vo-btn-send-timing') || $('vo-btn-send-splitter');

  if (playBtn && audioEl) {
    playBtn.onclick = () => {
      if (!audioEl.src) return;
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
      if (timeCurr) timeCurr.textContent = formatVoTime(audioEl.currentTime);
      if (scrubFill && audioEl.duration) {
        const pct = (audioEl.currentTime / audioEl.duration) * 100;
        scrubFill.style.width = `${pct}%`;
      }
    };

    audioEl.onloadedmetadata = () => {
      if (timeTotal) timeTotal.textContent = formatVoTime(audioEl.duration);
    };

    audioEl.onended = () => {
      if (playIcon) playIcon.classList.remove('hidden');
      if (pauseIcon) pauseIcon.classList.add('hidden');
      if (scrubFill) scrubFill.style.width = '0%';
    };
  }

  if (scrubWrap && audioEl) {
    scrubWrap.onclick = (e) => {
      if (!audioEl.duration) return;
      const rect = scrubWrap.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      audioEl.currentTime = ratio * audioEl.duration;
    };
  }

  if (exportBtn) {
    exportBtn.onclick = () => {
      if (!currentGeneratedAudio.blob && !currentGeneratedAudio.audioUrl) {
        alert('No audio generated yet. Click "Generate Speech" first.');
        return;
      }
      const a = document.createElement('a');
      a.href = currentGeneratedAudio.blobUrl || currentGeneratedAudio.audioUrl;
      a.download = currentGeneratedAudio.filename || 'sceneflow_voice_master.mp3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
  }

  if (sendTimingBtn) {
    sendTimingBtn.onclick = () => {
      if (!currentGeneratedAudio.blob) {
        alert('Please synthesize voiceover audio first.');
        return;
      }

      const ext = currentGeneratedAudio.filename?.endsWith('.wav') ? '.wav' : '.mp3';
      const file = new File(
        [currentGeneratedAudio.blob],
        currentGeneratedAudio.filename || `sceneflow_voice_${Date.now()}${ext}`,
        { type: ext === '.wav' ? 'audio/wav' : 'audio/mpeg' }
      );

      const loadTimingAudio = window.__loadTimingAudio || window.__loadSplitterAudio;
      if (typeof loadTimingAudio === 'function') {
        loadTimingAudio(file);
      } else {
        const spFileInput = $('sp-audio-file-input');
        if (spFileInput) {
          const dt = new DataTransfer();
          dt.items.add(file);
          spFileInput.files = dt.files;
          spFileInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      const scriptContent = $('vo-script-content');
      const timingInput = $('sp-script-text') || $('sp-transcript-input');
      if (scriptContent && timingInput && !timingInput.value.trim()) {
        timingInput.value = scriptContent.value.trim();
        timingInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const navBtnTiming = $('nav-btn-timing');
      if (navBtnTiming) {
        navBtnTiming.click();
      } else if (typeof window.switchToTab === 'function') {
        window.switchToTab('timing');
      }
    };
  }
  renderIdleWaveformBars();
}

function loadAudioIntoPlayer(audioData) {
  const audioEl = $('vo-audio-el');
  const nameEl = $('vo-audio-name');
  const deckWrap = $('vo-master-audio-card');

  if (deckWrap) deckWrap.classList.remove('opacity-60');

  if (audioEl) {
    audioEl.src = audioData.blobUrl || audioData.audioUrl;
    audioEl.load();
  }

  if (nameEl) nameEl.textContent = audioData.filename;

  renderWaveformBars();
}

function renderIdleWaveformBars() {
  const container = $('vo-waveform-bars');
  const scrubFill = $('vo-audio-scrub-fill');
  if (scrubFill) {
    scrubFill.style.width = '0%';
    scrubFill.classList.add('hidden');
  }
  if (!container) return;

  container.innerHTML = Array.from({ length: 48 })
    .map(() => '<span class="w-1 bg-[#202B36] h-2 rounded-full"></span>')
    .join('');
}

function renderWaveformBars() {
  const container = $('vo-waveform-bars');
  const scrubFill = $('vo-audio-scrub-fill');
  if (scrubFill) {
    scrubFill.style.width = '0%';
    scrubFill.classList.remove('hidden');
  }
  if (!container) return;

  const heights = [
    12, 20, 32, 40, 24, 36, 16, 28, 40, 32, 24, 28, 40, 16, 32, 44, 24, 36, 20, 32, 40, 16, 28, 36,
    18, 30, 42, 38, 22, 34, 18, 30, 42, 34, 22, 26, 38, 14, 28, 40, 20, 32, 18, 28, 36, 14, 24, 30
  ];

  container.innerHTML = heights
    .map(h => `<span class="w-1 bg-teal-400 rounded-full transition-all duration-300" style="height: ${h}px;"></span>`)
    .join('');
}

function formatVoTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function showDeckNotification(msg, type = 'info') {
  const notif = $('vo-deck-notification');
  if (!notif) return;
  notif.textContent = msg;
  notif.classList.remove('hidden', 'text-teal-400', 'text-emerald-400', 'text-rose-400', 'text-amber-400');
  notif.classList.add(type === 'success' ? 'text-emerald-400' : 'text-amber-400');
  setTimeout(() => notif.classList.add('hidden'), 4000);
}
