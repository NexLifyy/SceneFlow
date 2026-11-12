'use strict';

/**
 * test/voice.test.js — Unit Tests for SceneFlow Voice (Fish Audio Neural Studio)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const express = require('express');

async function loadStorageModule() {
  const url = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'voice_storage.js')).href;
  return import(url);
}

test('FISH_AUDIO_MODELS: contains s2.1-pro-free as default model', async () => {
  const { FISH_AUDIO_MODELS, DEFAULT_FISH_MODEL } = await loadStorageModule();
  assert.equal(DEFAULT_FISH_MODEL, 's2.1-pro-free');
  assert.ok(Array.isArray(FISH_AUDIO_MODELS), 'FISH_AUDIO_MODELS should be an array');
  const defaultModel = FISH_AUDIO_MODELS.find(m => m.isDefault);
  assert.ok(defaultModel, 'Should have a default model');
  assert.equal(defaultModel.id, 's2.1-pro-free', 'Default model must be s2.1-pro-free');

  const modelIds = FISH_AUDIO_MODELS.map(m => m.id);
  assert.ok(modelIds.includes('s2.1-pro-free'));
  assert.ok(modelIds.includes('s2.1-pro'));
  assert.ok(modelIds.includes('s1'));
});

test('VOICE_PRESETS: contains verified Fish Audio preset voice IDs', async () => {
  const { VOICE_PRESETS, DEFAULT_VOICE_ID } = await loadStorageModule();
  assert.ok(Array.isArray(VOICE_PRESETS), 'VOICE_PRESETS should be an array');
  assert.ok(VOICE_PRESETS.length >= 4, 'Should have at least 4 presets');

  const adrian = VOICE_PRESETS.find(p => p.id === DEFAULT_VOICE_ID);
  assert.ok(adrian, 'Default Adrian preset should exist');
  assert.equal(adrian.id, 'bf322df2096a46f18c579d0baa36f41d');
  assert.equal(adrian.name, 'Adrian');
  assert.ok(adrian.desc.length > 0);

  for (const preset of VOICE_PRESETS) {
    assert.match(preset.id, /^[a-f0-9]{32}$/, 'Preset ID must be a 32-char hex Fish Audio UUID');
    assert.ok(preset.name, 'Preset must have a name');
    assert.ok(preset.latency, 'Preset must have latency spec');
  }
});

test('maskApiKey: masks Fish Audio live key securely', async () => {
  const { maskApiKey } = await loadStorageModule();
  const fullKey = 'fa_live_99f38e21a88b14e67d9c02';
  const masked = maskApiKey(fullKey);
  assert.notEqual(masked, fullKey, 'Masked key must not equal raw key');
  assert.ok(masked.startsWith('fa_live_'), 'Should preserve prefix');
  assert.ok(masked.endsWith('9c02'), 'Should preserve last 4 chars');
  assert.ok(masked.includes('••••••'), 'Should include mask bullets');

  const shortKey = 'fa_1234567890abcdef';
  const maskedShort = maskApiKey(shortKey);
  assert.ok(maskedShort.startsWith('fa_'));
  assert.ok(maskedShort.endsWith('cdef'));

  assert.equal(maskApiKey(''), '');
  assert.equal(maskApiKey(null), '');
  assert.equal(maskApiKey('12345'), '••••••••');
});

test('cookie storage: saves and loads Fish Audio API key, Voice ID, and defaults model to s2.1-pro-free', async () => {
  const storage = await loadStorageModule();

  // Mock browser cookie jar & window.location
  const cookieJar = new Map();
  let lastRawSetCookie = '';
  global.window = { location: { protocol: 'http:' } };
  global.document = {
    get cookie() {
      return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(str) {
      lastRawSetCookie = str;
      const [pair] = str.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return;
      const k = pair.slice(0, eqIdx).trim();
      const v = pair.slice(eqIdx + 1).trim();
      if (str.includes('Max-Age=0')) {
        cookieJar.delete(k);
      } else {
        cookieJar.set(k, v);
      }
    }
  };

  try {
    // Defaults before saving
    assert.equal(storage.getStoredFishApiKey(), '');
    assert.equal(storage.getStoredFishModel(), 's2.1-pro-free');
    assert.equal(storage.getStoredVoiceId(), 'bf322df2096a46f18c579d0baa36f41d');

    // Save API key
    storage.saveFishApiKey('fa_live_secret_token_9999');
    assert.ok(lastRawSetCookie.includes('SameSite=Strict'), 'Cookie must use SameSite=Strict');
    assert.equal(storage.getStoredFishApiKey(), 'fa_live_secret_token_9999');

    // Save custom Voice ID
    storage.saveVoiceId('933563129e564b19a115bedd57b7406a');
    assert.equal(storage.getStoredVoiceId(), '933563129e564b19a115bedd57b7406a');

    // Save model and revert to default when cleared
    storage.saveFishModel('s2.1-pro');
    assert.equal(storage.getStoredFishModel(), 's2.1-pro');
    storage.saveFishModel('');
    assert.equal(storage.getStoredFishModel(), 's2.1-pro-free');

    // Remove API key
    storage.removeFishApiKey();
    assert.equal(storage.getStoredFishApiKey(), '');
  } finally {
    delete global.document;
    delete global.window;
  }
});

test('estimateSpeechDuration: estimates speech accurately and scales with speed', async () => {
  const { estimateSpeechDuration } = await loadStorageModule();
  const sample = 'This is a narration sample for video synchronization testing.';
  const dur1x = estimateSpeechDuration(sample, 1.0);
  assert.ok(dur1x > 0, 'Duration should be positive');

  const dur2x = estimateSpeechDuration(sample, 2.0);
  assert.ok(Math.abs(dur2x - (dur1x / 2)) < 0.01, '2x speed should take half time');

  const durHalfX = estimateSpeechDuration(sample, 0.5);
  assert.ok(Math.abs(durHalfX - (dur1x * 2)) < 0.01, '0.5x speed should take double time');

  assert.equal(estimateSpeechDuration(''), 0);
  assert.equal(estimateSpeechDuration(null), 0);
});

test('routes_voice: buildFishTtsPayload maps prosody, clamps bounds, and omits empty reference_id', () => {
  const { buildFishTtsPayload } = require('../src/routes_voice');

  const withVoice = buildFishTtsPayload({
    text: '  Hello there  ',
    voiceId: '933563129e564b19a115bedd57b7406a',
    format: 'wav',
    speed: 1.25,
    volume: 3.5,
    temperature: 1.8, // should clamp to 1.0
    top_p: 0.85
  });

  assert.equal(withVoice.text, 'Hello there');
  assert.equal(withVoice.reference_id, '933563129e564b19a115bedd57b7406a');
  assert.equal(withVoice.format, 'wav');
  assert.deepEqual(withVoice.prosody, { speed: 1.25, volume: 3.5 });
  assert.equal(withVoice.temperature, 1.0);
  assert.equal(withVoice.top_p, 0.85);

  const withoutVoice = buildFishTtsPayload({
    text: 'System default voice',
    voiceId: '   '
  });
  assert.equal(withoutVoice.reference_id, undefined);
  assert.equal(withoutVoice.format, 'mp3');
});

test('routes_voice: validates missing inputs and forwards s2.1-pro-free + voiceId to Fish Audio', async () => {
  const router = require('../src/routes_voice');
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const realFetch = global.fetch;
  let capturedFetch = null;

  try {
    // 1. Missing API key on test-key returns 400
    const missingKeyRes = await realFetch(`${baseUrl}/api/voice/test-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(missingKeyRes.status, 400);

    // 2. Missing text on tts returns 400
    const missingTextRes = await realFetch(`${baseUrl}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'fa_test_123' })
    });
    assert.equal(missingTextRes.status, 400);

    // 3. Mock upstream Fish Audio fetch (only intercept fish.audio URLs)
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://api.fish.audio/')) {
        capturedFetch = { url, opts };
        if (String(url).includes('/wallet/self/package')) {
          return new Response(JSON.stringify({ balance: 100 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(Buffer.from('ID3mockmp3'), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' }
        });
      }
      return realFetch(url, opts);
    };

    // Test test-key forwarding
    const okKeyRes = await realFetch(`${baseUrl}/api/voice/test-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'fa_live_abc123' })
    });
    assert.equal(okKeyRes.status, 200);
    const okKeyJson = await okKeyRes.json();
    assert.equal(okKeyJson.success, true);
    assert.equal(capturedFetch.opts.headers.Authorization, 'Bearer fa_live_abc123');

    // Test tts forwarding with default s2.1-pro-free and custom voiceId
    const ttsRes = await realFetch(`${baseUrl}/api/voice/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        apiKey: 'fa_live_abc123',
        text: 'Hello Studio',
        voiceId: 'my-voice-id-999',
        speed: 1.15,
        volume: 2.0,
        temperature: 0.7,
        top_p: 0.8
      })
    });
    assert.equal(ttsRes.status, 200);
    const ttsJson = await ttsRes.json();
    assert.equal(ttsJson.success, true);
    assert.equal(ttsJson.model, 's2.1-pro-free');
    assert.equal(ttsJson.voiceId, 'my-voice-id-999');

    // Verify upstream Fish Audio headers & body
    assert.equal(capturedFetch.url, 'https://api.fish.audio/v1/tts');
    assert.equal(capturedFetch.opts.headers.model, 's2.1-pro-free');
    const upstreamBody = JSON.parse(capturedFetch.opts.body);
    assert.equal(upstreamBody.reference_id, 'my-voice-id-999');
    assert.equal(upstreamBody.text, 'Hello Studio');
    assert.deepEqual(upstreamBody.prosody, { speed: 1.15, volume: 2 });
    assert.equal(upstreamBody.temperature, 0.7);
    assert.equal(upstreamBody.top_p, 0.8);

    // Clean up temporary uploaded mock file
    if (ttsJson.filename) {
      const createdPath = path.join(__dirname, '..', 'uploads', ttsJson.filename);
      if (fs.existsSync(createdPath)) fs.unlinkSync(createdPath);
    }
  } finally {
    global.fetch = realFetch;
    await new Promise(resolve => server.close(resolve));
  }
});

test('Voice page markup reflects streamlined clean layout without outer glows or unwanted controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const start = html.indexOf('<div id="page-voice"');
  const end = html.indexOf('<div id="page-timing"');
  assert.ok(start > 0 && end > start, 'Expected #page-voice section bounds');
  const voiceHtml = html.slice(start, end);

  // Required removals
  for (const removed of [
    'Neural Voiceover Studio v4.2',
    'ElevenLabs v2',
    'Gemini Audio',
    'Custom Key Active',
    'vo-model-select',
    'vo-voice-id-display',
    'DSP v2.8',
    '~1.8s ETA',
    'TensorRT CUDA VoiceCore',
    'Import from Timing',
    'vo-btn-import-timing',
    'Voiceover Script - Scene 1',
    'Take Pending',
    'Fish Audio S2.1',
    'Synced Master',
    'Generate Speech &amp; Synthesize Audio',
    'vo-add-voice-panel',
    'shadow-glow',
    'shadow-lg',
    'shadow-md',
    'shadow-xl'
  ]) {
    assert.equal(voiceHtml.includes(removed), false, `Removed text/class still present in #page-voice: ${removed}`);
  }

  // Required additions & links
  assert.ok(voiceHtml.includes('https://fish.audio/app/developers/'), 'Expected updated Fish Audio developers API link');
  assert.ok(voiceHtml.includes('id="vo-api-toggle"') && voiceHtml.includes('id="vo-api-body"'), 'Expected collapsible API configuration');
  assert.ok(voiceHtml.includes('id="vo-btn-toggle-add-voice"'), 'Expected + Voice ID button');
  assert.ok(voiceHtml.includes('id="vo-voice-modal" class="hidden'), 'Expected hidden Add Custom Voice popup modal');
  assert.ok(voiceHtml.includes('id="vo-voice-name-input"') && voiceHtml.includes('id="vo-voice-id-input"'), 'Expected Voice Name + Voice ID inputs in modal');
  assert.ok(voiceHtml.includes('id="vo-acoustic-toggle"'), 'Expected Acoustic Synthetics dropdown toggle');
  assert.ok(voiceHtml.includes('id="vo-acoustic-body" class="hidden'), 'Expected collapsed Acoustic Synthetics body by default');
  assert.ok(voiceHtml.includes('>Generate Speech</span>'), 'Expected button text "Generate Speech"');
  const clearPos = voiceHtml.indexOf('id="vo-btn-clear-script"');
  const resetPos = voiceHtml.indexOf('id="vo-btn-reset-script"');
  assert.ok(clearPos > 0 && resetPos > clearPos, 'Expected Clear button first, followed by Reset button');
  assert.ok(voiceHtml.includes('id="vo-script-title"') && voiceHtml.includes('value=""'), 'Expected empty default script title input');

  const voiceJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'voice_ui.js'), 'utf8');
  assert.equal(voiceJs.includes('Speech synthesized!'), false, 'Should not display Speech synthesized notification text');

  // Muted flat idle waveform bars when no audio is generated
  const wfStart = voiceHtml.indexOf('id="vo-waveform-bars"');
  const scrubPos = voiceHtml.indexOf('id="vo-audio-scrub-fill"');
  const barsHtml = voiceHtml.slice(wfStart, scrubPos);
  assert.equal(barsHtml.includes('bg-teal-'), false, 'Idle waveform bars should not show colorful teal spikes');
  assert.equal(barsHtml.includes('bg-amber-'), false, 'Idle waveform bars should not show amber spikes');
  assert.ok(voiceHtml.includes('id="vo-audio-scrub-fill" class="hidden'), 'Scrubber cursor should be hidden when no audio is loaded');

  // Download button sits with Send to Timing inside #vo-master-audio-card
  const deckPos = voiceHtml.indexOf('id="vo-master-audio-card"');
  const downloadPos = voiceHtml.indexOf('id="vo-btn-export-audio"');
  const sendTimingPos = voiceHtml.indexOf('id="vo-btn-send-timing"');
  assert.ok(downloadPos > deckPos && sendTimingPos > downloadPos, 'Expected Download button placed beside Send to Timing in audio deck');
});

test('custom voices cookie storage saves, retrieves, and removes named custom voices', async () => {
  const storage = await loadStorageModule();
  const cookieJar = new Map();
  global.document = {
    get cookie() {
      return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(str) {
      const [pair, ...attrs] = str.split(';');
      const eqIdx = pair.indexOf('=');
      const key = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      if (attrs.some(a => /Max-Age=0/i.test(a))) cookieJar.delete(key);
      else cookieJar.set(key, val);
    }
  };
  global.window = { location: { protocol: 'http:' } };

  try {
    const saved = storage.saveCustomVoice({ id: 'vid_abc_123', name: 'My Warm Narrator' });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'My Warm Narrator');
    assert.equal(saved[0].initials, 'MW');
    assert.equal(storage.getStoredVoiceId(), 'vid_abc_123');
    const loaded = storage.getStoredCustomVoices();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'vid_abc_123');

    const remaining = storage.removeCustomVoice('vid_abc_123');
    assert.equal(remaining.length, 0);
  } finally {
    delete global.document;
    delete global.window;
  }
});
