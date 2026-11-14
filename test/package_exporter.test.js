'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { extractZipMedia } = require('../src/zip_extractor.js');

test('package_exporter: createZipBlob and generateAssSubtitles', async () => {
  const { createZipBlob, generateAssSubtitles } = await import('../public/js/package_exporter.js');

  assert.strictEqual(typeof createZipBlob, 'function');
  assert.strictEqual(typeof generateAssSubtitles, 'function');

  // Test ASS subtitles generation
  const ass = generateAssSubtitles({
    captionLines: [
      { startSec: 0, endSec: 3.5, text: 'Hello SceneFlow!' },
      { startSec: 3.5, endSec: 7.0, text: 'Full 4K Offline Rendering.' }
    ],
    captionFont: 'Poppins',
    captionColor: '#FFFFFF',
    captionHighlight: '#FACC15',
    captionSize: 36,
    width: 1920,
    height: 1080
  });

  assert.ok(ass.includes('[Script Info]'), 'Contains Script Info');
  assert.ok(ass.includes('PlayResX: 1920'), 'Sets PlayResX');
  assert.ok(ass.includes('Hello SceneFlow!'), 'Contains line 1');
  assert.ok(ass.includes('Full 4K Offline Rendering.'), 'Contains line 2');

  // Test ZIP creation
  const zipBlob = createZipBlob([
    { name: 'render.bat', data: '@echo off\necho Compiling...\n' },
    { name: 'README.txt', data: 'Double click render.bat\n' },
    { name: '0_00-0_04.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }
  ]);

  assert.strictEqual(zipBlob.type, 'application/zip');
  assert.ok(zipBlob.size > 200, 'Zip blob size is valid');

  // Verify extraction with zip_extractor
  const arrayBuf = await zipBlob.arrayBuffer();
  const tempZip = 'test_pkg_verify.zip';
  fs.writeFileSync(tempZip, Buffer.from(arrayBuf));

  const extractDir = './test_pkg_extracted';
  try {
    const extracted = extractZipMedia(tempZip, extractDir);
    assert.strictEqual(extracted.length, 1, 'Extracted image entry');
    assert.strictEqual(extracted[0].name, '0_00-0_04.png');
  } finally {
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  }
});
