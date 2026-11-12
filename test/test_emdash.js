const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const { execSync } = require('child_process');

const sampleDir = path.join(__dirname, 'sample_images');
const emDashFile = path.join(sampleDir, '0_00—0_03.png');
const hyphenFile = path.join(sampleDir, '0_00-0_03.png');

if (fs.existsSync(hyphenFile)) {
  fs.copyFileSync(hyphenFile, emDashFile);
  console.log('Copied to:', emDashFile, 'Exists:', fs.existsSync(emDashFile));
  try {
    const cmd = `"${ffmpeg}" -i "${emDashFile}" -f null -`;
    execSync(cmd, { stdio: 'pipe' });
    console.log('✅ FFmpeg read file with em dash successfully!');
  } catch (err) {
    console.error('❌ FFmpeg failed:', err.message);
  }
} else {
  console.log('Hyphen file not found at:', hyphenFile);
}
