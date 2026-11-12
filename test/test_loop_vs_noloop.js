const ffmpeg = require('../node_modules/ffmpeg-static');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const uploads = fs.readdirSync('d:/Apps/video export/frame-maker/uploads');
const imgFile = uploads.find(f => f.startsWith('0_00') && f.endsWith('.png'));
const imgPath = path.join('d:/Apps/video export/frame-maker/uploads', imgFile);

const w = 1920, h = 1080, fps = 30, dur = 3;
const frames = dur * fps;

// Let's test Input B: -loop 1 -t 3 -i imgPath
const filter = `scale=7680:4320:force_original_aspect_ratio=increase,crop=7680:4320,zoompan=z='1.0+0.1*(on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1,setpts=PTS-STARTPTS,fps=${fps},trim=duration=${dur}`;

const outLoop = path.resolve(__dirname, 'test_with_loop.mp4');
const res = spawnSync(ffmpeg, [
  '-y',
  '-loop', '1', '-t', String(dur), '-i', imgPath,
  '-filter_complex', `[0:v]${filter}[v]`,
  '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  outLoop
], { encoding: 'utf8' });

console.log('test_with_loop created:', fs.existsSync(outLoop), 'status:', res.status);

// Now let's test WITHOUT -loop 1 on input:
// When input is single image without -loop, zoompan d=frames expands it to all 90 frames!
const outNoLoop = path.resolve(__dirname, 'test_no_loop.mp4');
const res2 = spawnSync(ffmpeg, [
  '-y',
  '-i', imgPath,
  '-filter_complex', `[0:v]${filter}[v]`,
  '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  outNoLoop
], { encoding: 'utf8' });

console.log('test_no_loop created:', fs.existsSync(outNoLoop), 'status:', res2.status);
