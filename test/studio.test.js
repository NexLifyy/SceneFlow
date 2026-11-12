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

test('Studio Section 01 HTML & CSS reflect Add Zip, Reset, 8-image fixed-height grid + slider, and clean audio labels', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  const start = html.indexOf('<div id="page-studio"');
  const end = html.indexOf('<!-- SECTION 2', start);
  assert.ok(start > 0 && end > start, 'Expected #page-studio Section 01 bounds');
  const sec1 = html.slice(start, end);

  for (const removed of [
    '(Timestamp Driven Ingestion)',
    'Scan Folder on Disk',
    'Clear Media',
    'Recognized formats:',
    '0_00—0_03.png',
    '0_30—0_33.png',
    'scene_01.mp4',
    '(Sync Master)',
    '(Bed Audio)'
  ]) {
    assert.equal(sec1.includes(removed), false, `Removed text still present in Studio Section 01: ${removed}`);
  }

  assert.ok(sec1.includes('id="btn-add-zip"') && sec1.includes('>Add Zip</span>'), 'Expected Add Zip button');
  assert.ok(sec1.includes('id="btn-clear"') && sec1.includes('>Reset</span>'), 'Expected Reset button');
  assert.ok(sec1.includes('id="media-slider"'), 'Expected media slider for overflow past 8 images');

  const voiceStart = sec1.indexOf('Voiceover Track');
  const musicStart = sec1.indexOf('Background Music');
  assert.ok(voiceStart > 0 && musicStart > voiceStart, 'Expected Voiceover Track before Background Music');
  assert.ok(sec1.slice(voiceStart, musicStart).includes('optional'), 'Voiceover Track should keep optional label');
  assert.ok(sec1.slice(musicStart).includes('optional'), 'Background Music should have optional label');

  assert.ok(css.includes('calc((100% - 7 * 0.65rem) / 8)'), 'Expected 8-image horizontal grid sizing');
  assert.ok(css.includes('height: 204px;'), 'Expected fixed-height drop zone box so height does not expand');
  assert.ok(css.includes('scrollbar-width: none;'), 'Expected native horizontal scrollbar hidden above slider');

  const sec2End = html.indexOf('<!-- SECTION 3', end);
  assert.ok(sec2End > end, 'Expected Studio Section 02 bounds');
  const sec2 = html.slice(end, sec2End);
  assert.equal(sec2.includes('(Hardware Accelerated Engine)'), false, 'Hardware Accelerated Engine subtitle should be removed');
  assert.equal(sec2.includes('Toggle active motion types'), false, 'Toggle active motion types hint should be removed');
  const transIdx = sec2.indexOf('id="transition-types"');
  assert.equal(sec2.slice(transIdx).includes('border-t'), false, 'Transition Sound Volume should not have a top border line');
});

test('Studio Section 03 HTML & captions.js support full line default, No Caption default, font, color, highlight, and stretched box', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sec3Start = html.indexOf('<!-- SECTION 3');
  const sec4Start = html.indexOf('<!-- SECTION 4', sec3Start);
  assert.ok(sec3Start > 0 && sec4Start > sec3Start, 'Expected Studio Section 03 bounds');
  const sec3 = html.slice(sec3Start, sec4Start);

  for (const removed of [
    '(Synced to Speech Timecodes)',
    'Words Per Line:',
    'id="s-caption-words"',
    '[ Frame Canvas — Ready ]',
    'SAMPLE CAPTION TEXT',
    '>Synced</span>',
    'shadow-teal-500/20',
    '<div class="h-10',
    "Or click 'Send to Studio' from Timing!"
  ]) {
    assert.equal(sec3.includes(removed), false, `Removed content still present in Section 03: ${removed}`);
  }

  assert.match(sec3, /<button[^>]*class="template-card active[^"]*"[^>]*data-style="none"/, 'No Caption card should be active by default');
  assert.doesNotMatch(sec3, /<button[^>]*class="template-card active[^"]*"[^>]*data-style="bold"/, 'Bold Pop card should not be active by default');
  assert.match(sec3, /<textarea[^>]*id="caption-text"[^>]*class="[^"]*flex-1/, 'Caption textarea should use flex-1 to stretch to bottom footer');

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

  const sec5Start = html.indexOf('<!-- SECTION 5', sec4Start);
  assert.ok(sec5Start > sec4Start, 'Expected Studio Section 04 bounds');
  const sec4 = html.slice(sec4Start, sec5Start);
  assert.equal(sec4.includes('id="btn-timeline-play"'), false, 'Timeline play button should be removed');
  assert.equal(sec4.includes('id="btn-timeline-fit"'), false, 'Timeline FIT button should be removed');
  assert.equal(sec4.includes('id="timeline-time"'), false, 'Timeline clock box should be removed');
  assert.equal(sec4.includes('id="timeline-scale"'), false, 'Timeline zoom slider should be removed');
  const h2End = sec4.indexOf('</h2>');
  assert.equal(sec4.slice(0, h2End).includes('Total Duration:'), false, 'Total Duration should be removed from left heading');
  assert.ok(sec4.slice(h2End).includes('id="timeline-duration"') && sec4.slice(h2End).includes('Total Duration:'), 'Total Duration should appear on right side of Section 04 header');

  const studioEnd = html.indexOf('<!-- /#page-studio -->', sec5Start);
  assert.ok(studioEnd > sec5Start, 'Expected Studio Section 05 bounds');
  const sec5 = html.slice(sec5Start, studioEnd);
  assert.equal(sec5.includes('FFmpeg Accelerated'), false, 'FFmpeg Accelerated badge should be removed');
  assert.equal(sec5.includes('Quick Path:'), false, 'Quick Path label should be removed');
  assert.equal(sec5.includes('id="out-dir-presets"'), false, 'Quick Path chips container should be removed');
  assert.equal(sec5.includes('Start Render'), false, 'Start Render text should be removed');
  assert.ok(sec5.includes('>Create Video</span>'), 'Render button should be named Create Video');
  assert.ok(sec5.includes('justify-center'), 'Render button container should center the button');
  assert.ok(sec5.includes('id="out-dir"') && sec5.includes('value="C:\\"'), 'Destination Folder should default to C:\\');
  assert.ok(sec5.includes('id="btn-browse-out-dir"'), 'Browse button should be present');
  assert.equal(html.includes('id="modal-folder-browser"'), false, 'Custom HTML folder modal should not be used');

  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.ok(appJs.includes('window.showDirectoryPicker'), 'Browse should use Chrome native Windows Explorer showDirectoryPicker');
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
