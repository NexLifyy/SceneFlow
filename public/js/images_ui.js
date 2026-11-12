/**
 * images_ui.js — UI Controller for SceneFlow Images (Free Bulk Generation)
 */

export const FREE_BULK_IMAGE_URL = 'https://share.gemini.google/NSIngZmfcsMu';

const $ = (id) => document.getElementById(id);

export async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
  return false;
}

export function extractGeneratedPromptsText() {
  if (typeof document === 'undefined') return '';
  const rows = document.querySelectorAll('#pr-prompts-list .prompt-row');
  if (!rows || !rows.length) return '';

  const lines = [];
  rows.forEach((row) => {
    const timeBadge = row.querySelector('span');
    const textarea = row.querySelector('.prompt-input');
    const rawTime = timeBadge ? timeBadge.textContent.trim() : '';
    const promptVal = textarea ? textarea.value.trim() : '';
    if (rawTime && promptVal) {
      lines.push(`${rawTime} ${promptVal}`);
    } else if (promptVal) {
      lines.push(promptVal);
    }
  });
  return lines.join('\n');
}

export function initImagesUI() {
  const copyLinkBtn = $('img-btn-copy-link');
  const copyLinkLabel = $('img-copy-link-label');
  const copyPromptsBtn = $('img-btn-copy-prompts');
  const copyPromptsFeedback = $('img-copy-prompts-feedback');
  const openBtn = $('img-btn-open-bulk');

  if (openBtn) {
    openBtn.href = FREE_BULK_IMAGE_URL;
  }

  let resetTimer = null;

  if (copyLinkBtn) {
    copyLinkBtn.onclick = async () => {
      const ok = await copyTextToClipboard(FREE_BULK_IMAGE_URL);
      if (copyLinkLabel) {
        copyLinkLabel.textContent = ok ? 'Copied!' : FREE_BULK_IMAGE_URL;
      }
      copyLinkBtn.classList.add('border-emerald-500/60', 'text-emerald-300');
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        if (copyLinkLabel) copyLinkLabel.textContent = 'Copy link';
        copyLinkBtn.classList.remove('border-emerald-500/60', 'text-emerald-300');
      }, 2200);
    };
  }

  if (copyPromptsBtn) {
    copyPromptsBtn.onclick = async () => {
      const text = extractGeneratedPromptsText();
      if (!text) {
        if (typeof window.switchToTab === 'function') {
          window.switchToTab('prompts');
        }
        return;
      }
      const ok = await copyTextToClipboard(text);
      if (copyPromptsFeedback) {
        copyPromptsFeedback.textContent = ok
          ? '✓ Prompts copied to clipboard!'
          : 'Select & copy from Prompts tab.';
        copyPromptsFeedback.classList.remove('hidden');
        setTimeout(() => copyPromptsFeedback.classList.add('hidden'), 2500);
      }
    };
  }

  // Wire navigation links inside #page-images
  document.querySelectorAll('#page-images [data-nav-target]').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      const target = el.getAttribute('data-nav-target');
      if (target && typeof window.switchToTab === 'function') {
        window.switchToTab(target);
      }
    };
  });
}

export const initImageUI = initImagesUI;
