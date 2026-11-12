'use strict';

/**
 * test/images.test.js — Unit Tests for SceneFlow Images (Free Bulk Generation Page)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

async function loadImagesUI() {
  const url = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'images_ui.js')).href;
  return import(url);
}

test('FREE_BULK_IMAGE_URL matches required Gemini share link', async () => {
  const { FREE_BULK_IMAGE_URL } = await loadImagesUI();
  assert.equal(FREE_BULK_IMAGE_URL, 'https://share.gemini.google/NSIngZmfcsMu');
});

test('index.html renders clean streamlined Images page without removed banners or footer', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="nav-btn-images"'), 'Missing Images nav button');
  assert.ok(html.includes('id="page-images"'), 'Missing Images page container');
  assert.ok(html.includes('Make your images now with Free Bulk Generation'), 'Missing heading');
  assert.ok(html.includes('Open Free Bulk Generation'), 'Missing primary button');
  assert.ok(html.includes('Copy link'), 'Missing copy link button');
  assert.ok(html.includes('href="https://share.gemini.google/NSIngZmfcsMu"'), 'Missing share.gemini.google link href');
  assert.ok(html.includes('about 1,000+ a day, even with no credits'), 'Missing step 3 text');

  const start = html.indexOf('<div id="page-images"');
  const end = html.indexOf('<div id="page-studio"');
  const imagesHtml = html.slice(start, end);
  for (const removed of [
    'Free Bulk Generation Workflow',
    'Copy Prompts from Prompts Tab',
    'Zero-Credit Bulk Image Pipeline',
    'Opens in a new tab. The images are made on your own Google account',
    'Ready now in SceneFlow:',
    'shadow-2xl',
    'shadow-lg',
    'glow-indigo-subtle'
  ]) {
    assert.equal(imagesHtml.includes(removed), false, `Removed text/class still present in #page-images: ${removed}`);
  }
});

test('initImagesUI wires Open Free Bulk Generation link, Copy link feedback, and tab navigation', async () => {
  const { initImagesUI, FREE_BULK_IMAGE_URL } = await loadImagesUI();

  const elements = {};
  function makeEl(id, extra = {}) {
    const classes = new Set();
    const attrs = { ...(extra.attrs || {}) };
    const el = {
      id,
      href: '',
      textContent: extra.textContent || '',
      value: extra.value || '',
      onclick: null,
      classList: {
        add: (...cls) => cls.forEach(c => classes.add(c)),
        remove: (...cls) => cls.forEach(c => classes.delete(c)),
        contains: (c) => classes.has(c)
      },
      getAttribute: (k) => attrs[k] ?? null,
      setAttribute: () => {},
      style: {},
      select: () => {}
    };
    elements[id] = el;
    return el;
  }

  const copyBtn = makeEl('img-btn-copy-link');
  const copyLabel = makeEl('img-copy-link-label', { textContent: 'Copy link' });
  makeEl('img-btn-copy-prompts');
  makeEl('img-copy-prompts-feedback');
  const openBtn = makeEl('img-btn-open-bulk');
  const navLinkPrompts = makeEl('mock-nav-prompts', { attrs: { 'data-nav-target': 'prompts' } });

  let clipboardWritten = '';
  let switchedTab = '';

  global.document = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: (sel) => (sel === '#page-images [data-nav-target]' ? [navLinkPrompts] : []),
    createElement: () => makeEl('temp'),
    execCommand: () => true,
    body: { appendChild: () => {}, removeChild: () => {} }
  };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (txt) => {
          clipboardWritten = txt;
        }
      }
    }
  });
  global.window = {
    switchToTab: (t) => { switchedTab = t; }
  };

  try {
    initImagesUI();
    assert.equal(openBtn.href, FREE_BULK_IMAGE_URL);

    await copyBtn.onclick();
    assert.equal(clipboardWritten, FREE_BULK_IMAGE_URL);
    assert.equal(copyLabel.textContent, 'Copied!');

    navLinkPrompts.onclick({ preventDefault: () => {} });
    assert.equal(switchedTab, 'prompts');
  } finally {
    delete global.document;
    delete global.navigator;
    delete global.window;
  }
});
