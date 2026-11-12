/**
 * generate_test_images.js — Creates 20 labeled PNG test images for render testing.
 * Uses Node.js Canvas via a small script that uses ffmpeg to draw text onto colored images.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ffmpeg = require('ffmpeg-static');

const OUTPUT_DIR = path.join(__dirname, '..', 'test', 'sample_images');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 20 clips with 3-second intervals
const clips = [];
for (let i = 0; i < 20; i++) {
  const startSec = i * 3;
  const endSec = startSec + 3;
  const startMin = Math.floor(startSec / 60);
  const startS = startSec % 60;
  const endMin = Math.floor(endSec / 60);
  const endS = endSec % 60;
  const filename = `${startMin}_${String(startS).padStart(2,'0')}-${endMin}_${String(endS).padStart(2,'0')}.png`;
  clips.push({ filename, startSec, endSec, label: `Clip ${i+1}: ${startMin}:${String(startS).padStart(2,'0')} - ${endMin}:${String(endS).padStart(2,'0')}` });
}

// Colors for variety
const colors = ['#1a237e','#4a148c','#880e4f','#b71c1c','#e65100','#33691e','#006064','#01579b','#37474f','#263238'];

console.log('Generating test images...');
for (let i = 0; i < clips.length; i++) {
  const clip = clips[i];
  const color = colors[i % colors.length];
  const outPath = path.join(OUTPUT_DIR, clip.filename);

  // Use ffmpeg to generate a solid-color image with text
  const cmd = [
    `"${ffmpeg}"`,
    `-y`,
    `-f lavfi`,
    `-i color=c=${color.replace('#','')}:s=1280x720:r=1:d=0.1`,
    `-vf "drawtext=fontfile=/Windows/Fonts/arial.ttf:text='${clip.label}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2"`,
    `-frames:v 1`,
    `"${outPath}"`,
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'pipe' });
    process.stdout.write('.');
  } catch (e) {
    // Try without fontfile (some systems don't have it at that path)
    const cmd2 = [
      `"${ffmpeg}"`,
      `-y`,
      `-f lavfi`,
      `-i color=c=${color.replace('#','')}:s=1280x720:r=1:d=0.1`,
      `-frames:v 1`,
      `"${outPath}"`,
    ].join(' ');
    try {
      execSync(cmd2, { stdio: 'pipe' });
      process.stdout.write('.');
    } catch (e2) {
      console.error('\nFailed to create', clip.filename, e2.message.slice(0, 100));
    }
  }
}

console.log('\nDone! Images saved to:', OUTPUT_DIR);
console.log('Files:');
fs.readdirSync(OUTPUT_DIR).forEach(f => console.log(' ', f));
