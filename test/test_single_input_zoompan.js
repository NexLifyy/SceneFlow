const ffmpeg = require('../node_modules/ffmpeg-static');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const imgPath = path.resolve(__dirname, 'clean_bg.png');
const w = 1920, h = 1080, fps = 30, dur = 3;
const frames = dur * fps;

console.log('Testing single frame input with zoompan...');
const out = path.resolve(__dirname, 'single_frame_test.mp4');
const t0 = Date.now();

const res = spawnSync(ffmpeg, [
  '-y',
  '-i', imgPath, // NO -loop 1 !
  '-filter_complex', `[0:v]scale=8000:-2,zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1[v]`,
  '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  out
], { encoding: 'utf8' });

console.log(`Took ${Date.now() - t0}ms, status: ${res.status}, exists: ${fs.existsSync(out)}`);
if (res.status !== 0) console.error(res.stderr);
