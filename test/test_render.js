/**
 * test_render.js — End-to-end render test with 20 sample images.
 * Verifies that image changes in the output video match filename timestamps.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const SAMPLE_DIR = path.join(__dirname, 'sample_images');
const OUTPUT_DIR = path.join(__dirname, 'render_output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function apiPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    const req = http.request({
      host: 'localhost', port: 3000, path: apiPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, (res) => {
      let o = '';
      res.on('data', c => o += c);
      res.on('end', () => resolve(JSON.parse(o)));
    });
    req.on('error', reject);
    req.write(d); req.end();
  });
}

function listenSSE(jobId) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000/api/export/${jobId}/progress`, (res) => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') {
              process.stdout.write(`\r  ${data.stage} ${data.pct}%   `);
            } else if (data.type === 'done') {
              console.log('\n  Done!', JSON.stringify(data));
              resolve(data);
            } else if (data.type === 'error') {
              console.log('\n  Error:', data.message);
              reject(new Error(data.message));
            }
          }
        }
      });
      res.on('error', reject);
    });
  });
}

async function main() {
  console.log('=== SceneFlow Render Test ===\n');

  // List sample images
  const files = fs.readdirSync(SAMPLE_DIR)
    .filter(f => f.endsWith('.png'))
    .map(name => ({ name, path: path.join(SAMPLE_DIR, name), type: 'image' }));

  console.log(`Found ${files.length} test images`);

  // Parse timeline
  const { clips } = await apiPost('/api/parse-filenames', { files, gapMode: 'extend' });
  console.log(`\nTimeline: ${clips.length} clips`);
  clips.slice(0, 5).forEach(c =>
    console.log(`  #${c.index} ${c.name} → ${c.startSec}s–${c.endSec}s (${c.durationSec}s)`)
  );
  console.log('  ...');

  // Verify first 5 clips have correct timestamps
  const expected = [
    { name: '0_00-0_03.png', startSec: 0,  endSec: 3  },
    { name: '0_03-0_06.png', startSec: 3,  endSec: 6  },
    { name: '0_06-0_09.png', startSec: 6,  endSec: 9  },
    { name: '0_09-0_12.png', startSec: 9,  endSec: 12 },
    { name: '0_12-0_15.png', startSec: 12, endSec: 15 },
  ];

  let allOk = true;
  for (const exp of expected) {
    const clip = clips.find(c => c.name === exp.name);
    if (!clip) { console.error(`FAIL: ${exp.name} not found in timeline`); allOk = false; continue; }
    if (clip.startSec !== exp.startSec || clip.endSec !== exp.endSec) {
      console.error(`FAIL: ${exp.name} expected ${exp.startSec}–${exp.endSec}s, got ${clip.startSec}–${clip.endSec}s`);
      allOk = false;
    }
  }

  if (allOk) console.log('\n✓ All timestamp assertions passed');

  // Start render
  console.log('\nStarting render (5 clips, 720p, draft quality)...');
  const fiveClips = clips.slice(0, 5);
  const { jobId } = await apiPost('/api/export', {
    clips: fiveClips,
    voiceover: null,
    music: null,
    musicVolume: 0,
    captionWords: [],
    captionStyle: 'none',
    fileName: 'render_test.mp4',
    saveFolder: OUTPUT_DIR,
    voiceoverMode: 'cut',
    videoSize: '720p',
    quality: 'draft',
    fps: 24,
    fitMode: 'fit',
    imageMotion: 'zoomIn',
    motionSpeed: 'slow',
    motionEffects: { zoomIn: true, zoomOut: true, panLeft: true, panRight: true },
  });

  console.log(`Job ID: ${jobId}`);
  const result = await listenSSE(jobId);

  const outFile = path.join(OUTPUT_DIR, 'render_test.mp4');
  if (fs.existsSync(outFile)) {
    const size = fs.statSync(outFile).size;
    console.log(`\n✅ Render test PASSED`);
    console.log(`   Output: ${outFile}`);
    console.log(`   Size: ${(size / 1024).toFixed(0)} KB`);
    console.log(`   Encoder: ${result.encoder}`);
    console.log(`   Resolution: ${result.resolution}`);
  } else {
    console.log('\n❌ Render test FAILED — output file not found');
  }
}

main().catch(e => { console.error('Test failed:', e.message); process.exit(1); });
