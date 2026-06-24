import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import type { MonitoringPingResult, MonitoringPingTarget } from '../shared/api'

const PING_TIMEOUT_MS = 2000
const MAX_TARGETS_PER_REQUEST = 80

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return Number.isInteger(value) && value >= 0 && value <= 255
  })
}

function normalizeTargets(rawTargets: unknown): MonitoringPingTarget[] {
  if (!Array.isArray(rawTargets)) return []

  return rawTargets
    .slice(0, MAX_TARGETS_PER_REQUEST)
    .filter(isPlainObject)
    .map((target) => ({
      id: typeof target.id === 'string' ? target.id : '',
      host: typeof target.host === 'string' ? target.host : '',
      label: typeof target.label === 'string' ? target.label : ''
    }))
    .filter((target) => target.id && target.label && isValidIPv4(target.host))
}

function getPingArgs(host: string): string[] {
  if (process.platform === 'win32') {
    return ['-n', '1', '-w', String(PING_TIMEOUT_MS), host]
  }

  if (process.platform === 'darwin') {
    return ['-c', '1', '-W', String(PING_TIMEOUT_MS), host]
  }

  return ['-c', '1', '-W', String(Math.ceil(PING_TIMEOUT_MS / 1000)), host]
}

function parseLatencyMs(output: string): number | null {
  const match = output.match(/time[=<]([0-9]+(?:[.,][0-9]+)?)\s*ms/i)
  if (!match) return null

  const latency = Number(match[1].replace(',', '.'))
  return Number.isFinite(latency) ? latency : null
}

function pingTarget(target: MonitoringPingTarget): Promise<MonitoringPingResult> {
  const checkedAt = Date.now()

  return new Promise((resolve) => {
    execFile('ping', getPingArgs(target.host), { timeout: PING_TIMEOUT_MS + 750 }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`
      const latencyMs = parseLatencyMs(output)

      if (!error) {
        resolve({
          ...target,
          status: 'online',
          latencyMs,
          checkedAt
        })
        return
      }

      const pingExited = typeof error.code === 'number'
      const timedOut = error.killed || /timed?\s*out|timeout|100%\s*packet\s*loss/i.test(output)
      const offline = pingExited || timedOut

      resolve({
        ...target,
        status: offline ? 'offline' : 'error',
        latencyMs: null,
        checkedAt,
        error: offline ? undefined : error.message
      })
    })
  })
}

export function setupMonitoring(): void {
  ipcMain.handle('monitoring:ping', async (_, rawTargets: unknown): Promise<MonitoringPingResult[]> => {
    const targets = normalizeTargets(rawTargets)
    return Promise.all(targets.map((target) => pingTarget(target)))
  })
}
