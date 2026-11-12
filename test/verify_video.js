// Verify rendered video duration and frame timestamps via ffprobe
const { execSync } = require('child_process');
const ffprobe = require('ffprobe-static').path;
const path = require('path');

const videoPath = path.join(__dirname, 'render_output', 'render_test.mp4');

try {
  const out = execSync(
    `"${ffprobe}" -v quiet -print_format json -show_format -show_streams "${videoPath}"`,
    { encoding: 'utf8' }
  );
  const info = JSON.parse(out);
  const duration = parseFloat(info.format.duration);
  const videoStream = info.streams.find(s => s.codec_type === 'video');

  console.log('=== Video Verification ===');
  console.log('Duration:', duration.toFixed(3), 's  (expected: 15s for 5 clips x 3s)');
  console.log('Resolution:', videoStream.width + 'x' + videoStream.height);
  console.log('Codec:', videoStream.codec_name);
  console.log('FPS:', videoStream.r_frame_rate);
  console.log('Pixel format:', videoStream.pix_fmt);

  // Check duration matches expected (5 clips × 3s = 15s)
  const EXPECTED = 15;
  if (Math.abs(duration - EXPECTED) < 0.5) {
    console.log('\n✅ Duration matches expected (15s)');
  } else {
    console.log('\n❌ Duration mismatch: expected', EXPECTED, 'got', duration);
  }

  if (videoStream.pix_fmt === 'yuv420p') {
    console.log('✅ Pixel format is yuv420p');
  } else {
    console.log('❌ Pixel format:', videoStream.pix_fmt);
  }

  if (info.format.tags && info.format.tags['encoder']) {
    console.log('Encoder tag:', info.format.tags['encoder']);
  }
} catch (e) {
  console.error('ffprobe failed:', e.message);
}
