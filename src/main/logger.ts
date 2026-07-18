import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const MAX_LOG_BYTES = 2 * 1024 * 1024

function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function logFilePath(): string {
  return join(logsDir(), 'main.log')
}

function ensureLogDir(): void {
  const dir = logsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function rotateIfNeeded(): void {
  const path = logFilePath()
  if (!existsSync(path)) return
  try {
    if (statSync(path).size < MAX_LOG_BYTES) return
    const rotated = join(logsDir(), 'main.prev.log')
    renameSync(path, rotated)
  } catch {
    // ignore rotate failures
  }
}

function write(level: string, message: string, err?: unknown): void {
  const stamp = new Date().toISOString()
  let line = `[${stamp}] [${level}] ${message}`
  if (err !== undefined) {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    line += `\n${detail}`
  }
  line += '\n'

  if (level === 'error') {
    console.error(message, err ?? '')
  } else if (level === 'warn') {
    console.warn(message, err ?? '')
  } else {
    console.log(message)
  }

  try {
    ensureLogDir()
    rotateIfNeeded()
    appendFileSync(logFilePath(), line, 'utf-8')
  } catch {
    // logging must never crash the app
  }
}

export const logger = {
  info(message: string): void {
    write('info', message)
  },
  warn(message: string, err?: unknown): void {
    write('warn', message, err)
  },
  error(message: string, err?: unknown): void {
    write('error', message, err)
  }
}

export function setupProcessErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason)
  })
}
