const ffmpeg = require('../node_modules/ffmpeg-static');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { generateASS, parseCaptionText, spreadWords } = require('../src/captions');

const raw = "(0:00) It's a random Tuesday.\n(0:03) Ordinary, washing a cup.";
const lines = parseCaptionText(raw);
const words = spreadWords(lines);

const stylesToTest = [
  'bold',
  'beast',
  'hustle',
  'pupcaps',
  'bold-highlight',
  'podcast',
  'aarit',
  'simple-one-word',
  'gaming-stream',
];

const fontsDir = path.resolve(__dirname, '..', 'fonts').replace(/\\/g, '/').replace(/:/g, '\\:');
const outDir = path.resolve(__dirname, 'style_test_output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let allPassed = true;

for (const style of stylesToTest) {
  const ass = generateASS(words, {
    style,
    color: '#FFFFFF',
    size: 48,
    position: { x: 50, y: 80 },
    wordsPerLine: '3-4'
  });

  if (!ass) {
    console.error(`FAIL: generateASS returned null for ${style}`);
    allPassed = false;
    continue;
  }

  const assFile = path.join(outDir, `${style}.ass`);
  fs.writeFileSync(assFile, ass, 'utf8');

  const assEscaped = assFile.replace(/\\/g, '/').replace(/:/g, '\\:');
  const outPng = path.join(outDir, `${style}_frame.png`);

  const res = spawnSync(ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30',
    '-ss', '0.5',
    '-vf', `subtitles='${assEscaped}':fontsdir='${fontsDir}'`,
    '-frames:v', '1',
    outPng
  ], { encoding: 'utf8' });

  const exists = fs.existsSync(outPng);
  console.log(`Style [${style}]: ffmpeg code=${res.status}, PNG created=${exists}`);
  if (!exists) {
    console.error(`Error for ${style}:\n`, res.stderr);
    allPassed = false;
  }
}

console.log(`\nAll 10 styles tested: ${allPassed ? 'ALL PASSED!' : 'SOME FAILED'}`);
process.exit(allPassed ? 0 : 1);
