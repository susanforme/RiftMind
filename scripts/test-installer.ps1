param([string]$Makensis)
$ErrorActionPreference = 'Stop'
if (-not $Makensis) {
  $candidate = Get-ChildItem "$env:LOCALAPPDATA\tauri" -Filter makensis.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $candidate) { throw 'NSIS compiler not found. Build the Tauri NSIS installer first or pass -Makensis.' }
  $Makensis = $candidate.FullName
}
$root = Join-Path ([IO.Path]::GetTempPath()) ("riftmind-install-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
$output = Join-Path $root 'directory-test.exe'
try {
  & $Makensis '/WX' "/DOUTPUT=$output" (Join-Path $PSScriptRoot '../tests/installer/directory.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'Installer hook compilation failed.' }
  function Invoke-DirectoryTest([string]$path, [bool]$success) {
    $process = Start-Process -FilePath $output -ArgumentList @('/S', "/D=$path") -Wait -PassThru
    if (($process.ExitCode -eq 0) -ne $success) { throw "Unexpected result for $path : $($process.ExitCode)" }
  }
  $empty = Join-Path $root 'dedicated empty directory'
  Invoke-DirectoryTest $empty $true
  if (-not (Test-Path "$empty/assets" -PathType Container)) { throw 'Missing writable assets directory.' }
  Set-Content "$empty/assets/keep.png" 'keep'
  Invoke-DirectoryTest $empty $true
  if ((Get-Content "$empty/assets/keep.png") -ne 'keep') { throw 'Upgrade removed existing assets.' }

  $foreign = Join-Path $root 'unrelated'
  New-Item -ItemType Directory -Path $foreign | Out-Null
  Set-Content "$foreign/important.txt" 'keep'
  Invoke-DirectoryTest $foreign $false
  if ((Get-Content "$foreign/important.txt") -ne 'keep') { throw 'Changed unrelated files.' }
  Set-Content "$empty/foreign.txt" 'keep'
  Invoke-DirectoryTest $empty $false
  Invoke-DirectoryTest $env:LOCALAPPDATA $false
  Invoke-DirectoryTest (Join-Path $env:ProgramFiles 'RiftMind-test-do-not-create') $false

  $blocked = Join-Path $root 'blocked-assets'
  New-Item -ItemType Directory -Path $blocked | Out-Null
  [IO.File]::WriteAllText("$blocked/.riftmind-install", 'com.springbreeze.riftmind')
  Set-Content "$blocked/assets" 'file'
  Invoke-DirectoryTest $blocked $false
  if ((Get-Content "$blocked/assets") -ne 'file') { throw 'Overwrote an existing file.' }

  $readonly = Join-Path $root 'readonly-assets'
  New-Item -ItemType Directory -Path "$readonly/assets" | Out-Null
  [IO.File]::WriteAllText("$readonly/.riftmind-install", 'com.springbreeze.riftmind')
  $acl = Get-Acl "$readonly/assets"
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    [Security.AccessControl.FileSystemRights]::Write,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Deny
  )
  $acl.AddAccessRule($rule)
  Set-Acl "$readonly/assets" $acl
  try { Invoke-DirectoryTest $readonly $false }
  finally { $acl.RemoveAccessRuleSpecific($rule); Set-Acl "$readonly/assets" $acl }

  $linked = Join-Path $root 'linked-assets'
  $outside = Join-Path $root 'outside'
  New-Item -ItemType Directory -Path $linked, $outside | Out-Null
  [IO.File]::WriteAllText("$linked/.riftmind-install", 'com.springbreeze.riftmind')
  New-Item -ItemType Junction -Path "$linked/assets" -Target $outside | Out-Null
  try { Invoke-DirectoryTest $linked $false }
  finally { [IO.Directory]::Delete("$linked/assets") }
  if (@(Get-ChildItem $outside -Force).Count -ne 0) { throw 'Wrote through a junction.' }
  Write-Host 'Installer directory checks passed: empty folder, upgrade reuse, unrelated files, protected paths, blocked/read-only assets and junctions.'
} finally {
  Remove-Item $root -Recurse -Force
}
