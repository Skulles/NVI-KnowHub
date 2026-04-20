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

if (fs.existsSync(targetPath) && verifyBinary(targetPath)) {
  console.log(`Using staged Windows MAC-Telnet binary: ${targetPath}`)
  process.exit(0)
}

if (process.platform !== 'win32') {
  console.error(
    [
      'Windows MAC-Telnet binary is missing or invalid.',
      `Expected: ${targetPath}`,
      'Build on Windows with MSYS2: npm run mactelnet:build:win',
    ].join('\n'),
  )
  process.exit(1)
}

const scriptPath = path.join(repoRoot, 'scripts', 'build-mactelnet-c-win.ps1')
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
