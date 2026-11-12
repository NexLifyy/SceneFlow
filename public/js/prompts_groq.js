/**
 * prompts_groq.js — Client-Side Groq API Connector for SceneFlow Prompts
 * 
 * Uses the ultra-fast Groq API (OpenAI-compatible endpoints at https://api.groq.com/openai/v1)
 * Keys are obtained from: https://console.groq.com/keys
 * Supports Llama 3.3 70B Versatile, Llama 3.1 8B, Vision models, and deep reasoning models.
 * The API key is NEVER logged, and never written to disk, server logs, or IndexedDB.
 */

import { cleanPromptText } from './prompts_parser.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

const GROQ_TEXT_MODEL_PRIORITY = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
  'gemma2-9b-it'
];

const GROQ_VISION_MODEL_PRIORITY = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview'
];

function isNonChatModel(id) {
  return /whisper|guard|tts|safeguard|playai|orpheus|distil-whisper/i.test(id || '');
}

function isModelUnavailableError(status, errDetail) {
  return status === 404 || /model.*(not exist|not found|decommissioned|do not have access|unsupported)|does not exist or you do not have access/i.test(errDetail || '');
}

export async function fetchAvailableGroqModels(apiKey) {
  const res = await fetch(`${GROQ_BASE_URL}/models`, {
    headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
  });
  const data = await res.json();
  if (!res.ok) {
    const errDetail = data?.error?.message || res.statusText;
    const err = new Error(errDetail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const ids = (Array.isArray(data?.data) ? data.data : [])
    .map(m => m?.id)
    .filter(id => id && !isNonChatModel(id));

  const rankSort = (list, priority) => [
    ...priority.filter(p => list.includes(p)),
    ...list.filter(id => !priority.includes(id))
  ];

  const visionRaw = ids.filter(id => /vision|llama-4-(scout|maverick)/i.test(id));
  return {
    textModels: rankSort(ids, GROQ_TEXT_MODEL_PRIORITY),
    visionModels: rankSort(visionRaw.length ? visionRaw : ids, GROQ_VISION_MODEL_PRIORITY),
  };
}

/**
 * Shared Groq /chat/completions requester with 429 retry and automatic 404 model fallback.
 */
async function requestGroqCompletion(apiKey, preferredModel, buildBody, { isVision = false, maxAttempts = 3 } = {}) {
  const cleanKey = apiKey.trim();
  const url = `${GROQ_BASE_URL}/chat/completions`;
  let activeModel = preferredModel || (isVision ? GROQ_VISION_MODEL_PRIORITY[0] : 'llama-3.3-70b-versatile');
  let triedFallbackModels = new Set([activeModel]);
  let fallbackCandidates = null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const body = buildBody(activeModel);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (res.ok) {
      return { data, modelUsed: activeModel };
    }

    const errDetail = data?.error?.message || res.statusText;
    if (res.status === 401) {
      const err = new Error(`Invalid Groq API key: ${errDetail}`);
      err.status = 401;
      throw err;
    }

    if (isModelUnavailableError(res.status, errDetail)) {
      if (fallbackCandidates === null) {
        const discovered = await fetchAvailableGroqModels(cleanKey);
        const pool = isVision && discovered.visionModels.length ? discovered.visionModels : discovered.textModels;
        fallbackCandidates = pool.filter(m => !triedFallbackModels.has(m));
      }
      const nextModel = fallbackCandidates.shift();
      if (nextModel) {
        activeModel = nextModel;
        triedFallbackModels.add(nextModel);
        attempts = Math.max(0, attempts - 1); // Do not burn rate-limit retry count on model discovery
        continue;
      }
    }

    if (res.status === 429 && attempts < maxAttempts) {
      await sleep(attempts * 2000);
      continue;
    }

    const err = new Error(`Groq error (${res.status}): ${errDetail}`);
    err.status = res.status;
    throw err;
  }

  throw new Error('Failed to get response from Groq after maximum retry attempts');
}

/**
 * Exponential backoff sleep helper
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Helper to extract mimeType and pure base64 data from a data URL or raw base64.
 */
function parseBase64DataUrl(str) {
  if (typeof str !== 'string') return { mimeType: 'image/jpeg', data: '' };
  const match = str.match(/^data:([^;]+);base64,(.*)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/jpeg', data: str };
}

/**
 * 1. Test Key: makes a fast ping request to Groq (auto-discovering active models on 404) and returns status.
 * @param {string} apiKey 
 * @param {string} modelId 
 * @returns {Promise<{ ok: boolean, message: string, resolvedModel?: string }>}
 */
export async function testGroqApiKey(apiKey, modelId = 'llama-3.3-70b-versatile') {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, message: 'Please enter a Groq API key (gsk_...).' };
  }

  try {
    const { modelUsed } = await requestGroqCompletion(
      apiKey,
      modelId || 'llama-3.3-70b-versatile',
      (m) => ({
        model: m,
        messages: [{ role: 'user', content: 'Respond with exactly: OK' }],
        max_tokens: 10,
        temperature: 0.1
      }),
      { maxAttempts: 2 }
    );
    return { ok: true, message: 'Key works! Connected to Groq.', resolvedModel: modelUsed };
  } catch (err) {
    if (err.name === 'TypeError' && String(err.message).includes('fetch')) {
      return { ok: false, message: 'No internet connection or Groq API blocked by browser/network.' };
    }
    return { ok: false, message: err.message || 'Groq connection failed.' };
  }
}

/**
 * 2. Analyze Style Images or Reference Guide:
 * Sends reference image(s) to Groq's multimodal model or text analysis to produce a detailed Style Guide + Prefix.
 * @param {string} apiKey
 * @param {string} modelId
 * @param {object} params - { name, imagesBase64 }
 * @returns {Promise<{ styleGuide: string, stylePrefix: string }>}
 */
export async function analyzeStyleImages(apiKey, modelId = 'llama-3.3-70b-versatile', params = {}) {
  const { name, imagesBase64 = [] } = params;
  if (!apiKey || !apiKey.trim()) throw new Error('Groq API key is required');

  const promptText = `You are a master concept artist, production designer, and visual prompt engineer for video production.
Analyze the visual aesthetic for the style named "${name || 'Custom Visual Style'}".
Create a cohesive, comprehensive Visual Style Guide and a concise Style Prefix that will be used to instruct image generation models (Midjourney, Flux, Stable Diffusion) to match this exact aesthetic consistently across dozens of storyboard frames.

Return a strictly valid JSON object with EXACTLY this structure:
{
  "stylePrefix": "A short reusable signature phrase (e.g. 'Hand-drawn doodle illustration, thick black wobbly outlines, flat colors with subtle marker texture, minimalist style.')",
  "styleGuide": "### 1. Art Style & Medium\\n(e.g., 2D animation, digital painting, webcomic, clean doodle)\\n\\n### 2. Colour Palette & Saturation\\n- **wall**: #F9B98A (Warm peach)\\n- **floor**: #C47A4A (Warm plank wood)\\n- **shirt**: #4A86D8 (Classic blue)\\n- **furniture**: #6F86A8 (Slate blue)\\n\\n### 3. Line & Texture\\n(Stroke weight, clean vs wobbly ink, grain, subtle marker or paper texture)\\n\\n### 4. Character Design & Recurring Figures\\n(e.g. round-headed white stickman with a big perfectly round bald head, dot eyes, thin black line arms, wearing a plain blue short-sleeve t-shirt, blue jeans and white sneakers)\\n\\n### 5. Camera & Framing Habits\\n(Wide establishing shots, medium three-quarter angles, eye-level, centered character with ample breathing space)\\n\\n### 6. Lighting & Atmosphere\\n(Soft even daylight through large windows, light sky-blue exterior, calm and cozy ambient mood)\\n\\n### 7. Backgrounds & Environments\\n(Peach walls with thin baseboards, wooden plank floor, slate-blue sofa with mustard throw blanket, side tables with white mug, tear-off wall calendar with no writing, corner potted plants, round wall clock)\\n\\n### 8. What to Avoid (Negative Directives)\\ntext, letters, words, speech bubbles, logos, watermark, realistic, 3D render, photo, detailed shading, extra fingers, hair, nose, ears, multiple outfits, clutter"
}`;

  const isVision = imagesBase64.length > 0;
  let messages = [];

  if (isVision) {
    const content = [{ type: 'text', text: promptText }];
    for (const img of imagesBase64.slice(0, 3)) {
      const { mimeType, data } = parseBase64DataUrl(img);
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${data}` }
      });
    }
    messages = [{ role: 'user', content }];
  } else {
    messages = [
      { role: 'system', content: 'You are an expert art director. Output only valid JSON.' },
      { role: 'user', content: promptText }
    ];
  }

  const preferred = isVision ? GROQ_VISION_MODEL_PRIORITY[0] : (modelId || 'llama-3.3-70b-versatile');
  let data;
  try {
    ({ data } = await requestGroqCompletion(
      apiKey,
      preferred,
      (m) => ({
        model: m,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 3000
      }),
      { isVision, maxAttempts: 2 }
    ));
  } catch (err) {
    throw new Error(`Style analysis failed: ${err.message}`);
  }

  const rawJson = data?.choices?.[0]?.message?.content;
  if (!rawJson) {
    throw new Error('Groq returned an empty analysis response');
  }

  try {
    const cleaned = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      stylePrefix: cleanPromptText(parsed.stylePrefix || ''),
      styleGuide: (parsed.styleGuide || '').trim()
    };
  } catch {
    return {
      stylePrefix: `Hand-drawn doodle cartoon illustration, thick black wobbly outlines, flat colors with subtle marker texture, minimalist webcomic style.`,
      styleGuide: rawJson.trim()
    };
  }
}

/**
 * 3. Generate a batch of image prompts (typically 10 lines per batch).
 * Handles rate limits with exponential backoff and automatic 404 model fallback.
 * Generates concise 150-200 character prompts cleanly synced to timestamps.
 * 
 * @param {string} apiKey
 * @param {string} modelId
 * @param {object} params
 * @returns {Promise<Array<{ time: string, prompt: string }>>}
 */
export async function generatePromptsBatch(apiKey, modelId = 'llama-3.3-70b-versatile', params = {}) {
  const {
    batchItems = [],
    prevContext = [],
    nextContext = [],
    directives = '',
    settings = {}
  } = params;

  if (!apiKey || !apiKey.trim()) throw new Error('Groq API key is required');
  if (!batchItems.length) return [];

  const {
    promptLength = '150-200-chars',
    language = 'English',
    aspectRatio = ''
  } = settings;

  const lengthInstructions = {
    '150-200-chars': `STRICTLY 150-200 CHARACTERS total per prompt (about 25-35 words). Be vivid and compact: subject, action/pose, key setting/props, lighting, and scene composition in one tight sentence.`,
    detailed: `STRICTLY 150-200 CHARACTERS total per prompt (about 25-35 words), concise single-sentence scene.`,
    medium: `BALANCED (~75-100 words), specifying environment, character pose, attire, lighting, and composition.`,
    short: `CONCISE (~35-50 words), focusing purely on subject, action, lighting, and composition.`
  }[promptLength] || `STRICTLY 150-200 CHARACTERS total per prompt (about 25-35 words).`;

  const systemInstructions = `You are an elite cinematic storyboard visualizer and lead AI prompt engineer writing vivid visual scene descriptions for each timestamped line of a video script.
Your task: write a single concise scene description (strictly 150 to 200 characters) for EVERY timestamped line of the video script provided in the batch.

CRITICAL RULES:
1. Target Length: ${lengthInstructions}
2. Focus purely on scene composition, subject, character pose/action, and environment.
3. DO NOT output art style or rendering medium keywords (such as "illustration", "stick figure", "35mm grain", "oil painting", "flat 2D vector", "photorealistic", "doodle", etc.) — our system algorithmically injects the unified visual style across all frames.
4. Output one prompt for EVERY timestamp line in the batch. Never combine or skip lines.
5. Every prompt MUST be on a SINGLE continuous line with NO internal line breaks and NO aspect ratio flags like "--ar".
6. Language: ${language}.
7. Never include numbering like "1.", "Prompt 1:", or markdown titles in the prompt text.
8. Narrative & Character Continuity: Maintain consistent character pose, action, and setting flow across the sequential frames based on the script context.
9. Return a STRICT JSON object with key "prompts" containing an array of objects with "time" and "prompt".`;

  let userContent = `Write concise scene descriptions (150-200 chars) without art style keywords for each of the following lines. Return a JSON object with key "prompts": [{"time": "...", "prompt": "..."}].\n\n`;

  if (directives) {
    userContent += `USER DIRECTIVES:\n${directives}\n\n`;
  }
  if (prevContext && prevContext.length) {
    userContent += `PREVIOUS SCENE CONTEXT (For story continuity):\n${prevContext.map(c => `${c.rawTime} ${c.text}`).join('\n')}\n\n`;
  }

  userContent += `CURRENT BATCH LINES (GENERATE ONE 150-200 CHARACTER SCENE PROMPT FOR EACH):\n`;
  userContent += batchItems.map(item => `${item.rawTime} ${item.text}`).join('\n');

  if (nextContext && nextContext.length) {
    userContent += `\n\nUPCOMING SCENE CONTEXT (For transition awareness):\n${nextContext.map(c => `${c.rawTime} ${c.text}`).join('\n')}`;
  }

  const { data } = await requestGroqCompletion(
    apiKey,
    modelId || 'llama-3.3-70b-versatile',
    (m) => ({
      model: m,
      messages: [
        { role: 'system', content: systemInstructions },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 8000
    }),
    { maxAttempts: 3 }
  );

  const rawJson = data?.choices?.[0]?.message?.content;
  if (!rawJson) {
    throw new Error('Groq returned an empty response');
  }

  const cleaned = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  let parsedList = JSON.parse(cleaned);
  if (parsedList && Array.isArray(parsedList.prompts)) {
    parsedList = parsedList.prompts;
  } else if (Array.isArray(parsedList)) {
    // Already array
  } else if (parsedList && typeof parsedList === 'object') {
    parsedList = Object.entries(parsedList).map(([k, v]) => ({
      time: k,
      prompt: typeof v === 'string' ? v : (v?.prompt || '')
    }));
  } else {
    throw new Error('Expected JSON object with "prompts" array from Groq');
  }

  return parsedList.map(item => ({
    time: (item.time || item.timestamp || '').trim(),
    prompt: cleanPromptText(item.prompt || item.text || '')
  }));
}

/**
 * 4. Regenerate a single prompt using neighbouring lines as context.
 */
export async function regenerateSinglePrompt(apiKey, modelId, params = {}) {
  const { targetItem, prevContext = [], nextContext = [], styleGuide = '', stylePrefix = '', directives = '', settings = {} } = params;
  const batchResult = await generatePromptsBatch(apiKey, modelId, {
    batchItems: [targetItem],
    prevContext,
    nextContext,
    styleGuide,
    stylePrefix,
    directives,
    settings
  });

  if (batchResult && batchResult.length > 0) {
    return batchResult[0].prompt;
  }
  throw new Error('Could not regenerate prompt for line ' + targetItem.rawTime);
}

// ── Backwards Compatibility Aliases ─────────────────────────────────────────
export const testGeminiApiKey = testGroqApiKey;
