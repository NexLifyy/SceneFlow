/**
 * prompts_storage.test.js — Unit tests for Skill serialization, 5-skill limit logic, and API key isolation
 * Run with: node --test test/prompts_storage.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Replicate the pure functions from prompts_storage.js
const MAX_SKILLS = 5;

function maskApiKey(key) {
  if (!key) return '';
  const clean = key.trim();
  if (clean.length <= 8) return '••••••••';
  if (clean.startsWith('gsk_')) {
    const suffix = clean.slice(-4);
    return `gsk_••••••••${suffix}`;
  }
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}••••••${suffix}`;
}

function normalizeSkillFromAnyJSON(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON input for skill parsing');
  }

  const rawName =
    parsed.project?.title ||
    parsed.project?.name ||
    parsed.title ||
    parsed.name ||
    parsed.skill_name ||
    parsed.skillName ||
    parsed.style_name ||
    parsed.styleName ||
    parsed.style_bible?.title ||
    'Custom Visual Skill';
  const name = String(rawName).trim();

  let stylePrefix =
    parsed.style_bible?.style_prefix ||
    parsed.style_bible?.stylePrefix ||
    parsed.style_prefix ||
    parsed.stylePrefix ||
    parsed.prefix ||
    parsed.signature_phrase ||
    parsed.system_prompt ||
    parsed.prompt_prefix ||
    '';

  if (!stylePrefix && parsed.art_style_and_medium) {
    stylePrefix = parsed.art_style_and_medium;
  }
  if (!stylePrefix && parsed.style_bible?.art_style) {
    stylePrefix = parsed.style_bible.art_style;
  }
  if (!stylePrefix && typeof parsed.style === 'string') {
    stylePrefix = parsed.style;
  }
  stylePrefix = String(stylePrefix).trim();

  let styleGuide = '';
  if (typeof parsed.styleGuide === 'string' && parsed.styleGuide.trim()) {
    styleGuide = parsed.styleGuide.trim();
  } else if (typeof parsed.style_guide === 'string' && parsed.style_guide.trim()) {
    styleGuide = parsed.style_guide.trim();
  } else if (parsed.art_style_and_medium || parsed.character_design || parsed.rendering_details || parsed.negative_directives) {
    const parts = [];
    if (parsed.art_style_and_medium) {
      parts.push(`ART STYLE AND MEDIUM: ${parsed.art_style_and_medium}`);
    }
    if (parsed.character_design) {
      parts.push(`CHARACTER DESIGN: ${parsed.character_design}`);
    }
    if (parsed.rendering_details) {
      parts.push(`RENDERING DETAILS: ${parsed.rendering_details}`);
    }
    if (parsed.negative_directives) {
      parts.push(`NEGATIVE DIRECTIVES: ${parsed.negative_directives}`);
    }
    styleGuide = parts.join('\n');
  } else if (parsed.style_bible && typeof parsed.style_bible === 'object') {
    const sb = parsed.style_bible;
    const sections = [];
    if (sb.style_prefix || sb.art_style) {
      sections.push(`### 1. Art Style & Medium\n${sb.style_prefix || sb.art_style}`);
    }
    if (sb.character_description || sb.character) {
      sections.push(`### 2. Character Design & Recurring Figures\n${sb.character_description || sb.character}`);
    }
    if (sb.palette) {
      let palStr = '';
      if (typeof sb.palette === 'object' && !Array.isArray(sb.palette)) {
        palStr = Object.entries(sb.palette).map(([k, v]) => `- **${k}**: ${v}`).join('\n');
      } else if (Array.isArray(sb.palette)) {
        palStr = sb.palette.map(c => `- ${c}`).join('\n');
      } else {
        palStr = String(sb.palette);
      }
      sections.push(`### 3. Colour Palette\n${palStr}`);
    }
    if (sb.negative_prompt || parsed.negative_prompt || sb.avoid) {
      sections.push(`### 4. What to Avoid (Negative Directives)\n${sb.negative_prompt || parsed.negative_prompt || sb.avoid}`);
    }
    styleGuide = sections.join('\n\n');
  } else {
    const sections = [];
    for (const [key, val] of Object.entries(parsed)) {
      if (['id', 'thumbnails', 'apiKey', 'key', 'name', 'title', 'project'].includes(key)) continue;
      if (typeof val === 'string') {
        sections.push(`### ${key.replace(/_/g, ' ').toUpperCase()}\n${val}`);
      }
    }
    styleGuide = sections.join('\n\n');
  }

  const thumbnails = Array.isArray(parsed.thumbnails) ? parsed.thumbnails.slice(0, 5) : [];

  let extractedCaptions = '';
  if (Array.isArray(parsed.scenes) && parsed.scenes.length) {
    const lines = [];
    parsed.scenes.forEach(sc => {
      const timeStr = sc.start || sc.time || (sc.id !== undefined ? `0:${String((sc.id - 1) * 3).padStart(2, '0')}` : null);
      if (timeStr) {
        const cleanTime = timeStr.replace(/^[\(\[]/, '').replace(/[\)\]]$/, '');
        const text = sc.narration || sc.caption || sc.text || sc.setting || sc.emotion || '';
        lines.push(`(${cleanTime}) ${text}`.trim());
      }
    });
    extractedCaptions = lines.join('\n');
  }

  const skill = {
    id: parsed.id || `skill_test_${Date.now()}`,
    name,
    stylePrefix,
    styleGuide,
    thumbnails
  };
  delete skill.apiKey;
  delete skill.key;

  return { skill, extractedCaptions };
}

function exportSkillJSON(skill) {
  const copy = { ...skill };
  delete copy.apiKey;
  delete copy.key;
  return JSON.stringify(copy, null, 2);
}

function exportAllSkillsJSON(skills) {
  const cleanList = skills.map(s => {
    const c = { ...s };
    delete c.apiKey;
    delete c.key;
    return c;
  });
  const bundle = {
    version: '1.0',
    type: 'prompt_hunter_skills_backup',
    exportedAt: new Date().toISOString(),
    skills: cleanList
  };
  return JSON.stringify(bundle, null, 2);
}

function parseAndValidateSkillsImport(jsonStr, currentSkillsCount = 0) {
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Invalid JSON file format');
  }

  let rawList = [];
  let combinedCaptions = '';

  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && parsed.skills && Array.isArray(parsed.skills)) {
    rawList = parsed.skills;
  } else if (parsed && typeof parsed === 'object') {
    rawList = [parsed];
  } else {
    throw new Error('Unrecognized skill file format');
  }

  const availableSlots = MAX_SKILLS - currentSkillsCount;
  if (availableSlots <= 0) {
    throw new Error(`Already at maximum of ${MAX_SKILLS} skills. Delete an existing skill first.`);
  }

  const canTake = rawList.slice(0, availableSlots);
  const cleanSkills = [];

  for (const item of canTake) {
    const { skill, extractedCaptions } = normalizeSkillFromAnyJSON(item);
    if (extractedCaptions && !combinedCaptions) combinedCaptions = extractedCaptions;
    cleanSkills.push(skill);
  }

  return {
    importedCount: cleanSkills.length,
    skills: cleanSkills,
    skippedCount: rawList.length - cleanSkills.length,
    extractedCaptions: combinedCaptions
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('masks Groq and Gemini API keys securely', () => {
  assert.equal(maskApiKey('gsk_AbCdEf1234567890wxyz'), 'gsk_••••••••wxyz');
  assert.equal(maskApiKey('AIzaSyD-1234567890abcdef'), 'AIza••••••cdef');
  assert.equal(maskApiKey('short'), '••••••••');
  assert.equal(maskApiKey(''), '');
});

test('imports any Claude JSON with project, style_bible, and scenes', () => {
  const claudeJSON = JSON.stringify({
    project: {
      title: 'Relationship Conflict and Loneliness',
      total_duration_sec: 15,
      scene_duration_sec: 3,
      aspect_ratio: '16:9'
    },
    style_bible: {
      style_prefix: 'Hand-drawn doodle cartoon illustration, thick black wobbly outlines, flat colors with subtle marker texture, minimalist webcomic style, 16:9 widescreen, warm peach walls and wooden floor.',
      character_description: 'a round-headed white stickman with a big perfectly round bald head, dot eyes, thin black line arms, wearing a plain blue short-sleeve t-shirt, blue jeans and white sneakers',
      palette: {
        wall: '#F9B98A',
        floor: '#C47A4A',
        shirt: '#4A86D8'
      },
      negative_prompt: 'text, letters, words, speech bubbles, logos, watermark'
    },
    scenes: [
      { id: 1, start: '0:00', end: '0:03', narration: 'It is a random Tuesday.' },
      { id: 2, start: '0:03', end: '0:06', narration: 'Washing a cup under running tap.' }
    ]
  });

  const res = parseAndValidateSkillsImport(claudeJSON, 0);
  assert.equal(res.importedCount, 1);
  const importedSkill = res.skills[0];

  assert.equal(importedSkill.name, 'Relationship Conflict and Loneliness');
  assert.ok(importedSkill.stylePrefix.startsWith('Hand-drawn doodle cartoon illustration'));
  assert.ok(importedSkill.styleGuide.includes('#F9B98A'));
  assert.ok(importedSkill.styleGuide.includes('round-headed white stickman'));
  assert.ok(importedSkill.styleGuide.includes('What to Avoid'));
  assert.ok(res.extractedCaptions.includes('(0:00) It is a random Tuesday.'));
  assert.ok(res.extractedCaptions.includes('(0:03) Washing a cup under running tap.'));
});

test('never includes API key in skill JSON export', () => {
  const skill = {
    id: 'skill_1',
    name: 'Noir Style',
    stylePrefix: 'Noir stick figure.',
    styleGuide: 'High contrast.',
    thumbnails: ['data:image/jpeg;base64,...'],
    apiKey: 'AIzaSySECRETKEY_DO_NOT_LEAK',
    key: 'AIzaSySECRETKEY'
  };

  const exported = exportSkillJSON(skill);
  assert.equal(exported.includes('SECRETKEY'), false);
  const parsed = JSON.parse(exported);
  assert.equal(parsed.apiKey, undefined);
  assert.equal(parsed.key, undefined);
  assert.equal(parsed.name, 'Noir Style');
});

test('enforces max 5 skills limit on import', () => {
  // Test importing 6 skills when currently 0
  const sixSkills = [];
  for (let i = 1; i <= 6; i++) {
    sixSkills.push({
      name: `Skill ${i}`,
      stylePrefix: `Prefix ${i}`,
      styleGuide: `Guide ${i}`,
      thumbnails: [`thumb_${i}`]
    });
  }

  const jsonStr = exportAllSkillsJSON(sixSkills);
  assert.equal(jsonStr.includes('prompt_hunter_skills_backup'), true);

  // Import into empty store (current count = 0) — supports both legacy and new sceneflow_skills_backup format
  const res = parseAndValidateSkillsImport(jsonStr, 0);
  assert.equal(res.importedCount, 5); // Max 5 allowed
  assert.equal(res.skippedCount, 1);   // 6th was skipped
  assert.equal(res.skills.length, 5);

  const sceneFlowJsonStr = JSON.stringify({
    version: '1.0',
    type: 'sceneflow_skills_backup',
    skills: sixSkills
  });
  const resNew = parseAndValidateSkillsImport(sceneFlowJsonStr, 0);
  assert.equal(resNew.importedCount, 5);

  // Attempting to import when already at 5 skills is blocked
  assert.throws(() => {
    parseAndValidateSkillsImport(jsonStr, 5);
  }, /Already at maximum of 5 skills/);
});

test('exports all 5 skills and restores them intact from backup JSON', () => {
  const fiveSkills = [
    { name: 'Noir 1', stylePrefix: 'P1', styleGuide: 'G1', thumbnails: ['t1_1', 't1_2', 't1_3', 't1_4', 't1_5'] },
    { name: 'Anime 2', stylePrefix: 'P2', styleGuide: 'G2', thumbnails: ['t2_1', 't2_2'] },
    { name: 'Oil 3', stylePrefix: 'P3', styleGuide: 'G3', thumbnails: ['t3_1'] },
    { name: 'Pixel 4', stylePrefix: 'P4', styleGuide: 'G4', thumbnails: [] },
    { name: 'Cinema 5', stylePrefix: 'P5', styleGuide: 'G5', thumbnails: ['t5_1', 't5_2', 't5_3'] }
  ];

  const backupJson = exportAllSkillsJSON(fiveSkills);
  const restored = parseAndValidateSkillsImport(backupJson, 0);

  assert.equal(restored.importedCount, 5);
  assert.equal(restored.skippedCount, 0);
  assert.equal(restored.skills[0].name, 'Noir 1');
  assert.equal(restored.skills[0].thumbnails.length, 5);
  assert.equal(restored.skills[4].name, 'Cinema 5');
  assert.equal(restored.skills[4].thumbnails.length, 3);
});

test('imports images.json with art_style_and_medium, character_design, rendering_details, negative_directives', () => {
  const imagesJson = JSON.stringify({
    art_style_and_medium: "Hand-drawn 2D digital doodle cartoon with clean, slightly wobbly ink outlines, flat soft color fills with subtle marker-like texture and gentle shading, giving a friendly, minimalist webcomic look.",
    character_design: "A simple round-headed stickman with a large plain white ball head, small dot eyes and a tiny mouth, thin limbs, a plain short-sleeved blue t-shirt, blue jeans and white sneakers.",
    rendering_details: "Medium-thick black outlines on the character and slightly lighter outlines on the surroundings, soft minimal shading, simple uncluttered backgrounds with warm or calm tones, a quiet relatable mood, and emotions conveyed through eyebrows, eyelids, mouth shape, posture and small symbolic doodles rather than text.",
    negative_directives: "text, letters, speech bubbles, logos, watermarks, photorealism, 3D rendering, realistic proportions, detailed hair, extra characters with faces unlike the style, cluttered backgrounds, heavy gradients, glossy effects, anime style, blurry lines"
  });

  const parsed = JSON.parse(imagesJson);
  const result = normalizeSkillFromAnyJSON(parsed);
  assert.equal(result.skill.name, 'Custom Visual Skill');
  assert.ok(result.skill.stylePrefix.startsWith('Hand-drawn 2D digital doodle'));
  assert.ok(result.skill.styleGuide.includes('ART STYLE AND MEDIUM: Hand-drawn 2D'));
  assert.ok(result.skill.styleGuide.includes('CHARACTER DESIGN: A simple round-headed'));
  assert.ok(result.skill.styleGuide.includes('RENDERING DETAILS: Medium-thick black outlines'));
  assert.ok(result.skill.styleGuide.includes('NEGATIVE DIRECTIVES: text, letters'));
});
