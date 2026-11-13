'use strict';

/**
 * test/browser_renderer.test.js — Tests for In-Browser Video Compilation Engine
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mp4-muxer.js exists and exports Muxer and ArrayBufferTarget', async () => {
  const muxerPath = path.join(__dirname, '..', 'public', 'js', 'mp4-muxer.js');
  assert.ok(fs.existsSync(muxerPath), 'mp4-muxer.js should exist in public/js');

  const muxerModule = await import('../public/js/mp4-muxer.js');
  assert.ok(typeof muxerModule.Muxer === 'function', 'Muxer constructor should be exported');
  assert.ok(typeof muxerModule.ArrayBufferTarget === 'function', 'ArrayBufferTarget constructor should be exported');
});

test('browser_renderer.js exports BROWSER_RESOLUTIONS, compileVideoInBrowser, and triggerFileDownload', async () => {
  const brPath = path.join(__dirname, '..', 'public', 'js', 'browser_renderer.js');
  assert.ok(fs.existsSync(brPath), 'browser_renderer.js should exist in public/js');

  const brModule = await import('../public/js/browser_renderer.js');
  assert.ok(brModule.BROWSER_RESOLUTIONS['720p'].width === 1280, '720p width should be 1280');
  assert.ok(brModule.BROWSER_RESOLUTIONS['1080p'].width === 1920, '1080p width should be 1920');
  assert.ok(typeof brModule.compileVideoInBrowser === 'function', 'compileVideoInBrowser should be exported');
  assert.ok(typeof brModule.triggerFileDownload === 'function', 'triggerFileDownload should be exported');
});

test('app.js integrates in-browser export for web deployments', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.ok(appJs.includes("import { compileVideoInBrowser, triggerFileDownload } from './browser_renderer.js'"), 'app.js should import browser_renderer');
  assert.ok(appJs.includes('startBrowserExport()'), 'startExport should route to startBrowserExport for web deployments');
  assert.ok(appJs.includes('Hardware: Browser WebCodecs'), 'UI should display Browser WebCodecs hardware indicator');
});
