'use strict';

/**
 * test/sceneflow_routes.test.js — Verifies SceneFlow branding, nav order, legacy URL redirects, and hand-off compatibility
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('navbar and pages follow exact order Voice → Timing → Prompts → Images → Studio', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  const navOrder = [
    html.indexOf('id="nav-btn-voice"'),
    html.indexOf('id="nav-btn-timing"'),
    html.indexOf('id="nav-btn-prompts"'),
    html.indexOf('id="nav-btn-images"'),
    html.indexOf('id="nav-btn-studio"')
  ];
  navOrder.forEach((pos, idx) => assert.ok(pos > 0, `Nav button #${idx + 1} missing`));
  for (let i = 0; i < navOrder.length - 1; i++) {
    assert.ok(navOrder[i] < navOrder[i + 1], `Nav order wrong at index ${i}`);
  }

  const pageOrder = [
    html.indexOf('id="page-voice"'),
    html.indexOf('id="page-timing"'),
    html.indexOf('id="page-prompts"'),
    html.indexOf('id="page-images"'),
    html.indexOf('id="page-studio"')
  ];
  pageOrder.forEach((pos, idx) => assert.ok(pos > 0, `Page container #${idx + 1} missing`));
  for (let i = 0; i < pageOrder.length - 1; i++) {
    assert.ok(pageOrder[i] < pageOrder[i + 1], `Page order wrong at index ${i}`);
  }
});

test('public/index.html contains SceneFlow brand and zero forbidden old/competitor UI strings', () => {
  const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(rawHtml.includes('<strong class="text-[#14B8A6] font-extrabold">Flow</strong>'), 'Expected SceneFlow header brand');
  assert.ok(rawHtml.includes('<title>SceneFlow'), 'Expected SceneFlow title');
  assert.equal(rawHtml.includes('SceneFlow v3.2'), false, 'SceneFlow v3.2 badge should be removed from header');
  assert.equal(rawHtml.includes('CPU (libx264)'), false, 'CPU (libx264) badge should be removed from header');
  assert.equal(rawHtml.includes('id="btn-history"'), false, 'History header button should be removed');

  // Exclude only the local disk destination path input value="D:\Apps\video export\frame-maker\exports"
  const scrubbedHtml = rawHtml.replace(/D:\\Apps\\video export\\frame-maker\\exports/gi, '');

  const forbidden = [
    'Frame Maker',
    'FrameMaker',
    'YtHunter',
    'Frame Hunter',
    'Script Splitter',
    'VO Hunter',
    'Prompt Hunter',
    'Prompt Mapper',
    'StampHunter',
    'Pro v3.2'
  ];

  for (const term of forbidden) {
    assert.equal(
      new RegExp(term, 'i').test(scrubbedHtml),
      false,
      `Forbidden old/competitor text "${term}" found in public/index.html`
    );
  }
});

test('resolveTabTarget normalizes all new and legacy paths/hashes cleanly (defaults / to voice)', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'timing_ui.js')).href);
  assert.equal(mod.resolveTabTarget(''), 'voice');
  assert.equal(mod.resolveTabTarget('/'), 'voice');
  assert.equal(mod.resolveTabTarget('/voice'), 'voice');
  assert.equal(mod.resolveTabTarget('#voiceover'), 'voice');
  assert.equal(mod.resolveTabTarget('/vo-hunter'), 'voice');
  assert.equal(mod.resolveTabTarget('/timing'), 'timing');
  assert.equal(mod.resolveTabTarget('/script-splitter'), 'timing');
  assert.equal(mod.resolveTabTarget('#script-splitter'), 'timing');
  assert.equal(mod.resolveTabTarget('/prompts'), 'prompts');
  assert.equal(mod.resolveTabTarget('/prompt'), 'prompts');
  assert.equal(mod.resolveTabTarget('/prompt-mapper'), 'prompts');
  assert.equal(mod.resolveTabTarget('/images'), 'images');
  assert.equal(mod.resolveTabTarget('/image'), 'images');
  assert.equal(mod.resolveTabTarget('/studio'), 'studio');
  assert.equal(mod.resolveTabTarget('/frame-hunter'), 'studio');
  assert.equal(mod.resolveTabTarget('#frame-hunter'), 'studio');
});

test('Express server redirects every old URL to its new SceneFlow URL and serves new routes', async () => {
  const app = require('../server.js');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const redirects = [
      ['/vo-hunter', '/voice'],
      ['/voiceover', '/voice'],
      ['/script-splitter', '/timing'],
      ['/script-hunter', '/timing'],
      ['/prompt', '/prompts'],
      ['/prompt-hunter', '/prompts'],
      ['/prompt-mapper', '/prompts'],
      ['/image', '/images'],
      ['/image-batch', '/images'],
      ['/frame-hunter', '/studio']
    ];

    for (const [oldUrl, expectedTarget] of redirects) {
      const res = await fetch(`${base}${oldUrl}`, { redirect: 'manual' });
      assert.equal(res.status, 301, `${oldUrl} should return 301`);
      assert.equal(res.headers.get('location'), expectedTarget, `${oldUrl} should redirect to ${expectedTarget}`);
    }

    for (const route of ['/', '/voice', '/timing', '/prompts', '/images', '/studio']) {
      const res = await fetch(`${base}${route}`, { redirect: 'manual' });
      assert.equal(res.status, 200, `${route} should serve HTTP 200`);
      const text = await res.text();
      assert.ok(text.includes('<title>SceneFlow'), `${route} should serve SceneFlow index.html`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
