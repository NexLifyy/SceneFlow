const { render } = require('../src/renderer');
const path = require('path');
const fs = require('fs');

const uploads = fs.readdirSync('d:/Apps/video export/frame-maker/uploads');
const imgFile = uploads.find(f => f.startsWith('0_00') && f.endsWith('.png'));
const imgPath = path.join('d:/Apps/video export/frame-maker/uploads', imgFile);

async function testFullRender() {
  const outPath = path.resolve(__dirname, 'render_output/test_smooth_render.mp4');
  console.log('Testing render with auto motion...');
  const res = await render({
    clips: [
      { name: imgFile, path: imgPath, durationSec: 3.0, type: 'image', motion: 'auto' },
    ],
    videoSize: '1080p',
    fps: 30,
    encoder: 'libx264',
    crf: 18,
    fitMode: 'fill',
    outputPath: outPath,
    tempDir: path.resolve(__dirname, '../temp')
  }, (progress) => {
    console.log(`Progress: ${progress.stage} - ${progress.pct}% (${progress.details || ''})`);
  });

  console.log('Render finished! File size:', res.fileSize, 'path:', res.outputPath);
}

testFullRender().catch(err => {
  console.error('Render failed:', err);
  process.exit(1);
});
