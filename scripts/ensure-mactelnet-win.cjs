const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const archDir = process.arch === 'arm64' ? 'arm64' : 'x64'
const targetPath = path.join(repoRoot, 'electron', 'bin', 'win32', archDir, 'mactelnet.exe')

function verifyBinary(filePath) {
  const result = spawnSync(filePath, ['-h'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  return result.status === 0 || result.status === 1
}

if (process.platform === 'win32') {
  const scriptPath = path.join(repoRoot, 'scripts', 'build-mactelnet-win.ps1')
  const result = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-StageToElectronBin'],
    {
      stdio: 'inherit',
      windowsHide: false,
    },
  )

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  if (!fs.existsSync(targetPath) || !verifyBinary(targetPath)) {
    console.error(`Failed to prepare verified Windows MAC-Telnet binary: ${targetPath}`)
    process.exit(1)
  }

  console.log(`Prepared Windows MAC-Telnet binary: ${targetPath}`)
  process.exit(0)
}

if (fs.existsSync(targetPath)) {
  if (!verifyBinary(targetPath)) {
    console.error(`mactelnet.exe exists but failed verification: ${targetPath}`)
    process.exit(1)
  }
  console.log(`Using staged Windows MAC-Telnet binary: ${targetPath}`)
  process.exit(0)
}

console.error(
  [
    'Windows MAC-Telnet binary is missing.',
    `Expected: ${targetPath}`,
    'Run this build on Windows, or first provide a staged mactelnet.exe.',
    'You can also use the GitHub Actions workflow to build the Windows app with MAC-Telnet.',
  ].join('\n'),
)
process.exit(1)
