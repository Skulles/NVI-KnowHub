const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

function resolvePathLookup(executableName) {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(lookupCommand, [executableName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return null
  const candidate = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return candidate || null
}

function buildBundledBinaryCandidates() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const exe = `mactelnet${ext}`
  const appRoot = path.resolve(__dirname, '..')

  return [
    path.join(process.resourcesPath || '', 'bin', process.platform, process.arch, exe),
    path.join(process.resourcesPath || '', 'bin', exe),
    path.join(process.resourcesPath || '', exe),
    path.join(appRoot, 'electron', 'bin', process.platform, process.arch, exe),
    path.join(appRoot, 'electron', 'bin', exe),
  ].filter(Boolean)
}

function resolveMacTelnetBinary() {
  const envPath = process.env.NVI_MACTELNET_PATH?.trim()
  if (envPath) {
    return { command: envPath, source: 'env' }
  }

  for (const candidate of buildBundledBinaryCandidates()) {
    if (candidate && fs.existsSync(candidate)) {
      return { command: candidate, source: 'bundled' }
    }
  }

  const executableName = process.platform === 'win32' ? 'mactelnet.exe' : 'mactelnet'
  const lookup = resolvePathLookup(executableName)
  if (lookup) {
    return { command: lookup, source: 'path' }
  }

  return null
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function summarizeOutput(output) {
  const cleaned = stripAnsi(output)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (cleaned.length === 0) return null
  return cleaned.slice(-4).join(' | ')
}

function buildMissingBinaryMessage() {
  const winArchDir = process.arch === 'arm64' ? 'arm64' : 'x64'
  const installHint =
    process.platform === 'win32'
      ? `Соберите нативный клиент (haakonnessjoen) в \`electron/bin/win32/${winArchDir}/mactelnet.exe\` или задайте \`NVI_MACTELNET_PATH\`.`
      : 'Положите `mactelnet` в `electron/bin/<platform>/<arch>/`, установите его в PATH или задайте `NVI_MACTELNET_PATH`.'
  return `Не найден исполняемый файл MAC-Telnet. ${installHint}`
}

const AUTH_READY_MARKER = '__KNOWHUB_AUTH_OK__'
const AUTH_TIMEOUT_MS = 45000

function killChildProcess(child) {
  if (!child) return
  try {
    child.stdin?.destroy()
  } catch {
    /* ignore */
  }
  try {
    child.stdout?.destroy()
  } catch {
    /* ignore */
  }
  try {
    child.stderr?.destroy()
  } catch {
    /* ignore */
  }
  try {
    child.kill('SIGKILL')
  } catch {
    /* ignore */
  }
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      /* ignore */
    }
  }
}

function createMacTelnetSession(options) {
  const dstMac = String(options.dstMac ?? '').trim()
  const username = String(options.username ?? 'admin')
  const password = String(options.password ?? '')
  const onOutput = typeof options.onOutput === 'function' ? options.onOutput : () => {}
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {}

  const state = {
    phase: 'idle',
    child: null,
    closed: false,
    connected: false,
    stdoutBuffer: '',
    stderrBuffer: '',
    authTimeout: null,
  }

  function clearAuthTimeout() {
    if (state.authTimeout) {
      clearTimeout(state.authTimeout)
      state.authTimeout = null
    }
  }

  function markConnected() {
    if (state.connected) return
    state.connected = true
    clearAuthTimeout()
    setPhase('connected')
  }

  function setPhase(phase, extra = {}) {
    state.phase = phase
    onStatus({ type: 'phase', phase, ...extra })
  }

  function emitError(message) {
    onStatus({ type: 'error', message })
  }

  function close(reason = null) {
    if (state.closed) return
    state.closed = true
    clearAuthTimeout()

    if (state.child) {
      const ch = state.child
      state.child = null
      killChildProcess(ch)
    }

    onStatus({ type: 'phase', phase: 'closed', reason })
  }

  async function connect() {
    if (state.closed || state.phase !== 'idle') return
    if (!dstMac) {
      emitError('MAC-адрес устройства не указан.')
      close('invalid-target')
      return
    }

    const resolved = resolveMacTelnetBinary()
    if (!resolved) {
      emitError(buildMissingBinaryMessage())
      close('binary-missing')
      return
    }

    onStatus({ type: 'binary-path', source: resolved.source, path: resolved.command })
    setPhase('discovering')

    const args = ['-A', '-u', username, '-p', password, '-t', '5', dstMac]

    try {
      const child = spawn(resolved.command, args, {
        cwd: os.homedir(),
        env: {
          ...process.env,
          TERM: String(options.term || 'dumb'),
          LANG: process.env.LANG || 'C',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      state.child = child
      setPhase('authenticating')
      state.authTimeout = setTimeout(() => {
        if (state.closed || state.connected) return
        emitError(
          'MAC-Telnet не завершил авторизацию вовремя. Проверьте сеть и учётные данные; при необходимости укажите другой клиент через NVI_MACTELNET_PATH.',
        )
        close('auth-timeout')
      }, AUTH_TIMEOUT_MS)

      child.stdout.on('data', (chunk) => {
        if (state.closed) return
        const rawText = chunk.toString('utf8')
        if (rawText.includes(AUTH_READY_MARKER)) {
          markConnected()
        }
        const text = rawText.split(AUTH_READY_MARKER).join('')
        state.stdoutBuffer = `${state.stdoutBuffer}${text}`.slice(-8192)
        if (text.length > 0) {
          onOutput(Buffer.from(text, 'utf8'))
          if (!state.connected) {
            markConnected()
          }
        }
      })

      child.stderr.on('data', (chunk) => {
        if (state.closed) return
        const rawText = chunk.toString('utf8')
        if (rawText.includes(AUTH_READY_MARKER)) {
          markConnected()
        }
        const text = rawText.split(AUTH_READY_MARKER).join('')
        state.stderrBuffer = `${state.stderrBuffer}${text}`.slice(-8192)
        if (text.length > 0) {
          onOutput(Buffer.from(text, 'utf8'))
        }
      })

      child.on('error', (error) => {
        if (state.closed) return
        emitError(error instanceof Error ? error.message : String(error))
        close('spawn-failed')
      })

      child.on('exit', (exitCode, signal) => {
        if (state.closed) return

        const summary = summarizeOutput(`${state.stderrBuffer}\n${state.stdoutBuffer}`)
        if (!state.connected) {
          emitError(
            summary ||
              `Процесс mactelnet завершился до установления сессии (code=${exitCode}, signal=${signal}).`,
          )
        } else if (exitCode !== 0) {
          emitError(
            summary || `Сеанс MAC-Telnet завершился с ошибкой (code=${exitCode}, signal=${signal}).`,
          )
        }

        close(exitCode === 0 ? 'process-exit' : 'process-error')
      })
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error))
      close('spawn-failed')
    }
  }

  function writeInput(chunk) {
    if (state.closed || !state.child?.stdin) return
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (!text) return
    state.child.stdin.write(text)
  }

  function resize() {
    // mactelnet gracefully falls back to a non-TTY mode when stdout/stdin are pipes.
    // In that mode terminal resize events are ignored by the client itself.
  }

  return {
    connect,
    writeInput,
    resize,
    close,
    getPhase: () => state.phase,
  }
}

module.exports = {
  createMacTelnetSession,
}
