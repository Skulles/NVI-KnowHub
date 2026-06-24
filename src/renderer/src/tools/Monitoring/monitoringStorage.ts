export interface MonitoringObject {
  id: string
  code: string
  linkHost: string
  serverHost: string
}

export interface MonitoringSnapshot {
  objects: MonitoringObject[]
  intervalMs: number
}

export const MONITORING_INTERVALS = [
  { label: '1 сек', value: 1000 },
  { label: '5 сек', value: 5000 },
  { label: '30 сек', value: 30000 },
  { label: '1 мин', value: 60000 },
  { label: '5 мин', value: 300000 }
] as const

export const DEFAULT_MONITORING_INTERVAL_MS = 5000

const STORAGE_KEY = 'monitoring-tool-v1'
const OBJECT_RE = /^(?:owl)?(\d{2})(\d{2})\/?$/i

const DEFAULT: MonitoringSnapshot = {
  objects: [],
  intervalMs: DEFAULT_MONITORING_INTERVAL_MS
}

export function parseMonitoringObject(raw: string): MonitoringObject | null {
  const match = raw.trim().match(OBJECT_RE)
  if (!match) return null

  const [, nn, yy] = match
  const normalizedCode = `owl${nn}${yy}/`.toLowerCase()

  return {
    id: normalizedCode,
    code: normalizedCode,
    linkHost: `10.${Number(nn)}.${Number(yy)}.1`,
    serverHost: `10.${Number(nn)}.${Number(yy)}.252`
  }
}

export function sanitizeMonitoringDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4)
}

function normalizeInterval(value: unknown): number {
  return typeof value === 'number' && MONITORING_INTERVALS.some((interval) => interval.value === value)
    ? value
    : DEFAULT_MONITORING_INTERVAL_MS
}

function normalizeObjects(value: unknown): MonitoringObject[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const objects: MonitoringObject[] = []

  value.forEach((item) => {
    if (!item || typeof item !== 'object') return

    const code = 'code' in item && typeof item.code === 'string' ? item.code : ''
    const parsed = parseMonitoringObject(code)
    if (!parsed || seen.has(parsed.id)) return

    seen.add(parsed.id)
    objects.push(parsed)
  })

  return objects
}

export function loadMonitoringSnapshot(): MonitoringSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT }

    const parsed = JSON.parse(raw)
    return {
      objects: normalizeObjects(parsed?.objects),
      intervalMs: normalizeInterval(parsed?.intervalMs)
    }
  } catch {
    return { ...DEFAULT }
  }
}

export function saveMonitoringSnapshot(snapshot: MonitoringSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // storage unavailable - ignore
  }
}
