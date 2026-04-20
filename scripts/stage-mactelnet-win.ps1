$ErrorActionPreference = 'Stop'

param(
  [Parameter(Mandatory = $true)]
  [string]$BinaryPath,

  [string]$Arch = "x64"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedSource = Resolve-Path $BinaryPath
$targetDir = Join-Path $repoRoot "electron/bin/win32/$Arch"
$targetPath = Join-Path $targetDir "mactelnet.exe"

if (-not (Test-Path $resolvedSource)) {
  throw "Файл не найден: $BinaryPath"
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -Force $resolvedSource $targetPath

Write-Host "Проверяю $targetPath ..."
& $targetPath -h | Out-Null

if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
  throw "mactelnet.exe запустился с неожиданным кодом $LASTEXITCODE"
}

Write-Host "Готово: $targetPath"
Write-Host "Теперь можно собирать Windows-приложение:"
Write-Host "  npm run electron:build:win"
