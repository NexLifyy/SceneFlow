const ffmpeg = require('../node_modules/ffmpeg-static');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const uploads = fs.readdirSync('d:/Apps/video export/frame-maker/uploads');
const imgFile = uploads.find(f => f.startsWith('0_00') && f.endsWith('.png'));
const imgPath = path.join('d:/Apps/video export/frame-maker/uploads', imgFile);

console.log('Testing with real user image:', imgPath);

const w = 1920, h = 1080, fps = 30, dur = 3;
const frames = dur * fps;

console.log('1. Rendering with CURRENT 2x Scale...');
const outOld = path.resolve(__dirname, 'user_old_zoom.mp4');
const currentZoomIn = `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=decrease,pad=${w * 2}:${h * 2}:(ow-iw)/2:(oh-ih)/2:black,zoompan=z='min(zoom+${(0.08/frames).toFixed(6)},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1,setpts=PTS-STARTPTS,fps=${fps},trim=duration=${dur}`;

const t0 = Date.now();
const res0 = spawnSync(ffmpeg, [
  '-y',
  '-loop', '1', '-t', String(dur), '-i', imgPath,
  '-filter_complex', `[0:v]${currentZoomIn}[v]`,
  '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
  outOld
]);
console.log(`Current took ${Date.now() - t0}ms, file:`, fs.existsSync(outOld), 'status:', res0.status);
if (res0.status !== 0) console.error(res0.stderr);

console.log('2. Rendering with 8000px High-Precision Scale...');
const outNew = path.resolve(__dirname, 'user_new_zoom.mp4');
const newZoomIn = `scale=8000:-2,zoompan=z='min(zoom+${(0.08/frames).toFixed(6)},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`;

const t1 = Date.now();
const res1 = spawnSync(ffmpeg, [
  '-y',
  '-loop', '1', '-i', imgPath,
  '-vf', newZoomIn,
  '-t', String(dur),
  '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
  outNew
]);
console.log(`New took ${Date.now() - t1}ms, file:`, fs.existsSync(outNew), 'status:', res1.status);
if (res1.status !== 0) console.error(res1.stderr);
