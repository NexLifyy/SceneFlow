const ffmpeg = require('../node_modules/ffmpeg-static');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const imgPath = path.resolve(__dirname, 'clean_bg.png');
const w = 1920, h = 1080, fps = 30, dur = 3;
const frames = dur * fps;

// Let's test:
// Candidate 1: scale=8000:-2 with zoompan
const filter8k = `scale=8000:-2,zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`;

console.log('Testing 8K zoompan...');
const t0 = Date.now();
const out8k = path.resolve(__dirname, 'smooth_8k.mp4');
const res8k = spawnSync(ffmpeg, [
  '-y',
  '-loop', '1', '-i', imgPath,
  '-vf', filter8k,
  '-t', String(dur),
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  out8k
], { encoding: 'utf8' });

console.log(`8K took ${Date.now() - t0}ms, status: ${res8k.status}`);
if (res8k.status !== 0) console.error(res8k.stderr);
