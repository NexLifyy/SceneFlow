/**
 * parser.test.js — Unit tests for the filename parser
 * Run with: npm test
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFilename, buildTimeline } = require('../src/parser.js');

// ─── parseFilename ──────────────────────────────────────────────────────────

test('parses 0_00—0_03 (em dash)', () => {
  const r = parseFilename('0_00—0_03.png');
  assert.deepEqual(r, { startSec: 0, endSec: 3 });
});

test('parses 0_30—0_33 (em dash)', () => {
  const r = parseFilename('0_30—0_33.png');
  assert.deepEqual(r, { startSec: 30, endSec: 33 });
});

test('parses 1_02—1_05 (em dash)', () => {
  const r = parseFilename('1_02—1_05.png');
  assert.deepEqual(r, { startSec: 62, endSec: 65 });
});

test('parses en dash (–)', () => {
  const r = parseFilename('0_30–0_33.png');
  assert.deepEqual(r, { startSec: 30, endSec: 33 });
});

test('parses hyphen (-)', () => {
  const r = parseFilename('0_30-0_33.png');
  assert.deepEqual(r, { startSec: 30, endSec: 33 });
});

test('parses H_MM_SS format (1_02_30—1_02_33)', () => {
  const r = parseFilename('1_02_30—1_02_33.png');
  // 1h 2m 30s = 3750, 1h 2m 33s = 3753
  assert.deepEqual(r, { startSec: 3750, endSec: 3753 });
});

test('returns null for unparseable filename', () => {
  assert.equal(parseFilename('screenshot.png'), null);
  assert.equal(parseFilename('image001.jpg'), null);
  assert.equal(parseFilename(''), null);
});

test('returns null for malformed (end < start)', () => {
  // 1_05—0_30 → 65s to 30s — invalid
  assert.equal(parseFilename('1_05—0_30.png'), null);
});

// ─── buildTimeline ──────────────────────────────────────────────────────────

test('sorts timed clips by start time', () => {
  const files = [
    { name: '1_02—1_05.png', path: '/c', type: 'image' },
    { name: '0_00—0_03.png', path: '/a', type: 'image' },
    { name: '0_30—0_33.png', path: '/b', type: 'image' },
  ];
  const clips = buildTimeline(files, { gapMode: 'black' });
  // Should be sorted: 0, 30, 62 — with gaps between them
  const timed = clips.filter(c => c.type !== 'gap');
  assert.equal(timed[0].startSec, 0);
  assert.equal(timed[1].startSec, 30);
  assert.equal(timed[2].startSec, 62);
});

test('gap mode: extend previous clip fills gaps', () => {
  const files = [
    { name: '0_00—0_03.png', path: '/a', type: 'image' },
    { name: '0_10—0_13.png', path: '/b', type: 'image' },
  ];
  const clips = buildTimeline(files, { gapMode: 'extend' });
  // First clip should be extended from 3→10
  assert.equal(clips[0].endSec, 10);
  assert.equal(clips.length, 2); // no gap clip inserted
});

test('gap mode: black inserts gap clip', () => {
  const files = [
    { name: '0_00—0_03.png', path: '/a', type: 'image' },
    { name: '0_10—0_13.png', path: '/b', type: 'image' },
  ];
  const clips = buildTimeline(files, { gapMode: 'black' });
  assert.equal(clips.length, 3);
  assert.equal(clips[1].type, 'gap');
  assert.equal(clips[1].startSec, 3);
  assert.equal(clips[1].endSec, 10);
});

test('overlapping clips: trims earlier clip', () => {
  const files = [
    { name: '0_00—0_10.png', path: '/a', type: 'image' },
    { name: '0_05—0_08.png', path: '/b', type: 'image' }, // overlaps
  ];
  const clips = buildTimeline(files, { gapMode: 'black' });
  const timed = clips.filter(c => c.type !== 'gap');
  assert.equal(timed[0].endSec, 5); // trimmed to next start
  assert.equal(timed[1].startSec, 5);
});

test('untimed files placed after timed, 3s each', () => {
  const files = [
    { name: '0_00—0_03.png', path: '/a', type: 'image' },
    { name: 'cover.png',     path: '/b', type: 'image' },
    { name: 'outro.png',     path: '/c', type: 'image' },
  ];
  const clips = buildTimeline(files, { gapMode: 'black' });
  const untimed = clips.filter(c => !c.timed);
  assert.equal(untimed[0].startSec, 3);
  assert.equal(untimed[0].durationSec, 3);
  assert.equal(untimed[1].startSec, 6);
  assert.equal(untimed[1].durationSec, 3);
});

test('all untimed files get 3s each from time 0', () => {
  const files = [
    { name: 'a.png', path: '/a', type: 'image' },
    { name: 'b.png', path: '/b', type: 'image' },
  ];
  const clips = buildTimeline(files, {});
  assert.equal(clips[0].startSec, 0);
  assert.equal(clips[1].startSec, 3);
});

console.log('All tests passed!');
