/**
 * prompts_ui.js — UI Controller for SceneFlow Prompts
 * 
 * Manages Groq API Key (stored in 1-year cookie), Model Selection,
 * Style Skills (IndexedDB, up to 5), Caption Validation, Batched Generation,
 * In-place Editable Prompts, Single-Line Regeneration, Project Save/Open,
 * and Exports.
 */

import {
  parseTimeString,
  parseTimestampLine,
  validateCaptionLines,
  createBatches,
  cleanPromptText,
  formatStyleGuideAsLines,
  formatStyleGuideAsParagraph,
  buildPromptsOutput
} from './prompts_parser.js';

import {
  DEFAULT_GROQ_MODEL,
  GROQ_MODELS,
  MAX_SKILLS,
  getStoredApiKey,
  saveApiKeyCookie,
  removeApiKeyCookie,
  maskApiKey,
  getStoredModel,
  saveModelCookie,
  getAllSkills,
  getSkillById,
  saveSkill,
  duplicateSkill,
  deleteSkill,
  exportSkillJSON,
  exportAllSkillsJSON,
  importSkillsFromJSON,
  normalizeSkillFromAnyJSON,
  resizeImageToThumbnail,
  requestPersistentStorage
} from './prompts_storage.js';

import {
  testGroqApiKey,
  analyzeStyleImages,
  generatePromptsBatch,
  regenerateSinglePrompt
} from './prompts_groq.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  apiKey: '',
  isKeyMasked: true,
  model: DEFAULT_GROQ_MODEL,
  skills: [],
  selectedSkillId: 'none',
  notes: '',
  captionText: '',
  validation: { valid: false, lines: [], badLines: [], duplicateTimes: [], outOfOrderTimes: [] },
  outputItems: [],
  styleGuideHeader: '',
  rawOutputText: '',
  blankLines: true,
  promptLength: '150-200-chars',
  language: 'English',
  aspectRatio: '',
  isGenerating: false,
  abortController: null,
  failedBatches: [],
  activeBatchesData: null,
  // Modal state
  modalEditingSkillId: null,
  modalUploadedImages: [] // Array of base64 strings
};

// ── Toast Notifications ─────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const existing = document.getElementById('ph-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'ph-toast';
  const colorMap = {
    info: 'bg-obsidian-surface/95 text-[#E8EEF4] border-teal-500/60',
    success: 'bg-obsidian-surface/95 text-emerald-400 border-emerald-400/50',
    error: 'bg-obsidian-surface/95 text-rose-400 border-rose-400/50',
    warn: 'bg-obsidian-surface/95 text-amber-400 border-amber-400/50'
  };

  toast.className = `fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all duration-300 transform translate-y-2 opacity-0 ${colorMap[type] || colorMap.info}`;
  toast.innerHTML = `<span>${msg}</span>`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── 1. Collapsible API Key & Best Background Model Controller ───────────────

function initApiKeyUI() {
  state.apiKey = getStoredApiKey();
  // Use resolved stored model if saved, else default best Groq model
  state.model = getStoredModel() || DEFAULT_GROQ_MODEL;

  const apiToggle = $('pr-api-toggle');
  const apiBody = $('pr-api-body');
  const apiChevron = $('pr-api-chevron');
  const apiHeaderSub = $('pr-api-header-sub');
  const keyInput = $('pr-api-key');
  const toggleBtn = $('pr-btn-toggle-key');
  const saveBtn = $('pr-btn-save-key');
  const testBtn = $('pr-btn-test-key');
  const removeBtn = $('pr-btn-remove-key');
  const statusEl = $('pr-key-status');

  function updateHeaderSub(customMessage = '') {
    if (!apiHeaderSub) return;
    if (customMessage) {
      apiHeaderSub.textContent = customMessage;
      apiHeaderSub.className = 'text-[10px] text-emerald-400 font-medium';
      return;
    }
    if (state.apiKey) {
      apiHeaderSub.textContent = 'API Key saved in cookie';
      apiHeaderSub.className = 'text-[10px] text-[#14B8A6]';
    } else {
      apiHeaderSub.textContent = 'Groq API Key';
      apiHeaderSub.className = 'text-[10px] text-slate-400';
    }
  }

  function setApiSectionExpanded(expanded, statusText = '') {
    if (apiBody) apiBody.classList.toggle('hidden', !expanded);
    if (apiToggle) apiToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (apiChevron) apiChevron.classList.toggle('rotate-180', expanded);
    updateHeaderSub(statusText);
  }

  // Key Input display
  function updateKeyDisplay() {
    if (!keyInput) return;
    if (state.apiKey) {
      if (state.isKeyMasked) {
        keyInput.value = maskApiKey(state.apiKey);
        keyInput.type = 'text';
      } else {
        keyInput.value = state.apiKey;
        keyInput.type = 'text';
      }
      if (removeBtn) removeBtn.classList.remove('hidden');
    } else {
      keyInput.value = '';
      keyInput.type = 'text';
      keyInput.placeholder = 'Paste gsk_... key';
      if (removeBtn) removeBtn.classList.add('hidden');
    }
  }

  updateKeyDisplay();
  // Auto-hide API section on load if key is already saved
  setApiSectionExpanded(!state.apiKey);

  if (apiToggle && apiBody) {
    apiToggle.onclick = () => {
      const willExpand = apiBody.classList.contains('hidden');
      setApiSectionExpanded(willExpand);
      if (willExpand && !state.apiKey && keyInput) {
        keyInput.focus();
      }
    };
  }

  // Toggle Visibility
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      state.isKeyMasked = !state.isKeyMasked;
      updateKeyDisplay();
      toggleBtn.title = state.isKeyMasked ? 'Show full key' : 'Mask key';
    };
  }

  // Save Key
  if (saveBtn) {
    saveBtn.onclick = () => {
      const val = keyInput ? keyInput.value.trim() : '';
      // If user typed new key (doesn't have bullet mask characters)
      if (val && !val.includes('••')) {
        state.apiKey = val;
        saveApiKeyCookie(val);
        state.isKeyMasked = true;
        updateKeyDisplay();
        setApiSectionExpanded(false, '✓ Key saved in cookie');
        showToast('Groq API key saved.', 'success');
      } else if (!val) {
        showToast('Please enter a Groq API key first.', 'warn');
      } else {
        setApiSectionExpanded(false, '✓ Key saved in cookie');
        showToast('Key already saved and active.', 'info');
      }
    };
  }

  // Test Key
  async function testApiKey() {
    if (!state.apiKey) {
      showToast('No API key to test. Please paste a key first.', 'warn');
      return;
    }
    if (statusEl) {
      statusEl.className = 'text-xs font-mono text-teal-400 flex items-center gap-1.5';
      statusEl.innerHTML = `<svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Testing key...`;
    }

    const testRes = await testGroqApiKey(state.apiKey, state.model);
    if (testRes.ok && testRes.resolvedModel) {
      state.model = testRes.resolvedModel;
      saveModelCookie(testRes.resolvedModel);
    }
    if (statusEl) {
      if (testRes.ok) {
        statusEl.className = 'text-xs font-mono text-emerald-400 font-semibold flex items-center gap-1.5';
        statusEl.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>${testRes.message}</span>`;
      } else {
        statusEl.className = 'text-xs font-mono text-rose-400 font-semibold flex items-center gap-1.5';
        statusEl.innerHTML = `<svg class="w-3.5 h-3.5 text-rose-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <span>${testRes.message}</span>`;
      }
    }
  }

  if (testBtn) testBtn.onclick = testApiKey;

  // Remove Key
  if (removeBtn) {
    removeBtn.onclick = () => {
      state.apiKey = '';
      removeApiKeyCookie();
      updateKeyDisplay();
      if (statusEl) statusEl.innerHTML = '';
      setApiSectionExpanded(true);
      showToast('Groq API key removed.', 'info');
    };
  }
}

// ── 2. Skills Storage & Management (IndexedDB, Max 5) ───────────────────────

async function refreshSkillsUI() {
  state.skills = await getAllSkills();

  // 1. Update Count & Limit warning
  const countBadge = $('pr-skills-count');
  const createBtn = $('pr-btn-create-skill');
  const count = state.skills.length;

  if (countBadge) {
    if (count >= MAX_SKILLS) {
      countBadge.textContent = `${count} of ${MAX_SKILLS} skills used. Delete one to add another.`;
      countBadge.className = 'text-[11px] font-mono text-amber-400 font-bold';
    } else {
      countBadge.textContent = `${count} of ${MAX_SKILLS} skills used`;
      countBadge.className = 'text-[11px] font-mono text-slate-400';
    }
  }

  if (createBtn) {
    if (count >= MAX_SKILLS) {
      createBtn.disabled = true;
      createBtn.classList.add('opacity-50', 'cursor-not-allowed');
      createBtn.title = '5 of 5 skills used. Delete one to add another.';
    } else {
      createBtn.disabled = false;
      createBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      createBtn.title = 'Create a new style skill';
    }
  }

  // 2. Update Skills Select dropdown
  const select = $('pr-skill-select');
  if (select) {
    const currentVal = select.value || state.selectedSkillId || 'none';
    let opts = '<option value="none">No skill</option>';
    state.skills.forEach(sk => {
      opts += `<option value="${sk.id}" ${sk.id === currentVal ? 'selected' : ''}>${sk.name}</option>`;
    });
    select.innerHTML = opts;
    state.selectedSkillId = select.value;
  }

  // 3. Render Active Selected Skill Card (Show only when a skill is selected; hide completely when No skill)
  const cardsContainer = $('pr-skills-grid');
  const emptyState = $('pr-skills-empty');

  if (!cardsContainer) return;

  // When "No skill" is selected, do not show any skill card here
  if (!state.selectedSkillId || state.selectedSkillId === 'none') {
    cardsContainer.innerHTML = '';
    if (emptyState) emptyState.classList.add('hidden');
    return;
  }

  const activeSkill = state.skills.find(s => s.id === state.selectedSkillId);
  if (!activeSkill) {
    cardsContainer.innerHTML = '';
    if (emptyState) emptyState.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  const thumbHtml = (activeSkill.thumbnails || []).map(th => 
    `<img src="${th}" class="w-8 h-8 rounded object-cover border border-obsidian-border" alt="Thumbnail" />`
  ).join('');
  const descPreview = activeSkill.stylePrefix || (activeSkill.styleGuide ? activeSkill.styleGuide.replace(/[\r\n#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) : 'Custom visual style');

  cardsContainer.innerHTML = `
    <div class="skill-card bg-obsidian-container border border-brand-primary rounded-xl p-3 flex flex-col justify-between gap-2.5 transition hover:border-obsidian-borderHover" data-id="${activeSkill.id}">
      <div>
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <h4 class="text-xs font-bold text-white truncate flex items-center gap-1.5">
            <span>${activeSkill.name}</span>
            <span class="px-1.5 py-0.2 text-[9px] font-bold rounded bg-brand-primary/20 text-brand-primary border border-brand-primary/40">SELECTED</span>
          </h4>
          <div class="flex items-center gap-1">
            <button class="btn-skill-edit p-1 text-slate-400 hover:text-white rounded" title="Edit Skill" data-id="${activeSkill.id}">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="btn-skill-dup p-1 text-slate-400 hover:text-white rounded" title="Duplicate Skill" data-id="${activeSkill.id}">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="btn-skill-export p-1 text-slate-400 hover:text-white rounded" title="Export Skill" data-id="${activeSkill.id}">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="btn-skill-delete p-1 text-slate-500 hover:text-rose-400 rounded" title="Delete Skill" data-id="${activeSkill.id}">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="flex items-center gap-1.5 mb-2 overflow-x-auto py-0.5">
          ${thumbHtml || '<span class="text-[10px] text-slate-500 font-mono">No images</span>'}
        </div>
        <p class="text-[11px] text-slate-300 font-medium line-clamp-2 leading-relaxed bg-obsidian-surface/60 p-2 rounded-lg border border-obsidian-border/50">
          ${descPreview}
        </p>
      </div>
      <div class="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1.5 border-t border-obsidian-border/60">
        <span>${new Date(activeSkill.updatedAt || activeSkill.createdAt).toLocaleDateString()}</span>
        <button class="btn-skill-select-card text-brand-primary hover:underline font-sans font-medium" data-id="${activeSkill.id}" title="Click to deselect (switch to No skill)">
          Active Skill (Deselect)
        </button>
      </div>
    </div>
  `;

  // Bind Active Card actions
  cardsContainer.querySelectorAll('.btn-skill-select-card').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      state.selectedSkillId = 'none';
      if (select) select.value = 'none';
      refreshSkillsUI();
      applySkillToOutputItems('none');
    };
  });

  cardsContainer.querySelectorAll('.btn-skill-edit').forEach(btn => {
    btn.onclick = () => openSkillModal(btn.dataset.id);
  });

  cardsContainer.querySelectorAll('.btn-skill-dup').forEach(btn => {
    btn.onclick = async () => {
      try {
        await duplicateSkill(btn.dataset.id);
        showToast('Skill duplicated successfully', 'success');
        refreshSkillsUI();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  });

  cardsContainer.querySelectorAll('.btn-skill-export').forEach(btn => {
    btn.onclick = async () => {
      const sk = await getSkillById(btn.dataset.id);
      if (sk) {
        const json = exportSkillJSON(sk);
        downloadFile(`${sk.name.toLowerCase().replace(/\s+/g, '_')}_skill.json`, json, 'application/json');
        showToast(`Exported skill "${sk.name}"`, 'success');
      }
    };
  });

  cardsContainer.querySelectorAll('.btn-skill-delete').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Delete this style skill?')) {
        await deleteSkill(btn.dataset.id);
        if (state.selectedSkillId === btn.dataset.id) {
          state.selectedSkillId = 'none';
          applySkillToOutputItems('none');
        }
        showToast('Skill deleted', 'info');
        refreshSkillsUI();
      }
    };
  });
}

/**
 * Algorithmic Style Injector:
 * Formats the active Visual Style Guide in line format without numbering above prompts,
 * dynamically re-skins prompts, or removes it when "No skill (Plain prompts)" is active.
 * Enables instant 1-click style swapping without calling Groq API again.
 */
export function applySkillToOutputItems(skillId) {
  if (!state.outputItems || !state.outputItems.length) return;

  let cleanPrefix = '';
  let styleGuide = '';
  let skillName = '';
  if (skillId && skillId !== 'none') {
    const skill = state.skills.find(s => s.id === skillId);
    if (skill) {
      skillName = skill.name || '';
      cleanPrefix = (skill.stylePrefix || '').trim();
      styleGuide = skill.styleGuide || '';
    }
  }

  const formattedParagraph = formatStyleGuideAsParagraph(styleGuide);
  state.styleGuideHeader = formattedParagraph;

  state.outputItems = state.outputItems.map(item => {
    if (item.isMissing) return item;
    const baseScene = item.scenePrompt || item.promptText || '';
    let finalPrompt = baseScene;

    // Include the visual style guide (or style prefix) directly in each prompt as a single paragraph
    if (formattedParagraph) {
      const sep = /[.!?]$/.test(formattedParagraph) ? ' ' : '. ';
      finalPrompt = `${formattedParagraph}${sep}${baseScene}`;
    } else if (cleanPrefix) {
      if (!finalPrompt.toLowerCase().startsWith(cleanPrefix.toLowerCase())) {
        const sep = /[.!?]$/.test(cleanPrefix) ? ' ' : '. ';
        finalPrompt = `${cleanPrefix}${sep}${finalPrompt}`;
      }
    }

    if (state.aspectRatio) {
      const arToken = state.aspectRatio.startsWith('--ar') ? state.aspectRatio : `--ar ${state.aspectRatio}`;
      if (!finalPrompt.includes(arToken)) {
        finalPrompt = `${finalPrompt} ${arToken}`;
      }
    }

    finalPrompt = cleanPromptText(finalPrompt);

    return {
      ...item,
      scenePrompt: item.scenePrompt || baseScene,
      promptText: finalPrompt,
      fullPromptLine: `${item.rawTime} ${finalPrompt}`
    };
  });

  const delimiter = state.blankLines ? '\n\n' : '\n';
  state.rawOutputText = state.outputItems.map(it => it.fullPromptLine).join(delimiter);

  renderOutputUI();

  if (skillName) {
    showToast(`Applied "${skillName}" style to all prompts!`, 'success');
  } else {
    showToast('Switched to No skill (plain prompts).', 'info');
  }
}

function initSkillsUI() {
  requestPersistentStorage();
  refreshSkillsUI();

  // Skill Selector Change
  const select = $('pr-skill-select');
  if (select) {
    select.onchange = (e) => {
      state.selectedSkillId = e.target.value;
      refreshSkillsUI();
      applySkillToOutputItems(e.target.value);
    };
  }

  // Create Skill button
  const createBtn = $('pr-btn-create-skill');
  if (createBtn) {
    createBtn.onclick = () => openSkillModal(null);
  }

  // Export All Skills
  const exportAllBtn = $('pr-btn-export-all-skills');
  if (exportAllBtn) {
    exportAllBtn.onclick = async () => {
      const all = await getAllSkills();
      if (!all.length) {
        showToast('No skills to export.', 'info');
        return;
      }
      const json = exportAllSkillsJSON(all);
      downloadFile('sceneflow_all_skills_backup.json', json, 'application/json');
      showToast(`Exported ${all.length} skills backup`, 'success');
    };
  }

  // Import Skills
  const importInput = $('pr-input-import-skills');
  const importBtn = $('pr-btn-import-skills');
  if (importBtn && importInput) {
    importBtn.onclick = () => importInput.click();
    importInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = await importSkillsFromJSON(text);
        showToast(`Successfully imported ${res.importedCount} skill(s)${res.skippedCount > 0 ? ` (${res.skippedCount} skipped due to 5-skill limit)` : ''}`, 'success');
        refreshSkillsUI();

        if (res.extractedCaptions) {
          const inputEl = $('pr-captions-input');
          if (inputEl && !inputEl.value.trim()) {
            inputEl.value = res.extractedCaptions;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            showToast('Loaded timestamped scene captions from file into captions box!', 'info');
          }
        }
      } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error');
      } finally {
        importInput.value = '';
      }
    };
  }

  // Directives / Notes textarea
  const notesEl = $('pr-style-notes');
  if (notesEl) {
    notesEl.oninput = (e) => {
      state.notes = e.target.value;
    };
  }
}

// ── 3. Skill Editor Modal Controller ────────────────────────────────────────

async function openSkillModal(skillId = null) {
  state.modalEditingSkillId = skillId;
  state.modalUploadedImages = [];

  const modal = $('modal-skill-editor');
  const modalTitle = $('modal-skill-title');
  const nameInput = $('modal-skill-name');
  const prefixInput = $('modal-skill-prefix');
  const guideInput = $('modal-skill-guide');

  if (!modal) return;

  if (skillId) {
    const existing = await getSkillById(skillId);
    if (!existing) return;
    if (modalTitle) modalTitle.textContent = 'Edit Visual Style Skill';
    if (nameInput) nameInput.value = existing.name || '';
    if (prefixInput) prefixInput.value = existing.stylePrefix || '';
    if (guideInput) guideInput.value = existing.styleGuide || '';
    state.modalUploadedImages = existing.thumbnails || [];
  } else {
    if (modalTitle) modalTitle.textContent = 'Create Visual Style Skill';
    if (nameInput) nameInput.value = '';
    if (prefixInput) prefixInput.value = '';
    if (guideInput) guideInput.value = '';
    state.modalUploadedImages = [];
  }

  renderModalImages();
  modal.classList.remove('hidden');
}

function closeSkillModal() {
  const modal = $('modal-skill-editor');
  if (modal) modal.classList.add('hidden');
  state.modalEditingSkillId = null;
  state.modalUploadedImages = [];
}

function renderModalImages() {
  const container = $('modal-skill-thumbnails');
  if (!container) return;

  if (!state.modalUploadedImages.length) {
    container.innerHTML = '<span class="text-xs text-slate-500 font-mono py-2">No example images added yet. Upload up to 5 images (PNG, JPG, WEBP).</span>';
    return;
  }

  container.innerHTML = state.modalUploadedImages.map((src, idx) => `
    <div class="relative group w-16 h-16 rounded-lg overflow-hidden border border-obsidian-border bg-obsidian-deepest shrink-0">
      <img src="${src}" class="w-full h-full object-cover" alt="Example Image ${idx + 1}" />
      <button type="button" class="btn-remove-modal-img absolute top-1 right-1 bg-black/75 hover:bg-rose-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition" data-idx="${idx}" title="Remove image">
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-remove-modal-img').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      state.modalUploadedImages.splice(idx, 1);
      renderModalImages();
    };
  });
}

const CLAUDE_STYLE_PROMPT = `I've attached reference images. Analyze all of them together and create one downloadable file named images.json (extension must be .json, not .md or .txt). Output only this file, nothing else.

Keep it SHORT. Write one single JSON object, not one entry per image, with exactly these keys and one or two lines for each:

{
  "art_style_and_medium": "one sentence: medium, linework, color fill, texture, overall look",
  "character_design": "one sentence: head, face, body, outfit of the recurring figure",
  "rendering_details": "one sentence: line weight, shading, background simplicity, mood, how emotions are shown",
  "negative_directives": "comma-separated list of things to avoid"
}

Rules:
- Use the images only as style reference. Do not describe, count or mention the individual scenes, rooms, poses or story anywhere in the JSON
- Do not include colour codes, hex values or fixed colour palettes anywhere in the JSON
- Keep every value short and plain, no long paragraphs, no nested details
- Write everything as a single paragraph: each value must be one continuous paragraph of plain text, with no line breaks, bullet points, lists, headings or sections inside any value
- No aspect ratio, resolution, size or timing anywhere
- No text, speech bubbles or logos in the images
- Valid JSON only
- Save as /mnt/user-data/outputs/images.json and present it with present_files so it can be downloaded`;

function initSkillModalListeners() {
  const cancelBtn = $('modal-btn-cancel');
  const closeX = $('modal-btn-close-x');
  const saveBtn = $('modal-btn-save');

  if (cancelBtn) cancelBtn.onclick = closeSkillModal;
  if (closeX) closeX.onclick = closeSkillModal;

  // Toggle Claude Guide Collapse / Expand
  const toggleGuideBtn = $('modal-toggle-claude-guide');
  const guideBody = $('modal-claude-guide-body');
  const guideChevron = $('modal-guide-chevron');

  if (toggleGuideBtn && guideBody) {
    toggleGuideBtn.onclick = () => {
      const isHidden = guideBody.classList.toggle('hidden');
      if (guideChevron) {
        guideChevron.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
      }
    };
  }

  // Import Style JSON File
  const importJsonBtn = $('modal-btn-import-json');
  const importJsonInput = $('modal-skill-json-file-input');

  if (importJsonBtn && importJsonInput) {
    importJsonBtn.onclick = () => importJsonInput.click();
    importJsonInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const { skill, extractedCaptions } = normalizeSkillFromAnyJSON(parsed);
        const nameInput = $('modal-skill-name');
        const prefixInput = $('modal-skill-prefix');
        const guideInput = $('modal-skill-guide');

        if (nameInput && skill.name) nameInput.value = skill.name;
        if (prefixInput && skill.stylePrefix) prefixInput.value = skill.stylePrefix;
        if (guideInput && skill.styleGuide) guideInput.value = skill.styleGuide;
        if (skill.thumbnails && skill.thumbnails.length) {
          state.modalUploadedImages = skill.thumbnails;
        }

        if (extractedCaptions) {
          const inputEl = $('pr-captions-input');
          if (inputEl && !inputEl.value.trim()) {
            inputEl.value = extractedCaptions;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            showToast(`Imported style "${skill.name || file.name}" and loaded scene captions!`, 'success');
          } else {
            showToast(`Imported style "${skill.name || file.name}"! Review and click Save Skill.`, 'success');
          }
        } else {
          showToast(`Imported style "${skill.name || file.name}"! Review and click Save Skill.`, 'success');
        }
      } catch (err) {
        showToast(`JSON parsing failed: ${err.message}`, 'error');
      } finally {
        importJsonInput.value = '';
      }
    };
  }

  // Copy Claude Style Prompt
  const copyClaudePromptBtn = $('modal-btn-copy-claude-prompt');
  const copyPromptLabel = $('modal-copy-prompt-label');

  if (copyClaudePromptBtn) {
    copyClaudePromptBtn.onclick = async (e) => {
      if (e) e.stopPropagation();
      const textToCopy = CLAUDE_STYLE_PROMPT;
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
          copied = true;
        }
      } catch {}

      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          copied = document.execCommand('copy');
          ta.remove();
        } catch {}
      }

      if (copyPromptLabel) copyPromptLabel.textContent = 'Copied!';
      showToast('Prompt copied to clipboard! Paste it into Claude.', 'success');
      setTimeout(() => {
        if (copyPromptLabel) copyPromptLabel.textContent = 'Copy Prompt';
      }, 2200);
    };
  }

  // Save Skill
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const name = ($('modal-skill-name')?.value || '').trim();
      const existing = state.modalEditingSkillId ? await getSkillById(state.modalEditingSkillId) : null;
      const stylePrefix = ($('modal-skill-prefix')?.value || existing?.stylePrefix || '').trim();
      const styleGuide = ($('modal-skill-guide')?.value || '').trim();

      if (!name) {
        showToast('Please give your visual style skill a name.', 'warn');
        return;
      }

      try {
        const skillObj = {
          id: state.modalEditingSkillId || null,
          name,
          stylePrefix,
          styleGuide,
          thumbnails: state.modalUploadedImages.slice(0, 5)
        };
        const saved = await saveSkill(skillObj);
        state.selectedSkillId = saved.id;
        showToast(`Skill "${saved.name}" saved successfully!`, 'success');
        closeSkillModal();
        refreshSkillsUI();
        applySkillToOutputItems(saved.id);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }
}

// ── 4. Input Captions & Real-Time Validation ────────────────────────────────

function initInputCaptionsUI() {
  const inputEl = $('pr-captions-input');
  const countBadge = $('pr-lines-count-badge');
  const alertBox = $('pr-validation-alerts');
  const loadTxtBtn = $('pr-btn-load-txt');
  const txtInput = $('pr-input-load-txt');
  const pasteTimingBtn = $('pr-btn-paste-timing') || $('pr-btn-paste-splitter');
  const clearBtn = $('pr-btn-clear-captions');

  function validateInput() {
    if (!inputEl) return;
    const text = inputEl.value;
    state.captionText = text;
    state.validation = validateCaptionLines(text);

    if (countBadge) {
      countBadge.textContent = `${state.validation.validCount} timestamp lines found`;
      countBadge.className = state.validation.valid 
        ? 'px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
        : 'px-2 py-0.5 rounded text-[11px] font-mono bg-teal-500/10 text-teal-400 border border-teal-500/30';
    }

    if (alertBox) {
      if (!text.trim()) {
        alertBox.classList.add('hidden');
        alertBox.innerHTML = '';
        return;
      }

      if (state.validation.valid) {
        alertBox.className = 'p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2';
        alertBox.innerHTML = `
          <svg class="w-4 h-4 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>All <strong>${state.validation.validCount}</strong> timestamped lines verified in chronological order. Ready to generate prompts.</span>
        `;
        alertBox.classList.remove('hidden');
      } else {
        alertBox.className = 'p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex flex-col gap-1.5';
        let html = `
          <div class="flex items-center gap-2 font-bold text-rose-400">
            <svg class="w-4 h-4 text-rose-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Formatting errors detected in caption text:</span>
          </div>
          <ul class="list-disc pl-5 space-y-1 text-slate-300">
        `;
        if (state.validation.badLines.length) {
          html += `<li><strong>${state.validation.badLines.length}</strong> line(s) missing valid timestamp (e.g. line ${state.validation.badLines.map(b => b.lineNum).slice(0, 5).join(', ')})</li>`;
        }
        if (state.validation.duplicateTimes.length) {
          html += `<li>Duplicate timestamps detected: ${state.validation.duplicateTimes.map(d => `${d.rawTime} on lines ${d.lineNums.join(', ')}`).join('; ')}</li>`;
        }
        if (state.validation.outOfOrderTimes.length) {
          html += `<li>Timestamps out of chronological order at line ${state.validation.outOfOrderTimes[0].lineNum} (${state.validation.outOfOrderTimes[0].rawTime} after ${state.validation.outOfOrderTimes[0].prevTime})</li>`;
        }
        html += `</ul>`;
        alertBox.innerHTML = html;
        alertBox.classList.remove('hidden');
      }
    }
  }

  let debounceTimer;
  if (inputEl) {
    inputEl.oninput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(validateInput, 200);
    };
    inputEl.onchange = () => {
      clearTimeout(debounceTimer);
      validateInput();
    };
  }

  // Load TXT or SRT
  if (loadTxtBtn && txtInput) {
    loadTxtBtn.onclick = () => txtInput.click();
    txtInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        inputEl.value = text;
        validateInput();
        showToast(`Loaded ${file.name}`, 'info');
      } catch (err) {
        showToast(`Could not read file: ${err.message}`, 'error');
      } finally {
        txtInput.value = '';
      }
    };
  }

  // Paste from Timing
  if (pasteTimingBtn) {
    pasteTimingBtn.onclick = () => {
      // 1. Try window.getTimingCaptionsTxt() (or legacy alias)
      let captions = '';
      const getTimingFn = window.getTimingCaptionsTxt || window.getSplitterCaptionsTxt;
      if (typeof getTimingFn === 'function') {
        captions = getTimingFn();
      }
      // 2. Try #caption-text in Studio
      if (!captions && $('caption-text')) {
        captions = $('caption-text').value;
      }

      if (captions && captions.trim()) {
        inputEl.value = captions.trim();
        validateInput();
        showToast('Pasted timestamped captions from Timing!', 'success');
      } else {
        showToast('No Timing captions found yet. Generate timestamps in Timing first or paste here.', 'warn');
      }
    };
  }

  // Clear captions only
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (inputEl) inputEl.value = '';
      validateInput();
    };
  }

  // Reset entire Prompts workspace (keeps saved API key & Skills)
  const resetBtn = $('pr-btn-reset');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (state.isGenerating && state.abortController) {
        try { state.abortController.abort(); } catch {}
      }
      state.isGenerating = false;
      state.abortController = null;
      state.notes = '';
      state.captionText = '';
      state.outputItems = [];
      state.rawOutputText = '';
      state.failedBatches = [];
      state.activeBatchesData = null;
      state.selectedSkillId = 'none';
      state.language = 'English';
      state.blankLines = true;

      if (inputEl) inputEl.value = '';
      if ($('pr-skill-select')) $('pr-skill-select').value = 'none';
      if ($('pr-setting-language')) $('pr-setting-language').value = 'English';
      if ($('pr-toggle-blank-lines')) $('pr-toggle-blank-lines').checked = true;
      if ($('pr-progress-wrap')) $('pr-progress-wrap').classList.add('hidden');
      if ($('pr-btn-retry-failed')) $('pr-btn-retry-failed').classList.add('hidden');
      if ($('pr-btn-generate')) $('pr-btn-generate').disabled = false;

      validateInput();
      refreshSkillsUI();
      renderOutputUI();
      showToast('Prompts workspace reset.', 'info');
    };
  }
}

// ── 5. Generation Controller (Batches of ~20 Lines with Verification) ───────

function initGenerationUI() {
  const genBtn = $('pr-btn-generate');
  const cancelBtn = $('pr-btn-cancel-generation');
  const progressWrap = $('pr-progress-wrap');
  const progressBar = $('pr-progress-bar');
  const progressText = $('pr-progress-text');
  const retryBtn = $('pr-btn-retry-failed');

  // Settings elements
  const lenSelect = $('pr-setting-length');
  if (lenSelect) lenSelect.onchange = (e) => state.promptLength = e.target.value;

  const langSelect = $('pr-setting-language');
  if (langSelect) langSelect.onchange = (e) => state.language = e.target.value;

  const arSelect = $('pr-setting-aspect-ratio');
  if (arSelect) arSelect.onchange = (e) => state.aspectRatio = e.target.value;

  const blankToggle = $('pr-toggle-blank-lines');
  if (blankToggle) {
    blankToggle.onchange = (e) => {
      state.blankLines = e.target.checked;
      renderOutputUI();
    };
  }

  // Cancel Generation
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (state.abortController) {
        state.abortController.abort();
      }
      state.isGenerating = false;
      showToast('Generation cancelled.', 'warn');
      if (progressWrap) progressWrap.classList.add('hidden');
      if (genBtn) genBtn.disabled = false;
    };
  }

  // Start Generation
  if (genBtn) {
    genBtn.onclick = () => startBatchedGeneration();
  }

  if (retryBtn) {
    retryBtn.onclick = () => retryFailedBatches();
  }
}

async function startBatchedGeneration() {
  if (!state.apiKey) {
    showToast('Please enter and test your Groq API key in Section 1.', 'warn');
    return;
  }

  const inputLines = state.validation?.lines || [];
  if (!inputLines.length || !state.validation.valid) {
    showToast('Please ensure your caption lines have valid, ordered timestamps with no errors.', 'warn');
    return;
  }

  state.isGenerating = true;
  state.abortController = new AbortController();
  state.failedBatches = [];

  const genBtn = $('pr-btn-generate');
  const progressWrap = $('pr-progress-wrap');
  const progressBar = $('pr-progress-bar');
  const progressText = $('pr-progress-text');
  const retryBtn = $('pr-btn-retry-failed');

  if (genBtn) genBtn.disabled = true;
  if (progressWrap) progressWrap.classList.remove('hidden');
  if (retryBtn) retryBtn.classList.add('hidden');

  // Find active skill data
  let styleGuide = '';
  let stylePrefix = '';
  if (state.selectedSkillId && state.selectedSkillId !== 'none') {
    const activeSkill = state.skills.find(s => s.id === state.selectedSkillId);
    if (activeSkill) {
      styleGuide = activeSkill.styleGuide || '';
      stylePrefix = activeSkill.stylePrefix || '';
    }
  }

  // Create batches of 10 with 3 lines context (e.g. 100 prompts in 10 requests)
  const batches = createBatches(inputLines, 10, 3);
  state.activeBatchesData = { batches, resultsByBatch: new Map() };

  for (let b = 0; b < batches.length; b++) {
    if (!state.isGenerating) break;

    const batch = batches[b];
    const pct = Math.round((b / batches.length) * 100);

    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `Processing batch ${b + 1} of ${batches.length} (${batch.items.length} lines)...`;

    let batchSuccess = false;
    let attempts = 0;

    while (attempts < 2 && !batchSuccess) {
      attempts++;
      try {
        const batchResults = await generatePromptsBatch(state.apiKey, state.model, {
          batchItems: batch.items,
          prevContext: batch.prevContext,
          nextContext: batch.nextContext,
          directives: state.notes,
          settings: {
            promptLength: state.promptLength,
            language: state.language
          }
        });

        // Verify count matches batch
        if (batchResults && batchResults.length > 0) {
          state.activeBatchesData.resultsByBatch.set(b, batchResults);
          batchSuccess = true;
        } else {
          throw new Error('Batch returned 0 prompts');
        }
      } catch (err) {
        console.warn(`Batch ${b + 1} attempt ${attempts} failed:`, err);
        if (attempts >= 2) {
          state.failedBatches.push(b);
        }
      }
    }
  }

  // Finalize Generation
  if (progressBar) progressBar.style.width = '100%';
  if (progressText) progressText.textContent = 'Assembling and verifying prompts output...';

  // Merge all batch results
  const allModelResults = [];
  for (let b = 0; b < batches.length; b++) {
    const res = state.activeBatchesData.resultsByBatch.get(b) || [];
    allModelResults.push(...res);
  }

  // Build Prompts with guaranteed original timestamps
  const built = buildPromptsOutput(inputLines, allModelResults, {
    blankLineBetweenPrompts: state.blankLines,
    styleGuide,
    stylePrefix,
    aspectRatio: state.aspectRatio
  });

  state.outputItems = built.items;
  state.styleGuideHeader = built.styleGuideHeader;
  state.rawOutputText = built.rawOutputText;

  renderOutputUI();

  state.isGenerating = false;
  if (genBtn) genBtn.disabled = false;
  if (progressWrap) progressWrap.classList.add('hidden');

  if (state.failedBatches.length > 0) {
    if (retryBtn) retryBtn.classList.remove('hidden');
    showToast(`Completed with ${state.failedBatches.length} batch error(s). Click Retry Failed Batches to finish.`, 'warn');
  } else {
    showToast(`✓ Successfully generated ${built.items.length} prompts 1:1 synced to timestamps!`, 'success');
  }
}

async function retryFailedBatches() {
  if (!state.failedBatches.length || !state.activeBatchesData) return;
  const batchesToRetry = [...state.failedBatches];
  state.failedBatches = [];

  const progressWrap = $('pr-progress-wrap');
  const progressBar = $('pr-progress-bar');
  const progressText = $('pr-progress-text');
  const retryBtn = $('pr-btn-retry-failed');

  if (progressWrap) progressWrap.classList.remove('hidden');
  if (retryBtn) retryBtn.classList.add('hidden');

  let styleGuide = '';
  let stylePrefix = '';
  if (state.selectedSkillId && state.selectedSkillId !== 'none') {
    const activeSkill = state.skills.find(s => s.id === state.selectedSkillId);
    if (activeSkill) {
      styleGuide = activeSkill.styleGuide || '';
      stylePrefix = activeSkill.stylePrefix || '';
    }
  }

  for (const b of batchesToRetry) {
    const batch = state.activeBatchesData.batches[b];
    if (progressText) progressText.textContent = `Retrying batch ${b + 1}...`;
    try {
      const batchResults = await generatePromptsBatch(state.apiKey, state.model, {
        batchItems: batch.items,
        prevContext: batch.prevContext,
        nextContext: batch.nextContext,
        directives: state.notes,
        settings: {
          promptLength: state.promptLength,
          language: state.language
        }
      });
      state.activeBatchesData.resultsByBatch.set(b, batchResults);
    } catch (err) {
      state.failedBatches.push(b);
    }
  }

  // Rebuild
  const allModelResults = [];
  for (let b = 0; b < state.activeBatchesData.batches.length; b++) {
    const res = state.activeBatchesData.resultsByBatch.get(b) || [];
    allModelResults.push(...res);
  }

  const built = buildPromptsOutput(state.validation.lines, allModelResults, {
    blankLineBetweenPrompts: state.blankLines,
    styleGuide,
    stylePrefix,
    aspectRatio: state.aspectRatio
  });

  state.outputItems = built.items;
  state.styleGuideHeader = built.styleGuideHeader;
  state.rawOutputText = built.rawOutputText;
  renderOutputUI();

  if (progressWrap) progressWrap.classList.add('hidden');
  if (state.failedBatches.length > 0) {
    if (retryBtn) retryBtn.classList.remove('hidden');
    showToast(`Still ${state.failedBatches.length} batch(es) failed. Check your API key/network.`, 'error');
  } else {
    showToast('All batches successfully recovered!', 'success');
  }
}

// ── 6. Output Prompts Rendering & Actions ───────────────────────────────────

function renderOutputUI() {
  const container = $('pr-prompts-list');
  const countBadge = $('pr-output-count-badge');
  const section = $('pr-output-section');

  if (!section || !container) return;

  if (!state.outputItems.length) {
    section.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');

  if (countBadge) {
    countBadge.textContent = `${state.outputItems.length} Prompts`;
  }

  // Hide Visual Style Guide Banner since style guide is directly included in each prompt
  const styleBanner = $('pr-style-guide-banner');
  const styleBannerText = $('pr-style-guide-banner-text');
  if (styleBanner) {
    styleBanner.classList.add('hidden');
    if (styleBannerText) styleBannerText.textContent = '';
  }

  const delimiter = state.blankLines ? '\n\n' : '\n';
  state.rawOutputText = state.outputItems.map(it => it.fullPromptLine).join(delimiter);

  container.innerHTML = state.outputItems.map((item, idx) => `
    <div class="prompt-row group bg-obsidian-container border border-obsidian-border rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition hover:border-obsidian-borderHover" data-idx="${idx}">
      <div class="flex items-start sm:items-center gap-3 w-full sm:w-auto flex-1">
        <span class="px-2.5 py-1 rounded bg-brand-primary/15 border border-brand-primary/30 text-brand-primary font-mono text-xs font-bold shrink-0">
          ${item.rawTime}
        </span>
        <div class="flex-1 w-full">
          <textarea class="prompt-input w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-2.5 py-2 text-xs text-slate-100 font-sans focus:border-brand-primary focus:outline-none resize-y leading-relaxed transition min-h-[96px]" rows="4" data-idx="${idx}">${item.promptText}</textarea>
          <div class="text-[10px] text-slate-500 font-sans truncate mt-0.5">Caption: "${item.captionText}"</div>
        </div>
      </div>
      <div class="flex items-center gap-1.5 self-end sm:self-center shrink-0">
        <button class="btn-copy-line px-2 py-1 rounded bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-slate-300 hover:text-white text-xs font-medium transition flex items-center gap-1" data-idx="${idx}" title="Copy this prompt line">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="hidden sm:inline">Copy</span>
        </button>
        <button class="btn-regen-line px-2 py-1 rounded bg-obsidian-surface hover:bg-teal-500/15 hover:text-teal-300 border border-obsidian-border text-slate-300 text-xs font-medium transition flex items-center gap-1" data-idx="${idx}" title="Regenerate this prompt with neighbouring context">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span class="hidden sm:inline">Regen</span>
        </button>
      </div>
    </div>
  `).join('');

  // Editable in-place prompt listeners
  container.querySelectorAll('.prompt-input').forEach(textarea => {
    textarea.oninput = (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (state.outputItems[idx]) {
        state.outputItems[idx].promptText = e.target.value;
        state.outputItems[idx].fullPromptLine = `${state.outputItems[idx].rawTime} ${state.outputItems[idx].promptText}`;
        const delimiter = state.blankLines ? '\n\n' : '\n';
        state.rawOutputText = state.outputItems.map(it => it.fullPromptLine).join(delimiter);
      }
    };
  });

  // Per-line copy
  container.querySelectorAll('.btn-copy-line').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const item = state.outputItems[idx];
      if (item) {
        const full = `${item.rawTime} ${item.promptText}`;
        copyToClipboard(full);
        showToast(`Copied prompt for ${item.rawTime}`, 'success');
      }
    };
  });

  // Per-line Regenerate (using neighbouring context)
  container.querySelectorAll('.btn-regen-line').forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const item = state.outputItems[idx];
      if (!item) return;

      btn.disabled = true;
      const oldHtml = btn.innerHTML;
      btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>`;

      let styleGuide = '';
      let stylePrefix = '';
      if (state.selectedSkillId && state.selectedSkillId !== 'none') {
        const activeSkill = state.skills.find(s => s.id === state.selectedSkillId);
        if (activeSkill) {
          styleGuide = activeSkill.styleGuide || '';
          stylePrefix = activeSkill.stylePrefix || '';
        }
      }

      const prevContext = state.outputItems.slice(Math.max(0, idx - 2), idx).map(it => ({ rawTime: it.rawTime, text: it.captionText }));
      const nextContext = state.outputItems.slice(idx + 1, Math.min(state.outputItems.length, idx + 3)).map(it => ({ rawTime: it.rawTime, text: it.captionText }));

      try {
        const newPrompt = await regenerateSinglePrompt(state.apiKey, state.model, {
          targetItem: { rawTime: item.rawTime, text: item.captionText },
          prevContext,
          nextContext,
          directives: state.notes,
          settings: {
            promptLength: state.promptLength,
            language: state.language
          }
        });

        const cleanScene = cleanPromptText(newPrompt);
        item.scenePrompt = cleanScene;
        let finalPrompt = cleanScene;
        const formattedGuide = formatStyleGuideAsLines(styleGuide);

        if (formattedGuide) {
          const sep = /[.!?]$/.test(formattedGuide) ? '  ' : '.  ';
          finalPrompt = `${formattedGuide}${sep}${cleanScene}`;
        } else if (stylePrefix) {
          const cleanPrefix = stylePrefix.trim();
          if (!finalPrompt.toLowerCase().startsWith(cleanPrefix.toLowerCase())) {
            const sep = /[.!?]$/.test(cleanPrefix) ? ' ' : '. ';
            finalPrompt = `${cleanPrefix}${sep}${finalPrompt}`;
          }
        }
        if (state.aspectRatio) {
          const arToken = state.aspectRatio.startsWith('--ar') ? state.aspectRatio : `--ar ${state.aspectRatio}`;
          if (!finalPrompt.includes(arToken)) {
            finalPrompt = `${finalPrompt} ${arToken}`;
          }
        }
        item.promptText = finalPrompt;
        item.fullPromptLine = `${item.rawTime} ${item.promptText}`;
        const delimiter = state.blankLines ? '\n\n' : '\n';
        state.rawOutputText = state.outputItems.map(it => it.fullPromptLine).join(delimiter);
        renderOutputUI();
        showToast(`Regenerated prompt for ${item.rawTime}`, 'success');
      } catch (err) {
        showToast(`Regeneration failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    };
  });
}

function initOutputActionsUI() {
  const copyAllBtn = $('pr-btn-copy-all');
  const downloadBtn = $('pr-btn-download-txt');
  const saveProjBtn = $('pr-btn-save-project');
  const openProjBtn = $('pr-btn-open-project');
  const projFileInput = $('pr-input-open-project');

  // Copy All
  if (copyAllBtn) {
    copyAllBtn.onclick = () => {
      if (!state.outputItems.length) {
        showToast('No prompts to copy.', 'info');
        return;
      }
      const delimiter = state.blankLines ? '\n\n' : '\n';
      const fallback = state.outputItems.map(it => `${it.rawTime} ${it.promptText}`).join(delimiter);
      const text = state.rawOutputText || fallback;
      copyToClipboard(text);
      showToast(`Copied all ${state.outputItems.length} prompts to clipboard!`, 'success');
    };
  }

  // Download TXT
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      if (!state.outputItems.length) {
        showToast('No prompts to download.', 'info');
        return;
      }
      const delimiter = state.blankLines ? '\n\n' : '\n';
      const fallback = state.outputItems.map(it => `${it.rawTime} ${it.promptText}`).join(delimiter);
      const text = state.rawOutputText || fallback;
      downloadFile('sceneflow_prompts.txt', text, 'text/plain');
      showToast('Downloaded sceneflow_prompts.txt', 'success');
    };
  }

  // Save Project (Local JSON, NO API KEY)
  if (saveProjBtn) {
    saveProjBtn.onclick = () => {
      const activeSkill = state.skills.find(s => s.id === state.selectedSkillId);
      const proj = {
        version: '1.0',
        type: 'sceneflow_prompts_project',
        savedAt: new Date().toISOString(),
        inputCaptions: $('pr-captions-input')?.value || '',
        selectedSkillName: activeSkill ? activeSkill.name : 'none',
        notes: state.notes,
        settings: {
          promptLength: state.promptLength,
          language: state.language,
          aspectRatio: state.aspectRatio,
          blankLines: state.blankLines
        },
        outputPrompts: state.outputItems.map(it => ({
          rawTime: it.rawTime,
          caption: it.captionText,
          prompt: it.promptText
        }))
      };
      // NEVER save API key
      delete proj.apiKey;
      delete proj.key;

      downloadFile('sceneflow_prompts_project.json', JSON.stringify(proj, null, 2), 'application/json');
      showToast('Saved project locally.', 'success');
    };
  }

  // Open Project
  if (openProjBtn && projFileInput) {
    openProjBtn.onclick = () => projFileInput.click();
    projFileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const proj = JSON.parse(text);

        if (proj.inputCaptions && $('pr-captions-input')) {
          $('pr-captions-input').value = proj.inputCaptions;
          $('pr-captions-input').dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (proj.notes && $('pr-style-notes')) {
          $('pr-style-notes').value = proj.notes;
          state.notes = proj.notes;
        }
        if (proj.settings) {
          if (proj.settings.promptLength && $('pr-setting-length')) {
            $('pr-setting-length').value = proj.settings.promptLength;
            state.promptLength = proj.settings.promptLength;
          }
          if (proj.settings.language && $('pr-setting-language')) {
            $('pr-setting-language').value = proj.settings.language;
            state.language = proj.settings.language;
          }
          if (proj.settings.aspectRatio && $('pr-setting-aspect-ratio')) {
            $('pr-setting-aspect-ratio').value = proj.settings.aspectRatio;
            state.aspectRatio = proj.settings.aspectRatio;
          }
          if (proj.settings.blankLines !== undefined && $('pr-toggle-blank-lines')) {
            $('pr-toggle-blank-lines').checked = !!proj.settings.blankLines;
            state.blankLines = !!proj.settings.blankLines;
          }
        }
        if (proj.outputPrompts && Array.isArray(proj.outputPrompts)) {
          state.outputItems = proj.outputPrompts.map((p, idx) => ({
            index: idx,
            rawTime: p.rawTime,
            cleanTime: p.rawTime.replace(/^[\(\[]/, '').replace(/[\)\]]$/, ''),
            captionText: p.caption || '',
            promptText: p.prompt || '',
            fullPromptLine: `${p.rawTime} ${p.prompt}`,
            isMissing: false
          }));
          renderOutputUI();
        }

        showToast('Opened project successfully!', 'success');
      } catch (err) {
        showToast(`Could not open project: ${err.message}`, 'error');
      } finally {
        projFileInput.value = '';
      }
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function downloadFile(filename, content, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── 7. Main Entry Point ─────────────────────────────────────────────────────

export function initPromptsUI() {
  initApiKeyUI();
  initSkillsUI();
  initSkillModalListeners();
  initInputCaptionsUI();
  initGenerationUI();
  initOutputActionsUI();
}

export const initPromptUI = initPromptsUI;
