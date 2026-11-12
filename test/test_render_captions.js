const ffmpeg = require('ffmpeg-static');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { generateASS, parseCaptionText, spreadWords } = require('../src/captions');

const raw = "(0:00) It's a random Tuesday.";
const lines = parseCaptionText(raw);
const words = spreadWords(lines);

// User in screenshot set size = 40, and position y = 78 (about 22% from bottom)
const assContent = generateASS(words, {
  style: 'bold',
  color: '#FFFFFF',
  size: 40,
  position: { x: 50, y: 78 },
  videoWidth: 1920,
  videoHeight: 1080,
  wordsPerLine: '3-4',
});

console.log('--- GENERATED ASS ---');
console.log(assContent);

const assPath = path.join(__dirname, 'test_output.ass');
fs.writeFileSync(assPath, assContent, 'utf8');

const fontsDir = path.join(__dirname, '..', 'fonts').replace(/\\/g, '/').replace(/:/g, '\\:');
const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
const vfWithFonts = `subtitles='${assEscaped}':fontsdir='${fontsDir}'`;

// Render 1 frame into a PNG image using the character background from user's folder!
const sampleImg = 'd:/Apps/video export/frame-maker/test/render_output/sample_frame.png';

// Let's test on black background and save to test/preview_frame.png
const outImg = path.join(__dirname, 'test_rendered_frame.png');
const res = spawnSync(ffmpeg, [
  '-y',
  '-f', 'lavfi', '-i', 'color=c=#d98b58:s=1920x1080:r=1',
  '-t', '1',
  '-vf', vfWithFonts,
  '-frames:v', '1',
  outImg
], { encoding: 'utf8' });

console.log('Frame created at:', outImg, 'exists:', fs.existsSync(outImg));
if (!fs.existsSync(outImg)) {
  console.error(res.stderr);
}
