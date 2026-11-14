'use strict';

/**
 * test/studio.test.js — Unit & Integration Tests for SceneFlow Studio Section 01 & Zip Ingestion
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('zlib');
const http = require('node:http');

const { extractZipMedia } = require('../src/zip_extractor');
const { generateASS, chunkWords } = require('../src/captions');
const app = require('../server');

/**
 * Build a minimal valid PKZIP buffer from an array of { name, data, deflate }.
 */
function buildTestZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const method = entry.deflate ? 8 : 0;
    const compData = entry.deflate ? zlib.deflateRawSync(rawData) : rawData;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const flags = 0x0800; // UTF-8 filename

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(compData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);

    localParts.push(localHeader, nameBuf, compData);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compData.length;
  }

  const cdBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

test('extractZipMedia extracts UTF-8 em-dash media files and skips metadata/non-media entries', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sceneflow-zip-test-'));
  try {
    const zipPath = path.join(tmpRoot, 'batch_frames.zip');
    const outDir = path.join(tmpRoot, 'extracted');

    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
    const zipBuf = buildTestZipBuffer([
      { name: 'frames/', data: Buffer.alloc(0) },
      { name: '__MACOSX/frames/._0_00—0_03.png', data: Buffer.from('junk') },
      { name: 'frames/readme.txt', data: Buffer.from('ignore text') },
      { name: 'frames/0_00—0_03.png', data: fakePng, deflate: true },
      { name: 'frames/0_03—0_06.png', data: fakePng, deflate: false },
      { name: 'scene_01.mp4', data: Buffer.from('fake-mp4-bytes'), deflate: true }
    ]);
    fs.writeFileSync(zipPath, zipBuf);

    const extracted = extractZipMedia(zipPath, outDir);
    assert.equal(extracted.length, 3);
    assert.deepEqual(
      extracted.map(f => ({ name: f.name, type: f.type })),
      [
        { name: '0_00—0_03.png', type: 'image' },
        { name: '0_03—0_06.png', type: 'image' },
        { name: 'scene_01.mp4', type: 'video' }
      ]
    );
    assert.ok(fs.existsSync(path.join(outDir, '0_00—0_03.png')));
    assert.deepEqual(fs.readFileSync(path.join(outDir, '0_00—0_03.png')), fakePng);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('POST /api/upload-zip extracts uploaded zip archive media entries cleanly', async () => {
  const srv = app.listen(0);
  const { port } = srv.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  const createdNames = [];

  try {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const zipBuf = buildTestZipBuffer([
      { name: '__studio_zip_test_0_00—0_03.png', data: fakePng, deflate: true },
      { name: '__studio_zip_test_0_03—0_06.png', data: fakePng, deflate: true }
    ]);
    createdNames.push('__studio_zip_test_0_00—0_03.png', '__studio_zip_test_0_03—0_06.png');

    const form = new FormData();
    form.append('zip', new Blob([zipBuf], { type: 'application/zip' }), '__studio_test_frames.zip');

    const res = await fetch(`${baseUrl}/api/upload-zip`, { method: 'POST', body: form });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.deepEqual(body.files.map(f => f.name), createdNames);
    assert.equal(fs.existsSync(path.join(uploadsDir, '__studio_test_frames.zip')), false, 'Temporary zip upload should be cleaned up');
  } finally {
    srv.close();
    for (const name of createdNames) {
      try { fs.unlinkSync(path.join(uploadsDir, name)); } catch {}
    }
  }
});

test('Studio page HTML renders clean streamlined 1-Click Render Package workstation card matching Images page layout', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const start = html.indexOf('<div id="page-studio"');
  const end = html.indexOf('<!-- /#page-studio -->', start);
  assert.ok(start > 0 && end > start, 'Expected #page-studio bounds');
  const studioHtml = html.slice(start, end);

  // Asserts that the new streamlined 1-Click Render card is rendered
  assert.ok(studioHtml.includes('Compile your video with 1-Click Offline FFmpeg Engine'), 'Expected main card heading');
  assert.ok(studioHtml.includes('id="btn-add-files"'), 'Expected Attach Images button');
  assert.ok(studioHtml.includes('id="studio-images-count"'), 'Expected images counter');
  assert.ok(studioHtml.includes('id="s-resolution"'), 'Expected resolution selector');
  assert.ok(studioHtml.includes('id="btn-create-video"'), 'Expected export action button');
  assert.ok(studioHtml.includes('Download 1-Click Render Package (.zip)'), 'Expected 1-Click Render Package button text');

  // Confirms all old multi-section studio clutter is removed from #page-studio
  for (const removed of [
    'MEDIA & AUDIO ASSET DECK',
    'RENDER & MOTION ENGINE SETTINGS',
    'CAPTIONS & SUBTITLES STUDIO',
    'PRECISION MULTI-TRACK TIMELINE',
    'EXPORT CONFIGURATION & HIGH-SPEED RENDER',
    'Scan Folder on Disk',
    'id="media-viewport"',
    'id="timeline-tracks"'
  ]) {
    assert.equal(studioHtml.includes(removed), false, `Old removed clutter still present in #page-studio: ${removed}`);
  }
});

test('Captions chunkWords and generateASS support full line default, fonts, colors, and styling', () => {
  const sampleWords = 'You have been exhausted all day long'.split(' ').map((w, i) => ({
    word: w,
    startSec: i * 0.4,
    endSec: (i + 1) * 0.4,
    lineIndex: 0,
    lineStart: 0,
    lineEnd: 2.8,
  }));
  assert.equal(chunkWords(sampleWords).length, 1, 'Default chunkWords should keep the full line in 1 chunk');

  const ass = generateASS(sampleWords, {
    style: 'beast',
    font: 'Outfit',
    color: '#FF5555',
    highlightColor: '#00FFFF',
  });
  assert.ok(ass.includes('Style: Default,Outfit,'), 'Generated ASS should use custom Fontname');
  assert.ok(ass.includes('&H005555FF'), 'Generated ASS should use custom primary text color in BBGGRR');
  assert.ok(ass.includes('{\\c&H00FFFF00&'), 'Generated ASS should use custom highlight color in BBGGRR');
  assert.ok(ass.includes('YOU') && ass.includes('LONG'), 'Default generateASS should keep full line of words in Dialogue');

  const assBold = generateASS(sampleWords, { style: 'bold' });
  assert.ok(assBold.includes('YOU HAVE BEEN EXHAUSTED ALL DAY LONG'), 'Bold ASS should render full line when wordsPerLine omitted');
});

test('Settings & export download endpoints handle C:\\ default and missing job cleanly', async () => {
  const srv = app.listen(0);
  const { port } = srv.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const sRes = await fetch(`${baseUrl}/api/settings`);
    assert.equal(sRes.status, 200);
    const settings = await sRes.json();
    if (process.platform === 'win32') {
      assert.equal(settings.saveFolder, 'C:\\', 'Settings default saveFolder should be C:\\ on Windows');
    }

    const dlRes = await fetch(`${baseUrl}/api/export/nonexistent_job/download`);
    assert.equal(dlRes.status, 404);

    const streamRes = await fetch(`${baseUrl}/api/export/nonexistent_job/stream`);
    assert.equal(streamRes.status, 404);
  } finally {
    srv.close();
  }
});

test('Render completion hides Cancel Render and wires Play Video inline player without /api/open-file', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.ok(html.includes('id="render-video-player"'), 'Render modal should contain inline <video> player');
  assert.equal(appJs.includes('/api/open-file'), false, 'Play Video should not call non-existent /api/open-file');
  assert.ok(appJs.includes("$('btn-cancel-render').classList.add('hidden')"), 'Completion/error should hide Cancel Render button');
});
