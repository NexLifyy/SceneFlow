Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select Folder"
$dialog.ShowNewFolderButton = $true
$dialog.AutoUpgradeEnabled = $true
# Notice: ShowDialog() without any $form owner!
# Or with [System.Windows.Forms.Form]::ActiveForm or (New-Object System.Windows.Forms.NativeWindow)
Write-Output "Type loaded successfully"
