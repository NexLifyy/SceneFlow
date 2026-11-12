const { generateASS } = require('../src/captions.js');

const sampleWords = [
  { word: "You've", startSec: 0.0, endSec: 0.5, lineIndex: 0, lineStart: 0, lineEnd: 2.0, lineText: "You've been exhausted" },
  { word: "been", startSec: 0.5, endSec: 1.0, lineIndex: 0, lineStart: 0, lineEnd: 2.0, lineText: "You've been exhausted" },
  { word: "exhausted", startSec: 1.0, endSec: 2.0, lineIndex: 0, lineStart: 0, lineEnd: 2.0, lineText: "You've been exhausted" }
];

const exactStyles = [
  'pop', 'karaoke', 'hustle', 'grape', 'beast', 'soft-ai', 'gaming-stream',
  'poppin', 'poppin-clean', 'aarit', 'podcast', 'simple-one-word', 'pupcaps'
];

let allOk = true;
for (const s of exactStyles) {
  const ass = generateASS(sampleWords, { style: s });
  if (ass && ass.includes('Dialogue:')) {
    console.log(`[PASS] Exact theme: ${s}`);
  } else {
    console.error(`[FAIL] Exact theme: ${s}`);
    allOk = false;
  }
}

if (allOk) {
  console.log('\nAll 13 exact themes (including poppin-clean) pass!');
} else {
  process.exit(1);
}
