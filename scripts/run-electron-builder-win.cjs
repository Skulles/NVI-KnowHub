const { spawnSync } = require('node:child_process')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const ensureScript = path.join(repoRoot, 'scripts', 'ensure-mactelnet-win.cjs')

const nodeExe = process.execPath
const builderBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')

const ensure = spawnSync(nodeExe, [ensureScript], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
})

if (ensure.status !== 0) {
  process.exit(ensure.status ?? 1)
}

const args = process.argv.slice(2)
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
}

console.log(`Starting electron-builder with args: ${args.join(' ') || '(none)'}`)

const result =
  process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${builderBin}" ${args.join(' ')}`], {
        cwd: repoRoot,
        stdio: 'inherit',
        env,
        windowsHide: false,
      })
    : spawnSync(builderBin, args, {
        cwd: repoRoot,
        stdio: 'inherit',
        env,
      })

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)
