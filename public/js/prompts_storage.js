/**
 * prompts_storage.js — Cookie handling for Groq API Key & Model, and IndexedDB for Skills
 */

// ── 1. Model Configuration Constant ─────────────────────────────────────────
export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile (Recommended, High Quality & Fast)', isDefault: true },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Ultra Fast)' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B 32k' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B IT' },
  { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill Llama 70B (Reasoning)' }
];

// Backwards-compatibility alias
export const GEMINI_MODELS = GROQ_MODELS;

export const MAX_SKILLS = 5;

// Preserved cookie names and IndexedDB database name ('PromptHunterSkillsDB')
// so previously saved user API keys, model choices, and Skills load cleanly after the SceneFlow rename.
const COOKIE_KEY_NAME = 'groq_api_key';
const COOKIE_MODEL_NAME = 'groq_model';
const LEGACY_COOKIE_KEY_NAME = 'gemini_api_key';
const DB_NAME = 'PromptHunterSkillsDB';
const DB_VERSION = 1;
const STORE_NAME = 'skills';

// ── 2. Cookie Helpers (SameSite=Strict, Secure on https, 1-Year Expiry) ───────

export function getCookie(name) {
  if (typeof document === 'undefined') return '';
  const prefix = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (let c of cookies) {
    c = c.trim();
    if (c.startsWith(prefix)) {
      return decodeURIComponent(c.substring(prefix.length));
    }
  }
  return '';
}

export function setCookie(name, value, days = 365) {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60;
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const secureFlag = isSecure ? '; Secure' : '';
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Strict${secureFlag}`;
}

export function deleteCookie(name) {
  if (typeof document === 'undefined') return;
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const secureFlag = isSecure ? '; Secure' : '';
  document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Strict${secureFlag}`;
}

export function getStoredApiKey() {
  const groqKey = getCookie(COOKIE_KEY_NAME);
  if (groqKey) return groqKey;
  return getCookie(LEGACY_COOKIE_KEY_NAME);
}

export function saveApiKeyCookie(key) {
  const clean = (key || '').trim();
  if (!clean) {
    deleteCookie(COOKIE_KEY_NAME);
    deleteCookie(LEGACY_COOKIE_KEY_NAME);
    return;
  }
  setCookie(COOKIE_KEY_NAME, clean, 365);
}

export function removeApiKeyCookie() {
  deleteCookie(COOKIE_KEY_NAME);
  deleteCookie(LEGACY_COOKIE_KEY_NAME);
}

export function maskApiKey(key) {
  if (!key) return '';
  const clean = key.trim();
  if (clean.length <= 8) return '••••••••';
  if (clean.startsWith('gsk_')) {
    const suffix = clean.slice(-4);
    return `gsk_••••••••${suffix}`;
  }
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}••••••${suffix}`;
}

export function getStoredModel() {
  const stored = getCookie(COOKIE_MODEL_NAME);
  if (stored && GROQ_MODELS.some(m => m.id === stored)) {
    return stored;
  }
  const def = GROQ_MODELS.find(m => m.isDefault);
  return def ? def.id : GROQ_MODELS[0].id;
}

export function saveModelCookie(modelId) {
  setCookie(COOKIE_MODEL_NAME, modelId, 365);
}

// ── 3. Image Thumbnail Resizing (~256px) ────────────────────────────────────

/**
 * Resizes an image file/blob to max 256px preserving aspect ratio and returns base64 data URL.
 * @param {File|Blob} file
 * @param {number} maxDim
 * @returns {Promise<string>}
 */
export async function resizeImageToThumbnail(file, maxDim = 256) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file provided'));
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const base64 = canvas.toDataURL('image/jpeg', 0.85);
      resolve(base64);
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };

    img.src = objectUrl;
  });
}

// ── 4. IndexedDB Skills Storage ─────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Request persistent storage from the browser.
 */
export async function requestPersistentStorage() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        return await navigator.storage.persist();
      }
      return true;
    } catch (e) {
      console.warn('Storage persistence request failed:', e);
      return false;
    }
  }
  return false;
}

/**
 * Retrieve all skills from IndexedDB, sorted by updatedAt desc.
 * @returns {Promise<Array>}
 */
export async function getAllSkills() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get a single skill by id.
 * @param {string} id 
 * @returns {Promise<object|null>}
 */
export async function getSkillById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save or update a skill. Enforces maximum 5 skills limit for new creations.
 * @param {object} skill
 * @returns {Promise<object>}
 */
export async function saveSkill(skill) {
  if (!skill) throw new Error('Skill object required');
  const db = await openDB();

  // Check 5 skills limit if creating new
  const existing = await getAllSkills();
  const isExisting = existing.some(s => s.id === skill.id);

  if (!isExisting && existing.length >= MAX_SKILLS) {
    throw new Error(`Maximum ${MAX_SKILLS} skills reached. Delete a skill to add another.`);
  }

  const cleanSkill = {
    id: skill.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name: (skill.name || 'Untitled Style Skill').trim(),
    styleGuide: (skill.styleGuide || '').trim(),
    stylePrefix: (skill.stylePrefix || '').trim(),
    thumbnails: Array.isArray(skill.thumbnails) ? skill.thumbnails.slice(0, 5) : [],
    createdAt: skill.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  // NEVER allow API key inside skill
  delete cleanSkill.apiKey;
  delete cleanSkill.key;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(cleanSkill);
    req.onsuccess = () => resolve(cleanSkill);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Duplicate an existing skill.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function duplicateSkill(id) {
  const existing = await getAllSkills();
  if (existing.length >= MAX_SKILLS) {
    throw new Error(`Maximum ${MAX_SKILLS} skills reached. Delete a skill to add another.`);
  }

  const orig = existing.find(s => s.id === id);
  if (!orig) throw new Error('Skill not found to duplicate');

  const dup = {
    ...orig,
    id: `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name: `${orig.name} (Copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  return saveSkill(dup);
}

/**
 * Delete a skill by id.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteSkill(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// ── 5. Skill Import & Export (JSON with Base64 Thumbnails) ───────────────────

/**
 * Export a single skill as JSON file string.
 * @param {object} skill
 * @returns {string}
 */
export function exportSkillJSON(skill) {
  const copy = { ...skill };
  // Ensure no API keys or sensitive data
  delete copy.apiKey;
  delete copy.key;
  return JSON.stringify(copy, null, 2);
}

/**
 * Export all skills as a backup bundle.
 * @param {Array} skills
 * @returns {string}
 */
export function exportAllSkillsJSON(skills) {
  const cleanList = skills.map(s => {
    const c = { ...s };
    delete c.apiKey;
    delete c.key;
    return c;
  });
  const bundle = {
    version: '1.0',
    type: 'sceneflow_skills_backup',
    exportedAt: new Date().toISOString(),
    skills: cleanList
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Universal normalizer: converts ANY JSON from Claude, ChatGPT, Midjourney bibles,
 * custom schemas, SceneFlow backups, or legacy skills backups into a clean Skill object.
 * @param {object} parsed
 * @returns {{ skill: object, extractedCaptions: string }}
 */
export function normalizeSkillFromAnyJSON(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON input for skill parsing');
  }

  // 1. Extract Name
  const rawName =
    parsed.project?.title ||
    parsed.project?.name ||
    parsed.title ||
    parsed.name ||
    parsed.skill_name ||
    parsed.skillName ||
    parsed.style_name ||
    parsed.styleName ||
    parsed.style_bible?.title ||
    'Custom Visual Skill';
  const name = String(rawName).trim();

  // 2. Extract Style Prefix
  let stylePrefix =
    parsed.style_bible?.style_prefix ||
    parsed.style_bible?.stylePrefix ||
    parsed.style_prefix ||
    parsed.stylePrefix ||
    parsed.prefix ||
    parsed.signature_phrase ||
    parsed.system_prompt ||
    parsed.prompt_prefix ||
    '';

  if (!stylePrefix && parsed.art_style_and_medium) {
    stylePrefix = parsed.art_style_and_medium;
  }
  if (!stylePrefix && parsed.style_bible?.art_style) {
    stylePrefix = parsed.style_bible.art_style;
  }
  if (!stylePrefix && typeof parsed.style === 'string') {
    stylePrefix = parsed.style;
  }
  stylePrefix = String(stylePrefix).trim();

  // 3. Extract or Synthesize Detailed Style Guide
  let styleGuide = '';
  if (typeof parsed.styleGuide === 'string' && parsed.styleGuide.trim()) {
    styleGuide = parsed.styleGuide.trim();
  } else if (typeof parsed.style_guide === 'string' && parsed.style_guide.trim()) {
    styleGuide = parsed.style_guide.trim();
  } else if (parsed.art_style_and_medium || parsed.character_design || parsed.rendering_details || parsed.negative_directives) {
    const parts = [];
    if (parsed.art_style_and_medium) {
      parts.push(`ART STYLE AND MEDIUM: ${parsed.art_style_and_medium}`);
    }
    if (parsed.character_design) {
      parts.push(`CHARACTER DESIGN: ${parsed.character_design}`);
    }
    if (parsed.rendering_details) {
      parts.push(`RENDERING DETAILS: ${parsed.rendering_details}`);
    }
    if (parsed.negative_directives) {
      parts.push(`NEGATIVE DIRECTIVES: ${parsed.negative_directives}`);
    }
    styleGuide = parts.join('\n');
  } else if (parsed.style_bible && typeof parsed.style_bible === 'object') {
    const sb = parsed.style_bible;
    const sections = [];

    if (sb.style_prefix || sb.art_style) {
      sections.push(`### 1. Art Style & Medium\n${sb.style_prefix || sb.art_style}`);
    }
    if (sb.character_description || sb.character) {
      sections.push(`### 2. Character Design & Recurring Figures\n${sb.character_description || sb.character}`);
    }
    if (sb.palette) {
      let palStr = '';
      if (typeof sb.palette === 'object' && !Array.isArray(sb.palette)) {
        palStr = Object.entries(sb.palette).map(([k, v]) => `- **${k}**: ${v}`).join('\n');
      } else if (Array.isArray(sb.palette)) {
        palStr = sb.palette.map(c => `- ${c}`).join('\n');
      } else {
        palStr = String(sb.palette);
      }
      sections.push(`### 3. Colour Palette\n${palStr}`);
    }
    if (sb.negative_prompt || parsed.negative_prompt || sb.avoid) {
      sections.push(`### 4. What to Avoid (Negative Directives)\n${sb.negative_prompt || parsed.negative_prompt || sb.avoid}`);
    }
    if (sb.camera_rules || sb.camera) {
      sections.push(`### 5. Camera & Framing\n${sb.camera_rules || sb.camera}`);
    }
    if (sb.lighting) {
      sections.push(`### 6. Lighting & Atmosphere\n${sb.lighting}`);
    }
    if (sb.backgrounds || sb.setting) {
      sections.push(`### 7. Backgrounds & Environments\n${sb.backgrounds || sb.setting}`);
    }
    if (Array.isArray(parsed.scenes) && parsed.scenes.length) {
      sections.push(`### 8. Storyboard Narrative Reference\nContains ${parsed.scenes.length} pre-planned scenes with consistent character and environment motifs.`);
    }

    styleGuide = sections.join('\n\n');
  } else {
    // Generic object formatting
    const sections = [];
    for (const [key, val] of Object.entries(parsed)) {
      if (['id', 'thumbnails', 'apiKey', 'key', 'name', 'title', 'project'].includes(key)) continue;
      if (typeof val === 'string') {
        sections.push(`### ${key.replace(/_/g, ' ').toUpperCase()}\n${val}`);
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        sections.push(`### ${key.replace(/_/g, ' ').toUpperCase()}\n${JSON.stringify(val, null, 2)}`);
      }
    }
    styleGuide = sections.join('\n\n') || stylePrefix || '';
  }

  // 4. Extract Thumbnails
  const thumbnails = Array.isArray(parsed.thumbnails) ? parsed.thumbnails.slice(0, 5) : [];

  // 5. Extract Scene Captions (if Claude scenes exist)
  let extractedCaptions = '';
  if (Array.isArray(parsed.scenes) && parsed.scenes.length) {
    const lines = [];
    parsed.scenes.forEach(sc => {
      const timeStr = sc.start || sc.time || (sc.id !== undefined ? `0:${String((sc.id - 1) * 3).padStart(2, '0')}` : null);
      if (timeStr) {
        const cleanTime = timeStr.replace(/^[\(\[]/, '').replace(/[\)\]]$/, '');
        const text = sc.narration || sc.caption || sc.text || sc.setting || sc.emotion || '';
        lines.push(`(${cleanTime}) ${text}`.trim());
      }
    });
    extractedCaptions = lines.join('\n');
  }

  const skill = {
    id: parsed.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name,
    stylePrefix,
    styleGuide,
    thumbnails,
    createdAt: parsed.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  return { skill, extractedCaptions };
}

/**
 * Import single or multiple skills from JSON (Supports Claude, ChatGPT, Native backups).
 * @param {string} jsonStr
 * @returns {Promise<{ importedCount: number, skills: Array, skippedCount: number, extractedCaptions: string }>}
 */
export async function importSkillsFromJSON(jsonStr) {
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Invalid JSON file format');
  }

  let rawList = [];
  let combinedCaptions = '';

  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && parsed.skills && Array.isArray(parsed.skills)) {
    rawList = parsed.skills;
  } else if (parsed && typeof parsed === 'object') {
    rawList = [parsed];
  } else {
    throw new Error('Unrecognized JSON skill format');
  }

  const current = await getAllSkills();
  const availableSlots = MAX_SKILLS - current.length;

  if (availableSlots <= 0) {
    throw new Error(`Already at maximum of ${MAX_SKILLS} skills. Delete an existing skill first.`);
  }

  const canTake = rawList.slice(0, availableSlots);
  const imported = [];

  for (const item of canTake) {
    const { skill, extractedCaptions } = normalizeSkillFromAnyJSON(item);
    if (extractedCaptions && !combinedCaptions) {
      combinedCaptions = extractedCaptions;
    }
    const saved = await saveSkill(skill);
    imported.push(saved);
  }

  return {
    importedCount: imported.length,
    skills: imported,
    skippedCount: rawList.length - imported.length,
    extractedCaptions: combinedCaptions
  };
}
