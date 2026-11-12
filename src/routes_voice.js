'use strict';

/**
 * routes_voice.js — Express Router for SceneFlow Voice (Fish Audio Neural Studio)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const isVercel = Boolean(process.env.VERCEL);
const UPLOADS_DIR = isVercel ? path.join(os.tmpdir(), 'sceneflow_uploads') : path.join(__dirname, '..', 'uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}

const DEFAULT_MODEL = 's2.1-pro-free';
const DEFAULT_VOICE_ID = 'bf322df2096a46f18c579d0baa36f41d';

function clampNumber(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function buildFishTtsPayload(body = {}) {
  const voiceId = String(body.voiceId ?? body.reference_id ?? '').trim();
  const format = String(body.format || 'mp3').trim().toLowerCase() === 'wav' ? 'wav' : 'mp3';

  const payload = {
    text: String(body.text || '').trim(),
    format
  };

  if (voiceId) {
    payload.reference_id = voiceId;
  }

  if (body.temperature !== undefined) {
    payload.temperature = clampNumber(body.temperature, 0.0, 1.0, 0.7);
  }
  if (body.top_p !== undefined || body.topP !== undefined) {
    payload.top_p = clampNumber(body.top_p ?? body.topP, 0.0, 1.0, 0.8);
  }

  if (body.speed !== undefined || body.volume !== undefined) {
    payload.prosody = {
      speed: clampNumber(body.speed, 0.5, 2.0, 1.0),
      volume: clampNumber(body.volume, -20, 20, 0.0)
    };
  }

  return payload;
}

/**
 * POST /api/voice/test-key (alias: /api/voiceover/test-key)
 * Tests if the Fish Audio API key is valid without logging or persisting it.
 */
router.post(['/api/voice/test-key', '/api/voiceover/test-key'], async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let apiKey = req.body?.apiKey;
    if (!apiKey && authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7).trim();
    }

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }

    const cleanKey = apiKey.trim();

    const fishRes = await fetch('https://api.fish.audio/wallet/self/package', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cleanKey}`
      }
    });

    if (fishRes.ok) {
      const data = await fishRes.json().catch(() => ({}));
      return res.json({
        success: true,
        message: 'Fish Audio API key is valid',
        package: data
      });
    }

    if (fishRes.status === 401 || fishRes.status === 403) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Fish Audio API key. Please check your key.'
      });
    }

    const errText = await fishRes.text().catch(() => '');
    return res.status(fishRes.status).json({
      success: false,
      error: `Fish Audio returned error ${fishRes.status}: ${errText || 'Authentication failed'}`
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: `Network error connecting to Fish Audio: ${err.message}`
    });
  }
});

/**
 * POST /api/voice/tts (alias: /api/voiceover/tts)
 * Generates speech via Fish Audio API (model: s2.1-pro-free by default)
 * Streams binary audio back and also writes to a temporary file for local playback / Timing handoff.
 */
router.post(['/api/voice/tts', '/api/voiceover/tts'], async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let apiKey = req.body?.apiKey;
    if (!apiKey && authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7).trim();
    }

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'Fish Audio API key is required' });
    }

    const text = req.body?.text;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text to synthesize is required' });
    }

    const cleanKey = apiKey.trim();
    const model = String(req.body?.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const fishPayload = buildFishTtsPayload(req.body);
    const voiceId = fishPayload.reference_id || '';
    const format = fishPayload.format;

    const fishRes = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'Content-Type': 'application/json',
        'model': model
      },
      body: JSON.stringify(fishPayload)
    });

    if (!fishRes.ok) {
      let errorMsg = `Fish Audio TTS failed with status ${fishRes.status}`;
      try {
        const errJson = await fishRes.json();
        errorMsg = errJson.message || errJson.error || errJson.detail || errorMsg;
      } catch {
        const errTxt = await fishRes.text().catch(() => '');
        if (errTxt) errorMsg = errTxt;
      }
      return res.status(fishRes.status).json({ error: errorMsg });
    }

    const arrayBuffer = await fishRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Cache temporary audio file in uploads/ for easy sharing with Timing
    const ext = format === 'wav' ? '.wav' : '.mp3';
    const filename = `sceneflow_voice_${uuidv4().substring(0, 8)}${ext}`;
    try {
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const filePath = path.join(UPLOADS_DIR, filename);
      await fs.promises.writeFile(filePath, buffer);
    } catch (saveErr) {
      console.warn('Could not cache voice file to disk:', saveErr.message);
    }

    const mimeType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';

    if (req.query?.responseType === 'json' || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        filename,
        audioUrl: `/uploads/${filename}`,
        size: buffer.length,
        model,
        voiceId
      });
    }

    res.set({
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Audio-Url': `/uploads/${filename}`,
      'X-Audio-Filename': filename
    });

    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: `TTS Generation failed: ${err.message}` });
  }
});

router.DEFAULT_MODEL = DEFAULT_MODEL;
router.DEFAULT_VOICE_ID = DEFAULT_VOICE_ID;
router.buildFishTtsPayload = buildFishTtsPayload;

module.exports = router;
