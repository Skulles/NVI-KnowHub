import type { MonitoringCameraStream } from '@shared/api'

export interface MonitoringObject {
  id: string
  code: string
  linkHost: string
  serverHost: string
  serverLogin: string
  serverPassword: string
  /** Cached OWL.Guard version from last successful check. */
  serverVersion?: string
  /** Cached streams from /gateway/config/streams. */
  cameraStreams?: MonitoringCameraStream[]
  /** Count of streams (cameras total, shown after /). */
  camerasTotal?: number
  /** Online cameras from PreviewV2 (shown before /). */
  camerasOnline?: number
  /** Megaphones total from /gateway/config/core/megaphones. */
  megaphonesTotal?: number
  /** Online megaphones from /gateway/Megaphone/statuses/V2. */
  megaphonesOnline?: number
}

export interface MonitoringSnapshot {
  objects: MonitoringObject[]
}

export const DEFAULT_SERVER_LOGIN = 'service'

function normalizeCameraStreams(value: unknown): MonitoringCameraStream[] | undefined {
  if (!Array.isArray(value)) return undefined

  const streams: MonitoringCameraStream[] = []
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'number' && Number.isFinite(record.id) ? record.id : null
    if (id === null) return

    const stream: MonitoringCameraStream = { id }
    if (typeof record.connected === 'boolean') stream.connected = record.connected

    if (record.expectedImageSize && typeof record.expectedImageSize === 'object') {
      const size = record.expectedImageSize as Record<string, unknown>
      stream.expectedImageSize = {
        ...(typeof size.width === 'number' ? { width: size.width } : {}),
        ...(typeof size.height === 'number' ? { height: size.height } : {})
      }
    }

    if (record.stream && typeof record.stream === 'object') {
      const media = record.stream as Record<string, unknown>
      stream.stream = {
        ...(typeof media.url === 'string' || media.url === null ? { url: media.url as string | null } : {}),
        ...(media.onvif !== undefined ? { onvif: media.onvif } : {}),
        ...(typeof media.locationId === 'number' || media.locationId === null
          ? { locationId: media.locationId as number | null }
          : {})
      }
    }

    streams.push(stream)
  })

  return streams
}

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
    serverHost: `10.${Number(nn)}.${Number(yy)}.252`,
    serverLogin: DEFAULT_SERVER_LOGIN,
    serverPassword: ''
  }
}

export function buildMonitoringObject(
  digits: string,
  linkHost: string,
  serverHost: string,
  serverLogin = DEFAULT_SERVER_LOGIN,
  serverPassword = ''
): MonitoringObject | null {
  const parsed = parseMonitoringObject(digits)
  if (!parsed) return null
  if (!isValidIPv4(linkHost) || !isValidIPv4(serverHost)) return null

  return {
    ...parsed,
    linkHost: linkHost.trim(),
    serverHost: serverHost.trim(),
    serverLogin: serverLogin.trim(),
    serverPassword: serverPassword
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
    const serverLogin =
      'serverLogin' in item && typeof item.serverLogin === 'string' && item.serverLogin.trim()
        ? item.serverLogin.trim()
        : DEFAULT_SERVER_LOGIN
    const serverPassword = 'serverPassword' in item && typeof item.serverPassword === 'string' ? item.serverPassword : ''
    const serverVersion =
      'serverVersion' in item && typeof item.serverVersion === 'string' && item.serverVersion.trim()
        ? item.serverVersion.trim()
        : undefined
    const cameraStreams = normalizeCameraStreams(
      'cameraStreams' in item ? (item as { cameraStreams?: unknown }).cameraStreams : undefined
    )
    const camerasTotal =
      'camerasTotal' in item &&
      typeof (item as { camerasTotal?: unknown }).camerasTotal === 'number' &&
      Number.isFinite((item as { camerasTotal: number }).camerasTotal)
        ? Math.max(0, Math.round((item as { camerasTotal: number }).camerasTotal))
        : cameraStreams?.length
    const camerasOnline =
      'camerasOnline' in item &&
      typeof (item as { camerasOnline?: unknown }).camerasOnline === 'number' &&
      Number.isFinite((item as { camerasOnline: number }).camerasOnline)
        ? Math.max(0, Math.round((item as { camerasOnline: number }).camerasOnline))
        : undefined
    const megaphonesTotal =
      'megaphonesTotal' in item &&
      typeof (item as { megaphonesTotal?: unknown }).megaphonesTotal === 'number' &&
      Number.isFinite((item as { megaphonesTotal: number }).megaphonesTotal)
        ? Math.max(0, Math.round((item as { megaphonesTotal: number }).megaphonesTotal))
        : undefined
    const megaphonesOnline =
      'megaphonesOnline' in item &&
      typeof (item as { megaphonesOnline?: unknown }).megaphonesOnline === 'number' &&
      Number.isFinite((item as { megaphonesOnline: number }).megaphonesOnline)
        ? Math.max(0, Math.round((item as { megaphonesOnline: number }).megaphonesOnline))
        : undefined

    seen.add(parsed.id)
    objects.push({
      ...parsed,
      linkHost,
      serverHost,
      serverLogin,
      serverPassword,
      ...(serverVersion ? { serverVersion } : {}),
      ...(cameraStreams ? { cameraStreams, camerasTotal: camerasTotal ?? cameraStreams.length } : {}),
      ...(camerasOnline !== undefined ? { camerasOnline } : {}),
      ...(megaphonesTotal !== undefined ? { megaphonesTotal } : {}),
      ...(megaphonesOnline !== undefined ? { megaphonesOnline } : {})
    })
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
