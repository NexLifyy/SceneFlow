'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER_URL = 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe';
const INSTALLER_PATH = path.join(PROJECT_ROOT, 'temp_python_installer.exe');
const LOCAL_PYTHON_PATH = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\THE HAIDER\\AppData\\Local', 'Programs', 'Python', 'Python310', 'python.exe');

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading Python 3.10 installer from ${url}...`);
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      let receivedBytes = 0;
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0 && Math.random() < 0.05) {
          const mb = (receivedBytes / (1024 * 1024)).toFixed(1);
          const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
          process.stdout.write(`\rDownloading: ${mb} / ${totalMb} MB (${Math.round(receivedBytes / totalBytes * 100)}%)`);
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          console.log('\nDownload complete.');
          resolve();
        });
      });
    }).on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, { stdio: 'inherit', ...options });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function main() {
  let pyExe = null;

  // Check if Python 3.10 is already in LocalAppData
  if (fs.existsSync(LOCAL_PYTHON_PATH)) {
    console.log(`Found existing Python at: ${LOCAL_PYTHON_PATH}`);
    pyExe = LOCAL_PYTHON_PATH;
  } else {
    // Download and install
    await downloadFile(INSTALLER_URL, INSTALLER_PATH);
    console.log('Installing Python 3.10 silently (user level, no admin required)...');
    try {
      await runCommand(INSTALLER_PATH, [
        '/quiet',
        'InstallAllUsers=0',
        'InstallLauncherAllUsers=0',
        'Include_launcher=0',
        'PrependPath=1',
        'Include_pip=1',
        'Include_test=0',
        'Include_doc=0'
      ]);
    } finally {
      try { fs.unlinkSync(INSTALLER_PATH); } catch {}
    }

    if (fs.existsSync(LOCAL_PYTHON_PATH)) {
      pyExe = LOCAL_PYTHON_PATH;
    } else {
      try {
        const out = execSync('where python').toString().trim().split('\r\n')[0];
        if (out && fs.existsSync(out)) pyExe = out;
      } catch {}
    }
  }

  if (!pyExe) {
    throw new Error('Could not locate installed python.exe');
  }

  console.log(`Python is available at: ${pyExe}`);

  // Create virtual environment in frame-maker/.venv
  const venvDir = path.join(PROJECT_ROOT, '.venv');
  const venvPy = path.join(venvDir, 'Scripts', 'python.exe');
  const venvPip = path.join(venvDir, 'Scripts', 'pip.exe');

  if (!fs.existsSync(venvPy)) {
    console.log('Creating virtual environment in .venv...');
    await runCommand(pyExe, ['-m', 'venv', venvDir]);
  }

  const targetPy = fs.existsSync(venvPy) ? venvPy : pyExe;
  const targetPip = fs.existsSync(venvPip) ? venvPip : (fs.existsSync(path.join(path.dirname(pyExe), 'Scripts', 'pip.exe')) ? path.join(path.dirname(pyExe), 'Scripts', 'pip.exe') : 'pip');

  console.log('Installing faster-whisper and requirements...');
  const reqPath = path.join(PROJECT_ROOT, 'python', 'requirements.txt');
  await runCommand(targetPy, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  await runCommand(targetPy, ['-m', 'pip', 'install', '-r', reqPath]);

  // Ensure modern MSVC runtime DLLs are present for ctranslate2 on Windows
  try {
    const edgeDir = 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\157.0.4341.42';
    const ct2Dir = path.join(PROJECT_ROOT, '.venv', 'Lib', 'site-packages', 'ctranslate2');
    const scriptsDir = path.join(PROJECT_ROOT, '.venv', 'Scripts');
    const dlls = ['concrt140.dll', 'msvcp140.dll', 'msvcp140_codecvt_ids.dll', 'vccorlib140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
    for (const d of [ct2Dir, scriptsDir]) {
      if (!fs.existsSync(d)) continue;
      for (const dll of dlls) {
        const src = path.join(edgeDir, dll);
        const dst = path.join(d, dll);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
        }
      }
    }
  } catch {}

  console.log('Testing faster-whisper import...');
  execSync(`"${targetPy}" -c "import faster_whisper; print('faster-whisper is successfully installed!')"`, { stdio: 'inherit' });

  console.log('\n=============================================');
  console.log('Whisper transcription setup completed successfully!');
  console.log('=============================================');
}

main().catch((err) => {
  console.error('\nSetup error:', err.message);
  process.exit(1);
});
