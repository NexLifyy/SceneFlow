'use strict';

/**
 * timing.test.js — Unit tests for the SceneFlow Timing engine
 * Run with: node --test test/timing.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  formatTimeFilename,
  formatCaptionTime,
  getBlockFilename,
  parseTimeString,
  validateRules,
  splitTranscript,
  exportCaptionsTxt,
  exportFilenamesListTxt
} = require('../src/timing.js');

// ─── Filename and Caption Format ─────────────────────────────────────────────

test('filenames match required format with em dash', () => {
  assert.equal(getBlockFilename(0, 3), '0_00—0_03.png');
  assert.equal(getBlockFilename(3, 6), '0_03—0_06.png');
  assert.equal(getBlockFilename(62, 65), '1_02—1_05.png');
  assert.equal(getBlockFilename(3750, 3753), '1_02_30—1_02_33.png');
});

test('captions format matches (m:ss) with single space and unpadded minutes', () => {
  assert.equal(formatCaptionTime(3), '(0:03)');
  assert.equal(formatCaptionTime(65), '(1:05)');
  assert.equal(formatCaptionTime(750), '(12:30)');
  assert.equal(formatCaptionTime(3750), '(1:02:30)');
});

// ─── Fixed 3s and 5s on a 10:07 Audio (607s) ──────────────────────────────────

test('fixed 3s on 10:07 audio (607 seconds) produces shorter last block (606-607)', () => {
  const audioDuration = 607; // 10 minutes 7 seconds
  const words = [
    { word: 'Hello', start: 0.5, end: 1.0 },
    { word: 'world', start: 1.2, end: 2.0 },
    { word: 'Final', start: 606.1, end: 606.8 }
  ];

  const result = splitTranscript(words, audioDuration, { mode: '3s' });
  const blocks = result.blocks;

  // 607 / 3 = 202.33 -> 203 blocks
  assert.equal(blocks.length, 203);
  assert.equal(blocks[0].start, 0);
  assert.equal(blocks[0].end, 3);
  assert.equal(blocks[0].filename, '0_00—0_03.png');

  // Verify contiguous: each block starts where previous ends, no gaps, no overlaps
  for (let i = 0; i < blocks.length - 1; i++) {
    assert.equal(blocks[i].end, blocks[i + 1].start);
  }

  // Check last block
  const last = blocks[blocks.length - 1];
  assert.equal(last.start, 606);
  assert.equal(last.end, 607);
  assert.equal(last.filename, '10_06—10_07.png');
  assert.equal(last.caption, 'Final');
});

test('fixed 5s on 10:07 audio (607 seconds) produces shorter last block (605-607)', () => {
  const audioDuration = 607; // 10:07
  const result = splitTranscript([], audioDuration, { mode: '5s' });
  const blocks = result.blocks;

  // 607 / 5 = 121.4 -> 122 blocks
  assert.equal(blocks.length, 122);
  assert.equal(blocks[0].start, 0);
  assert.equal(blocks[0].end, 5);

  for (let i = 0; i < blocks.length - 1; i++) {
    assert.equal(blocks[i].end, blocks[i + 1].start);
  }

  const last = blocks[blocks.length - 1];
  assert.equal(last.start, 605);
  assert.equal(last.end, 607);
  assert.equal(last.filename, '10_05—10_07.png');
  assert.equal(last.silent, true);
});

// ─── Full Sentences (Short, Long, and Long Pause) ─────────────────────────────

test('full sentences with short sentence, long sentence, and long pause', () => {
  // Scenario:
  // 1. Very short sentence: "Yes." (0.5s duration) -> should merge with next fragment
  // 2. Normal sentence: "This is a great day."
  // 3. Long pause: 1.5s silence between 5.0s and 6.5s
  // 4. Very long sentence: 15 seconds without punctuation, with a comma in the middle -> splits near comma
  const words = [
    { word: 'Yes.', start: 0.5, end: 1.0 },
    { word: 'This', start: 1.2, end: 1.6 },
    { word: 'is', start: 1.7, end: 1.9 },
    { word: 'a', start: 2.0, end: 2.1 },
    { word: 'great', start: 2.2, end: 2.7 },
    { word: 'day.', start: 2.8, end: 3.2 },
    // Pause from 3.2 to 5.0 (1.8s pause)
    { word: 'Because', start: 5.0, end: 5.5 },
    { word: 'we', start: 5.6, end: 5.8 },
    { word: 'have', start: 5.9, end: 6.2 },
    { word: 'walked', start: 6.3, end: 6.8 },
    { word: 'for', start: 6.9, end: 7.1 },
    { word: 'a', start: 7.2, end: 7.3 },
    { word: 'very', start: 7.4, end: 7.8 },
    { word: 'long', start: 7.9, end: 8.3 },
    { word: 'time,', start: 8.4, end: 8.8 }, // comma near middle
    { word: 'we', start: 9.0, end: 9.3 },
    { word: 'decided', start: 9.4, end: 9.9 },
    { word: 'to', start: 10.0, end: 10.2 },
    { word: 'rest', start: 10.3, end: 10.7 },
    { word: 'under', start: 10.8, end: 11.2 },
    { word: 'the', start: 11.3, end: 11.5 },
    { word: 'big', start: 11.6, end: 12.0 },
    { word: 'shady', start: 12.1, end: 12.5 },
    { word: 'tree.', start: 12.6, end: 13.0 }
  ];

  const result = splitTranscript(words, 15, {
    mode: 'sentences',
    minSentenceBlockSec: 2,
    maxSentenceBlockSec: 8,
    pauseThreshold: 0.6
  });

  const blocks = result.blocks;
  assert.ok(blocks.length >= 3);

  // Check no gaps, no overlaps
  for (let i = 0; i < blocks.length - 1; i++) {
    assert.equal(blocks[i].end, blocks[i + 1].start);
  }

  // The very short sentence "Yes." must be merged (no 1-second block under minSentenceBlockSec)
  const firstBlock = blocks[0];
  assert.ok(firstBlock.end >= 2, 'First block merged to satisfy minSentenceBlockSec');
  assert.ok(firstBlock.caption.includes('Yes. This is a great day.'));

  // Ensure every block adheres to bounds
  for (const b of blocks) {
    assert.ok(Number.isInteger(b.start));
    assert.ok(Number.isInteger(b.end));
  }
});

// ─── Custom Ranges (0:00-1:00 at 3s, 1:00-3:00 at 5s, rest as sentences) ─────

test('custom ranges with no gaps, no overlaps, and no block crossing boundaries', () => {
  const totalSec = 300; // 5 minutes
  const rules = [
    { from: '0:00', to: '1:00', mode: '3s' },
    { from: '1:00', to: '3:00', mode: '5s' }
  ];

  // Dummy words throughout
  const words = [];
  for (let s = 1; s < totalSec; s += 2) {
    words.push({ word: `word_${s}.`, start: s, end: s + 0.8 });
  }

  const result = splitTranscript(words, totalSec, {
    mode: 'custom',
    rules,
    defaultRestMode: 'sentences'
  });

  const blocks = result.blocks;

  // 1. Boundary checks: Hard cuts at 60s and 180s
  let hasCutAt60 = false;
  let hasCutAt180 = false;
  let crosses60 = false;
  let crosses180 = false;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.end === 60 || b.start === 60) hasCutAt60 = true;
    if (b.end === 180 || b.start === 180) hasCutAt180 = true;
    if (b.start < 60 && b.end > 60) crosses60 = true;
    if (b.start < 180 && b.end > 180) crosses180 = true;

    // Check no overlaps and no gaps
    if (i < blocks.length - 1) {
      assert.equal(b.end, blocks[i + 1].start, `Gap or overlap between block ${i} and ${i + 1}`);
    }
  }

  assert.ok(hasCutAt60, 'Must have cut at exactly 60s (1:00)');
  assert.ok(hasCutAt180, 'Must have cut at exactly 180s (3:00)');
  assert.equal(crosses60, false, 'No block should cross 60s boundary');
  assert.equal(crosses180, false, 'No block should cross 180s boundary');

  // 2. Check blocks inside 0:00 - 1:00 are 3s intervals
  const range1Blocks = blocks.filter(b => b.end <= 60);
  assert.equal(range1Blocks.length, 20); // 60 / 3 = 20
  assert.equal(range1Blocks[0].start, 0);
  assert.equal(range1Blocks[0].end, 3);

  // 3. Check blocks inside 1:00 - 3:00 are 5s intervals
  const range2Blocks = blocks.filter(b => b.start >= 60 && b.end <= 180);
  assert.equal(range2Blocks.length, 24); // 120 / 5 = 24
  assert.equal(range2Blocks[0].start, 60);
  assert.equal(range2Blocks[0].end, 65);
});

// ─── Overlapping Rules Rejected ──────────────────────────────────────────────

test('rejects overlapping rules with clear error message', () => {
  const overlappingRules = [
    { from: '0:00', to: '1:30', mode: '3s' },
    { from: '1:00', to: '3:00', mode: '5s' }
  ];

  const validation = validateRules(overlappingRules, 300);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
  assert.match(validation.errors[0].message, /overlaps with Rule/);
});

test('accepts non-overlapping rules', () => {
  const goodRules = [
    { from: '0:00', to: '1:00', mode: '3s' },
    { from: '1:00', to: '2:30', mode: '5s' },
    { from: '2:30', to: 'end', mode: 'sentences' }
  ];

  const validation = validateRules(goodRules, 300);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

// ─── Exports Generation ──────────────────────────────────────────────────────

test('exports captions .txt with (m:ss) format, skips silent blocks, no blank lines', () => {
  const sampleBlocks = [
    { number: 1, filename: '0_00—0_03.png', start: 0, end: 3, caption: 'First caption here', silent: false },
    { number: 2, filename: '0_03—0_06.png', start: 3, end: 6, caption: '', silent: true },
    { number: 3, filename: '0_06—0_10.png', start: 6, end: 10, caption: 'Second caption here', silent: false }
  ];

  const txt = exportCaptionsTxt(sampleBlocks);
  const lines = txt.split('\n');

  assert.equal(lines.length, 2);
  assert.equal(lines[0], '(0:00) First caption here');
  assert.equal(lines[1], '(0:06) Second caption here');
});

test('exports filenames list .txt with tab separator', () => {
  const sampleBlocks = [
    { number: 1, filename: '0_00—0_03.png', start: 0, end: 3, caption: 'First line', silent: false },
    { number: 2, filename: '0_03—0_06.png', start: 3, end: 6, caption: '', silent: true }
  ];

  const txt = exportFilenamesListTxt(sampleBlocks);
  const lines = txt.split('\n');
  assert.equal(lines[0], '0_00—0_03.png\tFirst line');
  assert.equal(lines[1], '0_03—0_06.png\t[Silent]');
});

test('Timing page HTML and scripts reflect streamlined UI, Paste Script, full waveform, and no Whisper names during progress', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const start = html.indexOf('<div id="page-timing"');
  const end = html.indexOf('<div id="page-prompts"');
  assert.ok(start > 0 && end > start, 'Expected #page-timing section bounds');
  const timingHtml = html.slice(start, end);

  for (const removed of [
    'Timing &amp; Precise Cadence Ingestion',
    'Segmentation Engine Setup',
    'Faster-Whisper AI',
    '99.4% Accuracy',
    'SceneFlow AI Neural',
    '99 Languages',
    'Auto (99 languages supported)',
    'Dynamic Mode',
    'Offline Ready',
    'Engine Ready',
    'btn-upload-srt',
    'Upload SRT / VTT',
    'Or paste pre-timed cues',
    'sp-audio-dur',
    'Synced Master',
    'Pause threshold',
    'sp-pause-thresh',
    'Timeline Plan Preview',
    'sp-plan-bar',
    'shadow-glow',
    'shadow-lg',
    'shadow-md',
    'shadow-xl',
    'glow-'
  ]) {
    assert.equal(timingHtml.includes(removed), false, `Removed text/class still present in #page-timing: ${removed}`);
  }

  assert.ok(timingHtml.includes('>Auto</option>'), 'Expected concise Auto option in language select');
  assert.ok(timingHtml.includes('id="btn-clear-splitter"') && timingHtml.includes('>Reset</span>'), 'Expected Reset button inside Timing');
  assert.ok(timingHtml.includes('id="btn-paste-script"') && timingHtml.includes('>Paste Script</span>'), 'Expected Paste Script button');
  assert.ok(
    timingHtml.includes('placeholder="Optional: Paste the script read in the voiceover. Timestamps then use exact wording with zero transcription spelling errors."'),
    'Expected shortened placeholder text ending at spelling errors'
  );
  assert.ok(timingHtml.includes('id="sp-waveform-bars"'), 'Expected #sp-waveform-bars full-width container');
  assert.ok(timingHtml.includes('id="sp-model-status" class="model-status-card hidden"'), 'Expected #sp-model-status hidden initially');

  const browserJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'whisper_browser.js'), 'utf8');
  assert.equal(/whisper/i.test(browserJs.match(/text:\s*['"`]([^'"`]+)/g)?.join(' ') || ''), false, 'Browser progress text must not expose Whisper name');

  const modelsJs = require('../src/whisper_models.js');
  const fastStatus = modelsJs.getAllModelsStatus().fast;
  assert.equal(/whisper/i.test(fastStatus.realName), false, 'Model realName should not expose Whisper');
  assert.equal(/whisper/i.test(fastStatus.description), false, 'Model description should not expose Whisper');

  const timingUiJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'timing_ui.js'), 'utf8');
  assert.ok(timingUiJs.includes('rule-from bg-[#0B0F14] text-[#E8EEF4]'), 'Expected dark styling on Custom rule inputs');
  assert.ok(timingUiJs.includes('rule-mode bg-[#0B0F14] text-[#E8EEF4]'), 'Expected dark styling on Custom rule select');
  assert.ok(timingHtml.includes('id="btn-send-to-prompts"'), 'Expected #btn-send-to-prompts button in Timing results');
  assert.ok(timingHtml.includes('Send to Prompts &rarr;'), 'Expected "Send to Prompts" label in Timing results');
  assert.equal(timingHtml.includes('Send to Studio'), false, 'Timing results should no longer show Send to Studio');
  assert.ok(timingUiJs.includes('function sendToPrompts('), 'Expected sendToPrompts handler in timing_ui.js');
  assert.ok(timingUiJs.includes('<span id="sp-dl-mb" class="hidden"></span>'), 'Expected #sp-dl-mb hidden while Preparing');
});

test('formatModelLoadProgress omits MB while Preparing and shows MB only while Downloading', async () => {
  const { formatModelLoadProgress } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'whisper_browser.js')).href
  );

  // 1. Initial initiate status -> Preparing, no MB
  const initRes = formatModelLoadProgress({
    modelKey: 'fast',
    status: 'initiate',
    isCached: false,
    loadedBytes: 0,
    totalBytes: 145 * 1024 * 1024
  });
  assert.equal(initRes.isDownloading, false);
  assert.match(initRes.text, /^Preparing Fast AI model/);
  assert.equal(initRes.text.includes('MB'), false, `Preparing must not include MB: ${initRes.text}`);

  // 2. Cached model progress -> Preparing, no MB
  const cachedRes = formatModelLoadProgress({
    modelKey: 'best',
    status: 'progress',
    isCached: true,
    loadedBytes: 120 * 1024 * 1024,
    totalBytes: 470 * 1024 * 1024
  });
  assert.equal(cachedRes.isDownloading, false);
  assert.match(cachedRes.text, /^Preparing Best AI model/);
  assert.equal(cachedRes.text.includes('MB'), false, `Cached Preparing must not include MB: ${cachedRes.text}`);

  // 3. Tiny metadata chunk rounding to 0.0 MB -> Preparing, no 0.0 MB
  const zeroMbRes = formatModelLoadProgress({
    modelKey: 'fast',
    status: 'progress',
    isCached: false,
    loadedBytes: 1024,
    totalBytes: 145 * 1024 * 1024
  });
  assert.equal(zeroMbRes.isDownloading, false);
  assert.equal(zeroMbRes.text.includes('MB'), false, `Sub-0.1MB metadata must not show 0.0 MB: ${zeroMbRes.text}`);

  // 4. Active network download -> Downloading + MB
  const dlRes = formatModelLoadProgress({
    modelKey: 'fast',
    status: 'progress',
    isCached: false,
    loadedBytes: 12.5 * 1024 * 1024,
    totalBytes: 145 * 1024 * 1024
  });
  assert.equal(dlRes.isDownloading, true);
  assert.equal(dlRes.text, 'Downloading Fast AI model: 12.5 / 145 MB (9%)');
});
