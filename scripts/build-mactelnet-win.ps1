param(
  [string]$OutputDir = "",
  [switch]$StageToElectronBin
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $repoRoot "artifacts/mactelnet-win"
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) "knowhub-mactelnet-win-build"
$srcDir = Join-Path $workDir "src"
$distDir = Join-Path $workDir "dist"
$scriptPath = Join-Path $srcDir "mactelnet_windows.py"
$requirementsPath = Join-Path $srcDir "requirements.txt"
$specPath = Join-Path $srcDir "mactelnet.spec"

Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $srcDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$baseUrl = "https://raw.githubusercontent.com/petrunetworking/MAC-Telnet-Routeros/main"

Write-Host "Downloading Windows MAC-Telnet sources..."
Invoke-WebRequest "$baseUrl/mactelnet_windows.py" -OutFile $scriptPath
Invoke-WebRequest "$baseUrl/elliptic_curves.py" -OutFile (Join-Path $srcDir "elliptic_curves.py")
Invoke-WebRequest "$baseUrl/encryption.py" -OutFile (Join-Path $srcDir "encryption.py")

$script = Get-Content $scriptPath -Raw
$script = $script -replace "import keyboard`r?`n", ""
$script = $script -replace [regex]::Escape("            term_type = platform.system().encode()`r`n            term_size = os.get_terminal_size()`r`n            term_width = term_size[0].to_bytes(2, ""little"")`r`n            term_height = term_size[1].to_bytes(2, ""little"")`r`n"), @"
            term_type = b'dumb'
            try:
                term_size = os.get_terminal_size()
                width, height = term_size[0], term_size[1]
            except OSError:
                width, height = 120, 40
            term_width = width.to_bytes(2, "little")
            term_height = height.to_bytes(2, "little")
"@
$script = $script -replace [regex]::Escape("        elif packet.control_packets[0].packet_type == CP_END_AUTHENTICATION:`r`n            os.system('mode con: cols=150 lines=40')`r`n            os.system('cls')`r`n"), @"
        elif packet.control_packets[0].packet_type == CP_END_AUTHENTICATION:
            pass
"@
$script = $script -replace [regex]::Escape('                print("error: user not registered on server")'), '                print("Login failed, incorrect username or password", file=sys.stderr)'
$script = $script -replace "(?s)    def on_tab_press\(event\):.*?keyboard\.on_press\(on_tab_press\)`r?`n`r?`n", ""
$script = $script -replace [regex]::Escape("    print(args)`r`n"), ""
Set-Content -Path $scriptPath -Value $script -NoNewline

@"
ecdsa==0.19.0
pycryptodome==3.20.0
pyinstaller==6.11.1
"@ | Set-Content -Path $requirementsPath

@"
# -*- mode: python ; coding: utf-8 -*-

a = Analysis(["mactelnet_windows.py"], pathex=[], binaries=[], datas=[], hiddenimports=[], hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False, optimize=0)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="mactelnet", debug=False, bootloader_ignore_signals=False, strip=False, upx=False, console=True, disable_windowed_traceback=False, argv_emulation=False, target_arch=None, codesign_identity=None, entitlements_file=None)
"@ | Set-Content -Path $specPath

Write-Host "Creating venv..."
python -m venv (Join-Path $workDir ".venv")
$venvPython = Join-Path $workDir ".venv/Scripts/python.exe"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r $requirementsPath

Write-Host "Building mactelnet.exe..."
Push-Location $srcDir
try {
  & $venvPython -m PyInstaller --clean $specPath
} finally {
  Pop-Location
}

$builtExe = Join-Path $srcDir "dist/mactelnet.exe"
if (-not (Test-Path $builtExe)) {
  throw "Build failed: $builtExe not found"
}

$outputExe = Join-Path $OutputDir "mactelnet.exe"
Copy-Item -Force $builtExe $outputExe
Write-Host "Built: $outputExe"

if ($StageToElectronBin) {
  $stageDir = Join-Path $repoRoot "electron/bin/win32/x64"
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
  $stageExe = Join-Path $stageDir "mactelnet.exe"
  Copy-Item -Force $outputExe $stageExe
  Write-Host "Staged: $stageExe"
}
