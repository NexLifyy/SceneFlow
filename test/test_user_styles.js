'use strict';
const { generateASS, parseCaptionText, spreadWords } = require('../src/captions');

const raw = "(0:00) You have been exhausted all day and yet your mind switches on like a stadium light";
const lines = parseCaptionText(raw);
const words = spreadWords(lines);

const styles = [
  'none',
  'bold',
  'beast',
  'hustle',
  'pupcaps',
  'bold-highlight',
  'podcast',
  'aarit',
  'simple-one-word',
  'gaming-stream'
];

const wordSettings = ['1', '2', '3', '3-4', '4', '5', '6', 'all'];

for (const st of styles) {
  for (const ws of wordSettings) {
    const ass = generateASS(words, { style: st, wordsPerLine: ws });
    if (st === 'none') {
      if (ass !== null) throw new Error(`Style none should return null, got ${ass}`);
    } else {
      if (!ass || !ass.includes('Dialogue:')) throw new Error(`Style ${st} with wordsPerLine ${ws} failed ASS generation`);
    }
  }
}

console.log('SUCCESS: All 10 user caption styles and all wordsPerLine settings passed verification!');
