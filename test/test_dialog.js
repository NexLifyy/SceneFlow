const { exec } = require('child_process');

function pickFolder() {
  return new Promise((resolve) => {
    // PowerShell script to open TopMost native folder browser dialog
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.Opacity = 0
$form.Show()
$form.BringToFront()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select Destination Folder"
$dialog.ShowNewFolderButton = $true
$dialog.AutoUpgradeEnabled = $true
if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::WriteLine($dialog.SelectedPath)
}
$form.Dispose()
`.trim();

    // Encode to base64 UTF-16LE for -EncodedCommand
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    const cmd = `powershell -NoProfile -STA -EncodedCommand ${b64}`;

    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('PickFolder error:', err.message, stderr);
        resolve({ path: null });
      } else {
        const folderPath = stdout.trim();
        resolve({ path: folderPath || null });
      }
    });
  });
}

console.log('Testing EncodedCommand pickFolder...');
// We won't block, but let's test syntax and execution
const script = `Add-Type -AssemblyName System.Windows.Forms; [Console]::WriteLine('PowerShell STA OK')`;
const b64 = Buffer.from(script, 'utf16le').toString('base64');
exec(`powershell -NoProfile -STA -EncodedCommand ${b64}`, (err, stdout) => {
  console.log('Result:', stdout.trim());
});
