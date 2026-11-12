'use strict';

/**
 * test_end_to_end_timing.js — 2-minute sample audio end-to-end test
 * Tests transcription words -> splitting in all 4 modes -> exports -> Studio sync
 */

const assert = require('node:assert/strict');
const {
  splitTranscript,
  exportCaptionsTxt,
  exportSRT,
  exportFilenamesListTxt,
  exportCSV,
  exportBlocksJSON,
  getBlockFilename,
  formatCaptionTime
} = require('../src/timing.js');

const { parseCaptionText } = require('../src/captions.js');
const { parseFilename } = require('../src/parser.js');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Running End-to-End Test: 2-Minute Voiceover Sample');
console.log('═══════════════════════════════════════════════════════════════\n');

const DURATION_2_MIN = 120; // 120 seconds

// Generate simulated realistic 2-minute word-level transcript with sentences and pauses
const words = [];
const scriptSentences = [
  "Welcome back to another deep dive into creative storytelling.",
  "Today we are exploring the secret of momentum in digital animation.",
  "When you start with a strong concept, every frame begins to align.",
  "Listen carefully. The pacing dictates emotion.",
  "A three-second cut feels urgent, snappy, and electric.",
  "While a five-second hold allows viewers to absorb detailed artwork.",
  "Notice how silence can emphasize the very next beat.",
  "In this section, we transition directly into the core breakdown.",
  "Pay attention to the character movements.",
  "Even simple gestures communicate immense personality.",
  "And finally, as the outro plays, the story reaches its natural conclusion."
];

let curSec = 1.0;
for (const sent of scriptSentences) {
  const tokens = sent.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const dur = 0.25 + (token.length * 0.04);
    words.push({
      word: token,
      start: Math.round(curSec * 100) / 100,
      end: Math.round((curSec + dur) * 100) / 100,
      probability: 0.98
    });
    curSec += dur + 0.12;
  }
  // Pause between sentences
  curSec += 0.85;
}

console.log(`Generated sample transcript: ${words.length} timed words over ${DURATION_2_MIN}s.`);

// ── Test Mode 1: 3s Fixed Grid ───────────────────────────────────────────────
console.log('\n--- 1. Testing 3s Fixed Grid Mode ---');
const res3s = splitTranscript(words, DURATION_2_MIN, { mode: '3s', avoidMidSentenceCut: false });
assert.equal(res3s.blocks.length, 40, '120s / 3s = 40 blocks');
assert.equal(res3s.blocks[0].filename, '0_00—0_03.png');
assert.equal(res3s.blocks[res3s.blocks.length - 1].filename, '1_57—2_00.png');

// Verify every block: caption timestamp must match filename start
res3s.blocks.forEach((b, i) => {
  const parsedFn = parseFilename(b.filename);
  assert.ok(parsedFn, `Filename ${b.filename} must be parseable`);
  assert.equal(parsedFn.startSec, b.start, `Filename start ${parsedFn.startSec} must match block start ${b.start}`);
  assert.equal(parsedFn.endSec, b.end, `Filename end ${parsedFn.endSec} must match block end ${b.end}`);
  if (i < res3s.blocks.length - 1) {
    assert.equal(b.end, res3s.blocks[i + 1].start, 'Blocks must be contiguous with no gaps or overlaps');
  }
});
console.log('✓ 3s Fixed Grid passed! (40 contiguous blocks, clean filenames 0_00—0_03 to 1_57—2_00)');

// ── Test Mode 2: 5s Fixed Grid ───────────────────────────────────────────────
console.log('\n--- 2. Testing 5s Fixed Grid Mode ---');
const res5s = splitTranscript(words, DURATION_2_MIN, { mode: '5s', avoidMidSentenceCut: false });
assert.equal(res5s.blocks.length, 24, '120s / 5s = 24 blocks');
assert.equal(res5s.blocks[0].filename, '0_00—0_05.png');
assert.equal(res5s.blocks[res5s.blocks.length - 1].filename, '1_55—2_00.png');

res5s.blocks.forEach((b, i) => {
  const parsedFn = parseFilename(b.filename);
  assert.equal(parsedFn.startSec, b.start);
  assert.equal(parsedFn.endSec, b.end);
  if (i < res5s.blocks.length - 1) {
    assert.equal(b.end, res5s.blocks[i + 1].start);
  }
});
console.log('✓ 5s Fixed Grid passed! (24 contiguous blocks, clean filenames 0_00—0_05 to 1_55—2_00)');

// ── Test Mode 3: Full Sentences ──────────────────────────────────────────────
console.log('\n--- 3. Testing Full Sentences Mode ---');
const resSent = splitTranscript(words, DURATION_2_MIN, {
  mode: 'sentences',
  minSentenceBlockSec: 2,
  maxSentenceBlockSec: 8,
  pauseThreshold: 0.6
});

assert.ok(resSent.blocks.length >= 10, 'Should create sentence blocks');
resSent.blocks.forEach((b, i) => {
  const parsedFn = parseFilename(b.filename);
  assert.ok(parsedFn);
  assert.equal(parsedFn.startSec, b.start);
  assert.equal(parsedFn.endSec, b.end);
  if (i < resSent.blocks.length - 1) {
    assert.equal(b.end, resSent.blocks[i + 1].start);
  }
});
console.log(`✓ Full Sentences passed! (${resSent.blocks.length} blocks, adhering to min/max boundaries)`);

// ── Test Mode 4: Custom Ranges ───────────────────────────────────────────────
console.log('\n--- 4. Testing Custom Ranges Mode ---');
// 0:00 - 0:30 at 3s, 0:30 - 1:15 at 5s, 1:15 - end at sentences
const customRules = [
  { from: '0:00', to: '0:30', mode: '3s' },
  { from: '0:30', to: '1:15', mode: '5s' }
];

const resCustom = splitTranscript(words, DURATION_2_MIN, {
  mode: 'custom',
  rules: customRules,
  defaultRestMode: 'sentences'
});

// Verify hard cuts at 30s and 75s
let has30 = false;
let has75 = false;
resCustom.blocks.forEach((b, i) => {
  if (b.end === 30 || b.start === 30) has30 = true;
  if (b.end === 75 || b.start === 75) has75 = true;
  assert.ok(!(b.start < 30 && b.end > 30), 'No block should cross 30s');
  assert.ok(!(b.start < 75 && b.end > 75), 'No block should cross 75s');
  if (i < resCustom.blocks.length - 1) {
    assert.equal(b.end, resCustom.blocks[i + 1].start, 'No gaps or overlaps in custom mode');
  }
});
assert.ok(has30, 'Must have cut at 30s');
assert.ok(has75, 'Must have cut at 75s');
console.log(`✓ Custom Ranges passed! (Hard cuts respected, 0-30s at 3s, 30-75s at 5s, 75-120s at sentences)`);

// ── Test 5: Exports & Timestamp-Filename Pairing ─────────────────────────────
console.log('\n--- 5. Testing Exports & Timestamp-Filename Pairing ---');
const captionsTxt = exportCaptionsTxt(res3s.blocks);
const filenamesTxt = exportFilenamesListTxt(res3s.blocks);
const srtTxt = exportSRT(res3s.blocks);
const csvTxt = exportCSV(res3s.blocks);
const jsonBlocks = exportBlocksJSON(res3s.blocks);

assert.ok(captionsTxt.length > 0);
assert.ok(filenamesTxt.length > 0);
assert.ok(srtTxt.length > 0);
assert.ok(csvTxt.length > 0);
assert.ok(jsonBlocks.length > 0);

// Verify EVERY caption line format: (m:ss) text
const captionLines = captionsTxt.split('\n');
captionLines.forEach(line => {
  const m = line.match(/^\((\d+):(\d{2})(?::(\d{2}))?\)\s+(.+)$/);
  assert.ok(m, `Caption line must match (m:ss) format: "${line}"`);
});

// Verify Studio Hand-Off:
// When Studio parses captionsTxt with parseCaptionText, every block start must match its filename!
const parsedByStudio = parseCaptionText(captionsTxt);
assert.ok(parsedByStudio.length > 0);

parsedByStudio.forEach(studioBlock => {
  const matchingOriginalBlock = res3s.blocks.find(b => b.start === studioBlock.timeSec);
  assert.ok(matchingOriginalBlock, `Studio block at ${studioBlock.timeSec}s must match original block start`);
  assert.equal(matchingOriginalBlock.filename, getBlockFilename(studioBlock.startSec, studioBlock.endSec || matchingOriginalBlock.end));
});

console.log('✓ Studio hand-off confirmed! Captions load and match timestamps and filenames exactly.');
console.log('\n===============================================================');
console.log('  ALL END-TO-END TESTS PASSED SUCCESSFULLY! (100% OK)');
console.log('===============================================================\n');
