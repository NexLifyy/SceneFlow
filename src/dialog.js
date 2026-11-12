const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXE_PATH = path.join(__dirname, '..', 'bin', 'folderpicker.exe');

/**
 * Open a native Windows folder browser dialog in the foreground.
 * Uses native compiled helper folderpicker.exe (instant, modern Windows Explorer UI).
 * Falls back to PowerShell STA if binary is missing or encounters an error.
 */
function pickFolder() {
  return new Promise((resolve) => {
    if (fs.existsSync(EXE_PATH)) {
      execFile(EXE_PATH, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err && !err.killed) {
          console.warn('folderpicker.exe returned error, running PowerShell fallback:', err.message);
          return fallbackPowerShell(resolve);
        }
        const folderPath = (stdout || '').trim();
        resolve({ path: folderPath || null });
      });
      return;
    }

    fallbackPowerShell(resolve);
  });
}

function fallbackPowerShell(resolve) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select Destination Folder"
$dialog.ShowNewFolderButton = $true
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
if ($dialog.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::WriteLine($dialog.SelectedPath)
}
$top.Dispose()
`.trim();

  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  exec(`powershell -NoProfile -STA -EncodedCommand ${b64}`, { timeout: 60000 }, (err, stdout) => {
    if (err) {
      resolve({ path: null });
    } else {
      const folderPath = (stdout || '').trim();
      resolve({ path: folderPath || null });
    }
  });
}

module.exports = { pickFolder };
