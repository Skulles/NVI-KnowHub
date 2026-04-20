param(
  [string]$OutputDir = "",
  [switch]$StageToElectronBin
)

$ErrorActionPreference = 'Stop'

function Convert-ToMsysPath([string]$winPath) {
  $p = $winPath.TrimEnd('\') -replace '\\', '/'
  if ($p -match '^([A-Za-z]):(/.*)?$') {
    $drive = $Matches[1].ToLower()
    $rest = if ($Matches[2]) { $Matches[2] } else { '' }
    return "/$drive$rest"
  }
  return $p
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $repoRoot "artifacts/mactelnet-c-win"
}

$msysBash = $env:MSYS2_BASH
if ([string]::IsNullOrWhiteSpace($msysBash)) {
  $candidates = @(
    "C:\msys64\usr\bin\bash.exe",
    "C:\tools\msys64\usr\bin\bash.exe",
    "${env:ProgramFiles}\msys64\usr\bin\bash.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      $msysBash = $c
      break
    }
  }
}

if (-not (Test-Path $msysBash)) {
  throw @"
MSYS2 bash not found. Install MSYS2 from https://www.msys2.org/ and either:
  - set env MSYS2_BASH to full path of usr\bin\bash.exe, or
  - install to C:\msys64

In MSYS2 UCRT64 shell install toolchain:
  pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain autoconf automake libtool pkgconf

Then re-run this script from PowerShell.
"@
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) "knowhub-mactelnet-c-build"
$srcDir = Join-Path $workDir "MAC-Telnet"
Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

Write-Host "Cloning haakonnessjoen/MAC-Telnet..."
git clone --depth 1 https://github.com/haakonnessjoen/MAC-Telnet.git $srcDir

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$msysSrc = Convert-ToMsysPath $srcDir
Write-Host "Building with MSYS2 (this may take a few minutes)..."
$inner = @"
set -e
cd '$msysSrc'
./autogen.sh
./configure
make -j4
"@
& $msysBash -lc $inner
if ($LASTEXITCODE -ne 0) {
  throw "MSYS2 build failed. Install autotools and mingw-w64 toolchain (see script header)."
}

$builtExe = Join-Path $srcDir "src\mactelnet.exe"
if (-not (Test-Path $builtExe)) {
  $alt = Get-ChildItem -Path $srcDir -Recurse -Filter "mactelnet.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($alt) { $builtExe = $alt.FullName }
}
if (-not (Test-Path $builtExe)) {
  throw "Build failed: mactelnet.exe not found under $srcDir"
}

$outputExe = Join-Path $OutputDir "mactelnet.exe"
Copy-Item -Force $builtExe $outputExe
Write-Host "Built: $outputExe"

if ($StageToElectronBin) {
  $stageDir = Join-Path $repoRoot "electron/bin/win32/x64"
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
  $stageExe = Join-Path $stageDir "mactelnet.exe"
  Copy-Item -Force $outputExe $stageExe
  Write-Host "Staged: $stageExe (haakonnessjoen MAC-Telnet, CLI: -A -u -p -t ...)"
}
