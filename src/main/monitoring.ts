import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import type { MonitoringPingResult, MonitoringPingTarget } from '../shared/api'

const PING_TIMEOUT_MS = 5000
const PING_COUNT = 3
const MAX_TARGETS_PER_REQUEST = 80
const PING_CONCURRENCY = 6

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
    return ['-n', String(PING_COUNT), '-w', String(PING_TIMEOUT_MS), host]
  }

  if (process.platform === 'darwin') {
    return ['-c', String(PING_COUNT), '-W', String(PING_TIMEOUT_MS), host]
  }

  return ['-c', String(PING_COUNT), '-W', String(Math.ceil(PING_TIMEOUT_MS / 1000)), host]
}

function parseLatencyMs(output: string): number | null {
  const summaryMatch = output.match(/(?:round-trip|rtt)[^=]*=\s*[0-9]+(?:[.,][0-9]+)?\/([0-9]+(?:[.,][0-9]+)?)\//i)
  if (summaryMatch) {
    const latency = Number(summaryMatch[1].replace(',', '.'))
    return Number.isFinite(latency) ? latency : null
  }

  const windowsAverageMatch = output.match(
    /(?:Average|Среднее|Средний|Средняя)\s*=\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:ms|мс|мсек)?/i
  )
  if (windowsAverageMatch) {
    const latency = Number(windowsAverageMatch[1].replace(',', '.'))
    return Number.isFinite(latency) ? latency : null
  }

  const samples = [...output.matchAll(/(?:time|время)[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:ms|мс|мсек)/gi)]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter(Number.isFinite)

  if (!samples.length) return null

  return samples.reduce((sum, value) => sum + value, 0) / samples.length
}

function pingTarget(target: MonitoringPingTarget): Promise<MonitoringPingResult> {
  return new Promise((resolve) => {
    execFile('ping', getPingArgs(target.host), { timeout: PING_TIMEOUT_MS * PING_COUNT + 1500 }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`
      const latencyMs = parseLatencyMs(output)

      if (!error || latencyMs !== null) {
        resolve({
          ...target,
          status: 'online',
          latencyMs,
          checkedAt: Date.now()
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
        checkedAt: Date.now(),
        error: offline ? undefined : error.message
      })
    })
  })
}

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index])
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

export function setupMonitoring(): void {
  ipcMain.handle('monitoring:ping', async (_, rawTargets: unknown): Promise<MonitoringPingResult[]> => {
    const targets = normalizeTargets(rawTargets)
    return mapPool(targets, PING_CONCURRENCY, pingTarget)
  })
}
