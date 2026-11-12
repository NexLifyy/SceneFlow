/**
 * voice_storage.js — Cookie storage & configuration for SceneFlow Voice (Fish Audio TTS)
 */

export const DEFAULT_FISH_MODEL = 's2.1-pro-free';
export const DEFAULT_VOICE_ID = 'bf322df2096a46f18c579d0baa36f41d';

export const FISH_AUDIO_MODELS = [
  { id: 's2.1-pro-free', name: 's2.1-pro-free (Fish Audio S2.1 Pro Free - Default)', isDefault: true },
  { id: 's2.1-pro', name: 's2.1-pro (Fish Audio S2.1 Pro Production)' },
  { id: 's2-pro', name: 's2-pro (Fish Audio S2 Pro)' },
  { id: 's1', name: 's1 (Legacy S1)' }
];

export const VOICE_PRESETS = [
  {
    id: 'bf322df2096a46f18c579d0baa36f41d',
    name: 'Adrian',
    title: 'Adrian (Steady Documentary Narrator)',
    tag: 'Narration & Storytelling',
    latency: '< 380ms Latency',
    initials: 'AD',
    desc: 'Steady, reliable English narrator cadence for explainers & stories'
  },
  {
    id: '933563129e564b19a115bedd57b7406a',
    name: 'Sarah',
    title: 'Sarah (Engaged Conversational)',
    tag: 'YouTube & Explainer',
    latency: '< 350ms Latency',
    initials: 'SA',
    desc: 'Clear, engaged natural voice suited for modern commentary'
  },
  {
    id: 'c5f56a6cc2ec4fa8920cb4c5889a3fb7',
    name: 'Slax',
    title: 'Slax (Crisp Documentary)',
    tag: 'Education & Deep Dive',
    latency: '< 340ms Latency',
    initials: 'SX',
    desc: 'Measured, precise male narration ideal for educational essays'
  },
  {
    id: '90e65eaaf50e4470b8e6d43ee6afd7d5',
    name: 'Cinematic Announcer',
    title: 'Deep Trailer & Announcer Voice',
    tag: 'Dramatic & Hook',
    latency: '< 390ms Latency',
    initials: 'CA',
    desc: 'Authoritative deep male baritone for high-impact intros & hooks'
  }
];

// Preserved cookie names so previously saved Fish Audio keys, models & voice IDs remain intact after the SceneFlow rename
const COOKIE_KEY_NAME = 'fish_audio_api_key';
const COOKIE_MODEL_NAME = 'fish_audio_model';
const COOKIE_VOICE_ID_NAME = 'fish_audio_voice_id';
const COOKIE_CUSTOM_VOICES_NAME = 'fish_audio_custom_voices';

// ── Cookie Helpers (SameSite=Strict, Secure on https, 1-Year Expiry) ──

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

export function getStoredFishApiKey() {
  return getCookie(COOKIE_KEY_NAME);
}

export function saveFishApiKey(key) {
  const clean = (key || '').trim();
  if (!clean) {
    deleteCookie(COOKIE_KEY_NAME);
    return;
  }
  setCookie(COOKIE_KEY_NAME, clean, 365);
}

export function removeFishApiKey() {
  deleteCookie(COOKIE_KEY_NAME);
}

export function getStoredFishModel() {
  const model = getCookie(COOKIE_MODEL_NAME);
  return model || DEFAULT_FISH_MODEL;
}

export function saveFishModel(model) {
  const clean = (model || '').trim();
  if (!clean) {
    setCookie(COOKIE_MODEL_NAME, DEFAULT_FISH_MODEL, 365);
    return;
  }
  setCookie(COOKIE_MODEL_NAME, clean, 365);
}

export function getStoredVoiceId() {
  const id = getCookie(COOKIE_VOICE_ID_NAME);
  return id || DEFAULT_VOICE_ID;
}

export function saveVoiceId(id) {
  const clean = (id || '').trim();
  if (!clean) {
    deleteCookie(COOKIE_VOICE_ID_NAME);
    return;
  }
  setCookie(COOKIE_VOICE_ID_NAME, clean, 365);
}

function makeVoiceInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function getStoredCustomVoices() {
  const raw = getCookie(COOKIE_CUSTOM_VOICES_NAME);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(v => v && typeof v.id === 'string' && v.id.trim() && typeof v.name === 'string' && v.name.trim())
      .map(v => ({
        id: v.id.trim(),
        name: v.name.trim(),
        initials: makeVoiceInitials(v.name),
        tag: 'Custom Voice',
        latency: '< 400ms Latency',
        isCustom: true
      }));
  } catch {
    return [];
  }
}

export function saveCustomVoice({ id, name }) {
  const cleanId = (id || '').trim();
  const cleanName = (name || '').trim();
  if (!cleanId || !cleanName) return getStoredCustomVoices();

  const list = getStoredCustomVoices().filter(v => v.id !== cleanId);
  list.unshift({
    id: cleanId,
    name: cleanName,
    initials: makeVoiceInitials(cleanName),
    tag: 'Custom Voice',
    latency: '< 400ms Latency',
    isCustom: true
  });

  // Cap list size so cookie stays well under 4KB browser limits
  const capped = list.slice(0, 12);
  setCookie(COOKIE_CUSTOM_VOICES_NAME, JSON.stringify(capped.map(v => ({ id: v.id, name: v.name }))), 365);
  saveVoiceId(cleanId);
  return capped;
}

export function removeCustomVoice(id) {
  const cleanId = (id || '').trim();
  const remaining = getStoredCustomVoices().filter(v => v.id !== cleanId);
  if (!remaining.length) {
    deleteCookie(COOKIE_CUSTOM_VOICES_NAME);
  } else {
    setCookie(COOKIE_CUSTOM_VOICES_NAME, JSON.stringify(remaining.map(v => ({ id: v.id, name: v.name }))), 365);
  }
  return remaining;
}

export function maskApiKey(key) {
  if (!key) return '';
  const clean = key.trim();
  if (clean.length <= 8) return '••••••••';
  const start = clean.startsWith('fa_')
    ? (clean.startsWith('fa_live_') ? clean.substring(0, 8) : clean.substring(0, 3))
    : clean.substring(0, 4);
  const end = clean.slice(-4);
  return `${start}••••••${end}`;
}

export function estimateSpeechDuration(text, speed = 1.0) {
  if (!text || !text.trim()) return 0;
  // Standard speech is ~14.5 characters per second (~150 words per minute)
  const charCount = text.trim().length;
  const nominalSeconds = charCount / 14.5;
  const speedFactor = parseFloat(speed) || 1.0;
  return Math.max(0.5, nominalSeconds / speedFactor);
}
