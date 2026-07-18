export interface MonitoringObject {
  id: string
  code: string
  linkHost: string
  serverHost: string
}

export interface MonitoringSnapshot {
  objects: MonitoringObject[]
}

export const MONITORING_REFRESH_INTERVAL_MS = 5000

const STORAGE_KEY = 'monitoring-tool-v1'
const OBJECT_RE = /^(?:owl)?(\d{2})(\d{2})\/?$/i

const DEFAULT: MonitoringSnapshot = {
  objects: []
}

export function isValidIPv4(host: string): boolean {
  const parts = host.trim().split('.')
  if (parts.length !== 4) return false

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return Number.isInteger(value) && value >= 0 && value <= 255
  })
}

export type IPv4Octets = [string, string, string, string]

export function parseIPv4Octets(value: string): IPv4Octets {
  const parts = value.trim().split('.')
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? '', parts[3] ?? '']
}

export function joinIPv4Octets(octets: IPv4Octets): string {
  return octets.join('.')
}

export function sanitizeIPv4OctetInput(value: string, previous = ''): string {
  const digits = value.replace(/\D/g, '').slice(0, 3)
  if (!digits) return ''
  if (Number(digits) > 255) return previous
  return digits
}

export function normalizePastedIPv4(text: string): string | null {
  const trimmed = text.trim()
  if (isValidIPv4(trimmed)) return trimmed

  const parts = trimmed.split('.').slice(0, 4)
  if (!parts.some((part) => part.replace(/\D/g, '').length > 0)) return null

  const octets: IPv4Octets = [0, 1, 2, 3].map((index) => {
    const digits = (parts[index] ?? '').replace(/\D/g, '').slice(0, 3)
    if (!digits) return ''
    return String(Math.min(255, Number(digits)))
  }) as IPv4Octets

  return joinIPv4Octets(octets)
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

export function buildMonitoringObject(
  digits: string,
  linkHost: string,
  serverHost: string
): MonitoringObject | null {
  const parsed = parseMonitoringObject(digits)
  if (!parsed) return null
  if (!isValidIPv4(linkHost) || !isValidIPv4(serverHost)) return null

  return {
    ...parsed,
    linkHost: linkHost.trim(),
    serverHost: serverHost.trim()
  }
}

export function objectDigits(object: MonitoringObject): string {
  return object.code.replace(/^owl/i, '').replace(/\//, '')
}

export function sanitizeMonitoringDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4)
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

    const linkHost =
      'linkHost' in item && typeof item.linkHost === 'string' && isValidIPv4(item.linkHost)
        ? item.linkHost.trim()
        : parsed.linkHost
    const serverHost =
      'serverHost' in item && typeof item.serverHost === 'string' && isValidIPv4(item.serverHost)
        ? item.serverHost.trim()
        : parsed.serverHost

    seen.add(parsed.id)
    objects.push({ ...parsed, linkHost, serverHost })
  })

  return objects
}

export function loadMonitoringSnapshot(): MonitoringSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT }

    const parsed = JSON.parse(raw)
    return {
      objects: normalizeObjects(parsed?.objects)
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
