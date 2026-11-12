/**
 * voice_api.js — API client for SceneFlow Voice (Fish Audio Text-to-Speech)
 */

/**
 * Tests the Fish Audio API key against the server test endpoint.
 * @param {string} apiKey
 * @returns {Promise<{success: boolean, message?: string, error?: string, package?: any}>}
 */
export async function testFishApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'No API key provided' };
  }

  try {
    const res = await fetch('/api/voice/test-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ apiKey: apiKey.trim() })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      return {
        success: true,
        message: data.message || 'Fish Audio API key is valid',
        package: data.package
      };
    }

    return {
      success: false,
      error: data.error || `Validation failed (status ${res.status})`
    };
  } catch (err) {
    return {
      success: false,
      error: `Network error: ${err.message}`
    };
  }
}

/**
 * Synthesizes text into audio using Fish Audio API (model: s2.1-pro-free by default)
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.text
 * @param {string} [params.voiceId]
 * @param {string} [params.model]
 * @param {string} [params.format]
 * @param {number} [params.speed]
 * @param {number} [params.volume]
 * @param {number} [params.temperature]
 * @param {number} [params.topP]
 * @returns {Promise<{audioUrl: string, blobUrl: string, blob: Blob, filename: string}>}
 */
export async function synthesizeSpeech({
  apiKey,
  text,
  voiceId = '',
  model = 's2.1-pro-free',
  format = 'mp3',
  speed = 1.0,
  volume = 0.0,
  temperature = 0.7,
  topP = 0.8
}) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Please enter and save your Fish Audio API key first.');
  }
  if (!text || !text.trim()) {
    throw new Error('Please enter text to synthesize.');
  }

  const res = await fetch('/api/voice/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      apiKey: apiKey.trim(),
      text: text.trim(),
      voiceId: String(voiceId || '').trim(),
      model: String(model || 's2.1-pro-free').trim() || 's2.1-pro-free',
      format: format || 'mp3',
      speed: Number(speed) || 1.0,
      volume: Number(volume) || 0.0,
      temperature: Number(temperature),
      top_p: Number(topP)
    })
  });

  if (!res.ok) {
    let errorMsg = `Synthesis failed (${res.status})`;
    try {
      const errJson = await res.json();
      errorMsg = errJson.error || errorMsg;
    } catch {
      const errTxt = await res.text().catch(() => '');
      if (errTxt) errorMsg = errTxt;
    }
    throw new Error(errorMsg);
  }

  const serverAudioUrl = res.headers.get('X-Audio-Url') || '';
  const filename = res.headers.get('X-Audio-Filename') || `sceneflow_voice_${Date.now()}.${format}`;
  const blob = await res.blob();
  const localBlobUrl = URL.createObjectURL(blob);

  return {
    audioUrl: serverAudioUrl || localBlobUrl,
    blobUrl: localBlobUrl,
    blob,
    filename
  };
}
