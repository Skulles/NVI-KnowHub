#!/usr/bin/env node
/**
 * Dev launcher: removes ELECTRON_RUN_AS_NODE from the environment before
 * starting electron-vite. This variable is set by Electron-based host tools
 * (e.g. Claude Code, VS Code) and causes Electron to run as plain Node.js,
 * breaking require('electron') in the main process.
 */
const { spawn } = require('child_process')
const path = require('path')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const bin = path.join(__dirname, '..', 'node_modules', '.bin')
// On Windows use cmd /c to run .cmd shims without shell:true on the actual spawn
const args = process.platform === 'win32'
  ? ['/c', path.join(bin, 'electron-vite.cmd'), 'dev']
  : [path.join(bin, 'electron-vite'), 'dev']

const cmd = process.platform === 'win32' ? 'cmd' : args.shift()

const proc = spawn(cmd, process.platform === 'win32' ? args : args, {
  stdio: 'inherit',
  env,
  shell: false
})

proc.on('close', (code) => process.exit(code ?? 0))
