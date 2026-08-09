/**
 * Main-process ICMP ping + HTTP probe batch IPC used by the Monitoring tool.
 */
import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import type {
  MonitoringAuthRequest,
  MonitoringCameraStream,
  MonitoringDeviceProbeBody,
  MonitoringDeviceProbeRequest,
  MonitoringDeviceProbeResult,
  MonitoringDevicesResult,
  MonitoringGuardDevice,
  MonitoringHttpResult,
  MonitoringHttpTarget,
  MonitoringLocation,
  MonitoringLocationsResult,
  MonitoringMegaphone,
  MonitoringMegaphonesResult,
  MonitoringMegaphoneStatusesResult,
  MonitoringPingResult,
  MonitoringPingTarget,
  MonitoringPreviewRequest,
  MonitoringPreviewResult,
  MonitoringServerResourcesResult,
  MonitoringStreamsResult,
  MonitoringVersionRequest,
  MonitoringVersionResult
} from '../shared/api'

/** Per-reply wait; VPN RTT often 300–900ms with occasional drops. */
const PING_TIMEOUT_MS = 5000
/** Several echoes so one lost packet does not mark the link offline. */
const PING_COUNT = 3
const HTTP_PROBE_TIMEOUT_MS = 3000
const AUTH_TIMEOUT_MS = 10000
const API_TIMEOUT_MS = 15000
const GRAFANA_OIDC_TIMEOUT_MS = 30000
const GRAFANA_SESSION_TTL_MS = 30 * 60_000
const PREVIEW_TIMEOUT_MS = 60000
const MAX_TARGETS_PER_REQUEST = 80
const PING_CONCURRENCY = 3
const HTTP_PROBE_CONCURRENCY = 3
const PREVIEW_CONCURRENCY = 2
const OWL_GUARD_CLIENT_ID = 'owlguard-gateway'
const OWL_GUARD_SCOPE = 'openid'
const TOKEN_SKEW_MS = 30_000

let previewSlots = 0
const previewWaiters: Array<() => void> = []

async function withPreviewSlot<T>(worker: () => Promise<T>): Promise<T> {
  if (previewSlots >= PREVIEW_CONCURRENCY) {
    await new Promise<void>((resolve) => previewWaiters.push(resolve))
  }
  previewSlots += 1
  try {
    return await worker()
  } finally {
    previewSlots -= 1
    const next = previewWaiters.shift()
    if (next) next()
  }
}

interface CachedToken {
  accessToken: string
  refreshToken: string | null
  accessExpiresAt: number
}

const tokenCache = new Map<string, CachedToken>()
/** Deduplicate concurrent password/refresh grants for the same credentials. */
const tokenInflight = new Map<string, Promise<string>>()

interface SessionCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  hostOnly: boolean
}

class SessionCookieJar {
  private readonly cookies = new Map<string, SessionCookie>()

  store(url: URL, headers: Headers): void {
    const combined = headers.get('set-cookie')
    if (!combined) return

    for (const rawCookie of combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/)) {
      const parts = rawCookie.split(';')
      const separator = parts[0].indexOf('=')
      if (separator <= 0) continue

      const name = parts[0].slice(0, separator).trim()
      const value = parts[0].slice(separator + 1).trim()
      let domain = url.hostname.toLowerCase()
      let path = defaultCookiePath(url.pathname)
      let secure = false
      let hostOnly = true
      let remove = false

      for (const rawAttribute of parts.slice(1)) {
        const [rawName, ...rawValueParts] = rawAttribute.trim().split('=')
        const attributeName = rawName.toLowerCase()
        const attributeValue = rawValueParts.join('=').trim()
        if (attributeName === 'domain' && attributeValue) {
          domain = attributeValue.replace(/^\./, '').toLowerCase()
          hostOnly = false
        } else if (attributeName === 'path' && attributeValue.startsWith('/')) {
          path = attributeValue
        } else if (attributeName === 'secure') {
          secure = true
        } else if (attributeName === 'max-age' && Number(attributeValue) <= 0) {
          remove = true
        }
      }

      const key = `${domain}\0${path}\0${name}`
      if (remove || !value) {
        this.cookies.delete(key)
      } else {
        this.cookies.set(key, { name, value, domain, path, secure, hostOnly })
      }
    }
  }

  header(url: URL): string {
    return [...this.cookies.values()]
      .filter((cookie) => {
        const hostname = url.hostname.toLowerCase()
        const domainMatches = cookie.hostOnly
          ? hostname === cookie.domain
          : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`)
        const pathMatches =
          url.pathname === cookie.path ||
          url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`)
        return domainMatches && pathMatches && (!cookie.secure || url.protocol === 'https:')
      })
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
  }

  get(name: string): SessionCookie | null {
    return [...this.cookies.values()].find((cookie) => cookie.name === name) ?? null
  }
}

interface CachedGrafanaSession {
  jar: SessionCookieJar
  expiresAt: number
}

const grafanaSessionCache = new Map<string, CachedGrafanaSession>()
const grafanaSessionInflight = new Map<string, Promise<SessionCookieJar>>()

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname === '/') return '/'
  const lastSlash = pathname.lastIndexOf('/')
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash)
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function parseKeycloakLoginForm(
  html: string,
  pageUrl: string
): { action: string; fields: URLSearchParams } | null {
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formAttributes = parseHtmlAttributes(match[1])
    const action = formAttributes.action ?? ''
    if (formAttributes.id !== 'kc-form-login' && !action.includes('login-actions/authenticate')) continue

    const fields = new URLSearchParams()
    for (const input of match[2].matchAll(/<input\b([^>]*)>/gi)) {
      const attributes = parseHtmlAttributes(input[1])
      if (attributes.name) fields.set(attributes.name, attributes.value ?? '')
    }
    return { action: new URL(action, pageUrl).toString(), fields }
  }
  return null
}

async function fetchWithCookieRedirects(
  initialUrl: string,
  jar: SessionCookieJar,
  init: RequestInit = {}
): Promise<{ response: Response; url: string }> {
  let url = initialUrl
  let method = init.method ?? 'GET'
  let body = init.body
  const baseHeaders = new Headers(init.headers)

  for (let redirectCount = 0; redirectCount <= 20; redirectCount += 1) {
    const currentUrl = new URL(url)
    const headers = new Headers(baseHeaders)
    const cookieHeader = jar.header(currentUrl)
    if (cookieHeader) headers.set('Cookie', cookieHeader)
    else headers.delete('Cookie')

    const response = await fetch(url, { ...init, method, body, headers, redirect: 'manual' })
    jar.store(currentUrl, response.headers)

    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, url }
    }

    if (response.body) await response.body.cancel()
    url = new URL(location, url).toString()

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
      baseHeaders.delete('Content-Type')
      baseHeaders.delete('Content-Length')
    }
  }

  throw new Error('Слишком много OIDC-редиректов')
}

async function loginGrafanaOidc(
  host: string,
  username: string,
  password: string
): Promise<SessionCookieJar> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GRAFANA_OIDC_TIMEOUT_MS)
  const jar = new SessionCookieJar()

  try {
    const login = await fetchWithCookieRedirects(
      `http://${host}/monitor/login/generic_oauth`,
      jar,
      { signal: controller.signal }
    )
    const loginHtml = await login.response.text()
    const form = parseKeycloakLoginForm(loginHtml, login.url)
    if (!form) {
      throw new Error(`форма входа Keycloak не найдена (HTTP ${login.response.status})`)
    }

    form.fields.set('username', username)
    form.fields.set('password', password)
    const callback = await fetchWithCookieRedirects(form.action, jar, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.fields.toString(),
      signal: controller.signal
    })
    if (callback.response.body) await callback.response.body.cancel()

    const sessionCookie = jar.get('grafana_session')
    if (!sessionCookie) {
      throw new Error(`callback не установил grafana_session (HTTP ${callback.response.status})`)
    }

    const maskedValue =
      sessionCookie.value.length > 12
        ? `${sessionCookie.value.slice(0, 6)}…${sessionCookie.value.slice(-4)}`
        : '***'
    console.log(
      `[monitoring] Grafana OIDC ok host=${host} grafana_session=${maskedValue} length=${sessionCookie.value.length} path=${sessionCookie.path}`
    )
    return jar
  } finally {
    clearTimeout(timer)
  }
}

async function obtainGrafanaSession(
  host: string,
  username: string,
  password: string
): Promise<SessionCookieJar> {
  const key = tokenCacheKey(host, username, password)
  const cached = grafanaSessionCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.jar

  const inflight = grafanaSessionInflight.get(key)
  if (inflight) return inflight

  const pending = loginGrafanaOidc(host, username, password)
    .then((jar) => {
      grafanaSessionCache.set(key, { jar, expiresAt: Date.now() + GRAFANA_SESSION_TTL_MS })
      return jar
    })
    .finally(() => {
      if (grafanaSessionInflight.get(key) === pending) grafanaSessionInflight.delete(key)
    })
  grafanaSessionInflight.set(key, pending)
  return pending
}

function grafanaCpuHostTag(host: string): string {
  const parts = host.split('.')
  return `owl${parts[1]}${parts[2]}`
}

function parseLatestGrafanaMetric(
  payload: unknown,
  refId: string,
  fieldName: string
): number {
  if (!isPlainObject(payload) || !isPlainObject(payload.results)) {
    throw new Error('Grafana вернула некорректный ответ')
  }
  const result = payload.results[refId]
  if (!isPlainObject(result) || !Array.isArray(result.frames)) {
    throw new Error(`В ответе Grafana нет серии ${fieldName}`)
  }

  const samples: number[] = []
  for (const frame of result.frames) {
    if (!isPlainObject(frame) || !isPlainObject(frame.schema) || !isPlainObject(frame.data)) continue
    if (!Array.isArray(frame.schema.fields) || !Array.isArray(frame.data.values)) continue

    const valueIndex = frame.schema.fields.findIndex(
      (field) => isPlainObject(field) && field.name === fieldName
    )
    const values = valueIndex >= 0 ? frame.data.values[valueIndex] : frame.data.values[1]
    if (!Array.isArray(values)) continue

    let latest: number | null = null
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const numeric = typeof values[index] === 'number' ? values[index] : Number(values[index])
      if (Number.isFinite(numeric)) {
        latest = numeric
        break
      }
    }
    if (latest === null) continue

    samples.push(latest)
  }

  const value =
    samples.length > 0
      ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length
      : Number.NaN
  if (!Number.isFinite(value)) throw new Error(`Grafana не вернула значение ${fieldName}`)
  return Math.max(0, Math.min(100, value))
}

function parseLatestCpuPackageTemp(payload: unknown): number {
  if (!isPlainObject(payload) || !isPlainObject(payload.results)) {
    throw new Error('Grafana вернула некорректный ответ температуры CPU')
  }
  const result = payload.results.D
  if (!isPlainObject(result) || !Array.isArray(result.frames)) {
    throw new Error('В ответе Grafana нет серии температуры CPU')
  }

  const latestBySensor = new Map<string, { at: number; value: number }>()
  const seenSensors = new Set<string>()
  const extractPackageSensor = (value: unknown): string => {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    if (trimmed) seenSensors.add(trimmed)
    return trimmed.match(/coretemp_package(?:_id_\d+)?/i)?.[0].toLowerCase() ?? ''
  }

  for (const frame of result.frames) {
    if (!isPlainObject(frame) || !isPlainObject(frame.schema) || !isPlainObject(frame.data)) continue
    if (!Array.isArray(frame.schema.fields) || !Array.isArray(frame.data.values)) continue

    const tempIndex = frame.schema.fields.findIndex(
      (field) =>
        isPlainObject(field) &&
        typeof field.name === 'string' &&
        field.name.toLowerCase() === 'temp'
    )
    const sensorIndex = frame.schema.fields.findIndex(
      (field) =>
        isPlainObject(field) &&
        typeof field.name === 'string' &&
        field.name.toLowerCase() === 'sensor'
    )
    const timeIndex = frame.schema.fields.findIndex(
      (field) =>
        isPlainObject(field) &&
        typeof field.name === 'string' &&
        field.name.toLowerCase() === 'time'
    )
    if (tempIndex < 0 || !Array.isArray(frame.data.values[tempIndex])) continue

    const tempValues = frame.data.values[tempIndex] as unknown[]
    const sensorValues =
      sensorIndex >= 0 && Array.isArray(frame.data.values[sensorIndex])
        ? (frame.data.values[sensorIndex] as unknown[])
        : null
    const timeValues =
      timeIndex >= 0 && Array.isArray(frame.data.values[timeIndex])
        ? (frame.data.values[timeIndex] as unknown[])
        : null
    let frameSensor = extractPackageSensor(frame.schema.name)
    for (const field of frame.schema.fields) {
      if (!isPlainObject(field)) continue
      if (!frameSensor) frameSensor = extractPackageSensor(field.name)
      if (!isPlainObject(field.labels)) continue
      for (const [label, labelValue] of Object.entries(field.labels)) {
        if (!frameSensor && (label.toLowerCase().includes('sensor') || typeof labelValue === 'string')) {
          frameSensor = extractPackageSensor(labelValue)
        }
      }
    }

    for (let index = 0; index < tempValues.length; index += 1) {
      const sensor = extractPackageSensor(sensorValues?.[index]) || frameSensor
      if (!sensor) continue

      const rawTemp = tempValues[index]
      const value = typeof rawTemp === 'number' ? rawTemp : Number(rawTemp)
      if (!Number.isFinite(value)) continue

      const rawTime = timeValues?.[index]
      const numericTime = typeof rawTime === 'number' ? rawTime : Number(rawTime)
      const parsedTime =
        Number.isFinite(numericTime) && rawTime !== null && rawTime !== ''
          ? numericTime
          : typeof rawTime === 'string'
            ? Date.parse(rawTime)
            : index
      const at = Number.isFinite(parsedTime) ? parsedTime : index
      const current = latestBySensor.get(sensor)
      if (!current || at > current.at) latestBySensor.set(sensor, { at, value })
    }
  }

  const temperatures = [...latestBySensor.values()].map((sample) => sample.value)
  if (temperatures.length === 0) {
    const discovered = [...seenSensors].slice(0, 12).join(', ')
    throw new Error(
      discovered
        ? `Grafana не вернула coretemp_package; найдены: ${discovered}`
        : 'Grafana не вернула coretemp_package и метки sensor'
    )
  }
  return Math.max(...temperatures)
}

async function fetchGrafanaServerResources(
  request: MonitoringAuthRequest
): Promise<MonitoringServerResourcesResult> {
  const checkedAt = Date.now()
  const cacheKey = tokenCacheKey(request.host, request.username, request.password)

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const jar = await obtainGrafanaSession(request.host, request.username, request.password)
      const endpoint = new URL(`http://${request.host}/monitor/api/ds/query`)
      endpoint.searchParams.set('ds_type', 'influxdb')
      endpoint.searchParams.set('requestId', `RES${Date.now()}`)
      const now = Date.now()
      const body = {
        from: String(now - 5 * 60_000),
        to: String(now),
        queries: [
          {
            refId: 'A',
            dataset: 'iox',
            datasource: { type: 'influxdb', uid: 'influxdb_datasource' },
            editorMode: 'builder',
            format: 'time_series',
            query: `SELECT "usage_active", "time" FROM "cpu" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" DESC LIMIT 1`,
            rawQuery: true,
            rawSql: `SELECT "usage_active", "time" FROM "cpu" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" DESC LIMIT 1`,
            table: 'cpu',
            datasourceId: 1,
            intervalMs: 500,
            maxDataPoints: 1
          },
          {
            refId: 'B',
            dataset: 'iox',
            datasource: { type: 'influxdb', uid: 'influxdb_datasource' },
            editorMode: 'code',
            format: 'time_series',
            query: `SELECT "utilization_gpu", "temperature_gpu", "time" FROM "nvidia_smi" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" DESC LIMIT 1`,
            rawQuery: true,
            rawSql: `SELECT "utilization_gpu", "temperature_gpu", "time" FROM "nvidia_smi" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" DESC LIMIT 1`,
            table: 'nvidia_smi',
            datasourceId: 1,
            intervalMs: 500,
            maxDataPoints: 1
          },
          {
            refId: 'C',
            dataset: 'iox',
            datasource: { type: 'influxdb', uid: 'influxdb_datasource' },
            editorMode: 'code',
            format: 'time_series',
            query: `SELECT "used_percent", "time" FROM "mem" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" DESC LIMIT 1`,
            rawQuery: true,
            rawSql: `SELECT "used_percent", "time" FROM "mem" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" DESC LIMIT 1`,
            table: 'mem',
            datasourceId: 1,
            intervalMs: 500,
            maxDataPoints: 1
          },
          {
            refId: 'D',
            dataset: 'iox',
            datasource: { type: 'influxdb', uid: 'influxdb_datasource' },
            editorMode: 'code',
            format: 'time_series',
            query: `SELECT "temp", "sensor", "time" FROM "temp" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" ASC`,
            rawQuery: true,
            rawSql: `SELECT "temp", "sensor", "time" FROM "temp" WHERE "time" >= $__timeFrom AND "time" <= $__timeTo AND "host" = '${grafanaCpuHostTag(request.host)}' ORDER BY "time" ASC`,
            table: 'temp',
            datasourceId: 1,
            intervalMs: 2000,
            maxDataPoints: 512
          }
        ]
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Cookie: jar.header(endpoint),
            Origin: `http://${request.host}`,
            Referer: `http://${request.host}/monitor/`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })
        jar.store(endpoint, response.headers)

        if (
          response.status === 401 ||
          response.status === 403 ||
          (response.status >= 300 && response.status < 400)
        ) {
          if (response.body) await response.body.cancel()
          grafanaSessionCache.delete(cacheKey)
          if (attempt === 0) continue
          throw new Error(`Grafana отклонила сессию: HTTP ${response.status}`)
        }

        const text = await response.text()
        let payload: unknown
        try {
          payload = JSON.parse(text)
        } catch {
          throw new Error(
            response.ok
              ? 'Grafana resources API вернула не JSON'
              : `Grafana resources API: HTTP ${response.status} ${text.slice(0, 160)}`
          )
        }

        const queryErrors: string[] = []
        if (isPlainObject(payload) && isPlainObject(payload.results)) {
          for (const [refId, queryResult] of Object.entries(payload.results)) {
            if (isPlainObject(queryResult) && typeof queryResult.error === 'string') {
              queryErrors.push(`${refId}: ${queryResult.error}`)
            }
          }
        }
        if (!response.ok && queryErrors.length > 0) {
          console.warn(
            `[monitoring] Grafana resources partial host=${request.host} HTTP ${response.status}: ${queryErrors.join('; ')}`
          )
        }

        let cpuLoad: number
        try {
          cpuLoad = parseLatestGrafanaMetric(payload, 'A', 'usage_active')
        } catch (error) {
          if (!response.ok) {
            throw new Error(
              `Grafana resources API: HTTP ${response.status}${queryErrors.length ? ` ${queryErrors.join('; ')}` : ''}`
            )
          }
          throw error
        }
        let cpuTempC: number | null = null
        try {
          cpuTempC = parseLatestCpuPackageTemp(payload)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'неизвестный формат'
          console.warn(`[monitoring] Grafana CPU temperature host=${request.host}: ${message}`)
        }
        let gpuLoad: number | null = null
        try {
          gpuLoad = parseLatestGrafanaMetric(payload, 'B', 'utilization_gpu')
        } catch {
          // GPU telemetry is optional: CPU should still be displayed on hosts without NVIDIA data.
        }
        let gpuTempC: number | null = null
        try {
          gpuTempC = parseLatestGrafanaMetric(payload, 'B', 'temperature_gpu')
        } catch {
          // Temperature may be absent even when GPU utilization is available.
        }
        let ramLoad: number | null = null
        try {
          ramLoad = parseLatestGrafanaMetric(payload, 'C', 'used_percent')
        } catch {
          // Keep the other resource values when memory telemetry is temporarily unavailable.
        }
        console.log(
          `[monitoring] Grafana resources host=${request.host} cpu=${cpuLoad.toFixed(1)}% cpuTemp=${cpuTempC === null ? 'N/A' : `${cpuTempC.toFixed(1)}C`} gpu=${gpuLoad === null ? 'N/A' : `${gpuLoad.toFixed(1)}%`} gpuTemp=${gpuTempC === null ? 'N/A' : `${gpuTempC.toFixed(1)}C`} ram=${ramLoad === null ? 'N/A' : `${ramLoad.toFixed(1)}%`}`
        )
        return {
          id: request.id,
          host: request.host,
          ok: true,
          cpuLoad,
          cpuTempC,
          gpuLoad,
          gpuTempC,
          ramLoad,
          checkedAt
        }
      } finally {
        clearTimeout(timer)
      }
    }
    throw new Error('Не удалось обновить сессию Grafana')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось получить ресурсы сервера'
    console.warn(`[monitoring] Grafana resources failed host=${request.host}: ${message}`)
    return {
      id: request.id,
      host: request.host,
      ok: false,
      cpuLoad: null,
      cpuTempC: null,
      gpuLoad: null,
      gpuTempC: null,
      ramLoad: null,
      checkedAt,
      error: message
    }
  }
}

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

function normalizeHostTargets<T extends { id: string; host: string; label: string }>(
  rawTargets: unknown
): T[] {
  if (!Array.isArray(rawTargets)) return []

  return rawTargets
    .slice(0, MAX_TARGETS_PER_REQUEST)
    .filter(isPlainObject)
    .map((target) => ({
      id: typeof target.id === 'string' ? target.id : '',
      host: typeof target.host === 'string' ? target.host : '',
      label: typeof target.label === 'string' ? target.label : '',
      fast: target.fast === true
    }))
    .filter((target) => target.id && target.label && isValidIPv4(target.host)) as unknown as T[]
}

function getPingArgs(host: string, count: number): string[] {
  if (process.platform === 'win32') {
    return ['-n', String(count), '-w', String(PING_TIMEOUT_MS), host]
  }

  if (process.platform === 'darwin') {
    return ['-c', String(count), '-W', String(PING_TIMEOUT_MS), host]
  }

  return ['-c', String(count), '-W', String(Math.ceil(PING_TIMEOUT_MS / 1000)), host]
}

function decodePingOutput(stdout: Buffer | string, stderr: Buffer | string): string {
  const chunks = [stdout, stderr].filter((chunk) => Boolean(chunk))
  const decode = (chunk: Buffer | string): string =>
    Buffer.isBuffer(chunk) ? chunk.toString(process.platform === 'win32' ? 'latin1' : 'utf8') : chunk

  return chunks.map(decode).join('\n')
}

function countPingReplies(output: string): number {
  const ttlHits = [...output.matchAll(/\bTTL=/gi)]
  if (ttlHits.length) return ttlHits.length

  // English / partial localized forms when code page mangled Cyrillic.
  const byteHits = [...output.matchAll(/\b(?:bytes\s+from|bytes\s*[=:]|байт\s*[=:])/gi)]
  return byteHits.length
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

  // "время=820мс" / "time=820ms" — optional spaces (RU Windows often has none).
  const samples = [
    ...output.matchAll(/(?:time|время)\s*[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:ms|мс|мсек)?/gi)
  ]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter(Number.isFinite)

  if (samples.length) {
    return samples.reduce((sum, value) => sum + value, 0) / samples.length
  }

  // Localized Windows ping often arrives in a legacy code page; match latency before TTL instead.
  const ttlSamples = [...output.matchAll(/[<>=](\d+(?:[.,]\d+)?)[^\d\n\r]*TTL=/gi)]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter(Number.isFinite)

  if (!ttlSamples.length) return null

  return ttlSamples.reduce((sum, value) => sum + value, 0) / ttlSamples.length
}

function pingTarget(target: MonitoringPingTarget): Promise<MonitoringPingResult> {
  return new Promise((resolve) => {
    const count = target.fast ? 1 : PING_COUNT
    execFile(
      'ping',
      getPingArgs(target.host, count),
      { timeout: PING_TIMEOUT_MS * count + 3000, encoding: 'buffer' },
      (error, stdout, stderr) => {
        const output = decodePingOutput(stdout, stderr)
        const latencyMs = parseLatencyMs(output)
        const replyCount = countPingReplies(output)

        // Any successful echo ⇒ online (VPN often drops 1 of N packets).
        if (replyCount > 0 || latencyMs !== null) {
          resolve({
            ...target,
            status: 'online',
            latencyMs,
            replyCount,
            sentCount: count,
            checkedAt: Date.now()
          })
          return
        }

        if (!error) {
          resolve({
            ...target,
            status: 'online',
            latencyMs: null,
            replyCount: count,
            sentCount: count,
            checkedAt: Date.now()
          })
          return
        }

        const pingExited = typeof error.code === 'number'
        const timedOut =
          error.killed ||
          /timed?\s*out|timeout|100%\s*packet\s*loss|превышен\s*интервал|неудач/i.test(output)
        const offline = pingExited || timedOut

        resolve({
          ...target,
          status: offline ? 'offline' : 'error',
          latencyMs: null,
          replyCount: 0,
          sentCount: count,
          checkedAt: Date.now(),
          error: offline ? undefined : error.message
        })
      }
    )
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

async function probeHttpTarget(target: MonitoringHttpTarget): Promise<MonitoringHttpResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_PROBE_TIMEOUT_MS)

  try {
    // Lightweight gateway probe (cheaper than full UI `/`, no ICMP to server).
    const response = await fetch(`http://${target.host}/gateway/SsoDetails`, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    })

    if (response.body) {
      try {
        await response.body.cancel()
      } catch {
        // ignore stream cancel errors
      }
    }

    const ok = response.status >= 200 && response.status < 400
    return {
      ...target,
      ok,
      statusCode: response.status,
      checkedAt: Date.now(),
      error: ok ? undefined : `HTTP ${response.status}`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HTTP probe failed'
    return {
      ...target,
      ok: false,
      statusCode: null,
      checkedAt: Date.now(),
      error: message
    }
  } finally {
    clearTimeout(timer)
  }
}

function tokenCacheKey(host: string, username: string, password: string): string {
  return `${host}\0${username}\0${password}`
}

function tokenEndpoint(host: string): string {
  return `http://${host}/keycloak/realms/owlguard/protocol/openid-connect/token`
}

function versionEndpoint(host: string): string {
  return `http://${host}/gateway/Configuration/version`
}

function streamsEndpoint(host: string): string {
  return `http://${host}/gateway/config/streams`
}

function previewEndpoint(host: string): string {
  return `http://${host}/gateway/Markup/PreviewV2`
}

function megaphonesEndpoint(host: string): string {
  return `http://${host}/gateway/config/core/megaphones`
}

function locationsEndpoint(host: string): string {
  return `http://${host}/gateway/config/core/locations`
}

function megaphoneStatusesEndpoint(host: string): string {
  return `http://${host}/gateway/Megaphone/statuses/V2`
}

function devicesEndpoint(host: string): string {
  return `http://${host}/gateway/config/guard/devices`
}

function telemetryProbeEndpoint(host: string): string {
  return `http://${host}/gateway/Telemetry/probe`
}

function parseTokenResponse(payload: unknown): CachedToken {
  if (!isPlainObject(payload)) {
    throw new Error('Сервер вернул некорректный токен')
  }

  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
  if (!accessToken) {
    throw new Error('Сервер вернул некорректный токен')
  }

  const expiresIn =
    typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 3600
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : null

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: Date.now() + expiresIn * 1000
  }
}

async function requestToken(host: string, body: URLSearchParams): Promise<CachedToken> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS)

  try {
    const response = await fetch(tokenEndpoint(host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: controller.signal
    })

    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      const error =
        isPlainObject(payload) && typeof payload.error_description === 'string'
          ? payload.error_description
          : isPlainObject(payload) && typeof payload.error === 'string'
            ? payload.error
            : `HTTP ${response.status}`
      throw new Error(error)
    }

    return parseTokenResponse(payload)
  } finally {
    clearTimeout(timer)
  }
}

async function obtainAccessTokenUnlocked(host: string, username: string, password: string): Promise<string> {
  const key = tokenCacheKey(host, username, password)
  const cached = tokenCache.get(key)
  const now = Date.now()

  if (cached && cached.accessExpiresAt - TOKEN_SKEW_MS > now) {
    return cached.accessToken
  }

  if (cached?.refreshToken) {
    try {
      const refreshed = await requestToken(
        host,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: OWL_GUARD_CLIENT_ID,
          refresh_token: cached.refreshToken
        })
      )
      tokenCache.set(key, refreshed)
      return refreshed.accessToken
    } catch {
      tokenCache.delete(key)
    }
  }

  const issued = await requestToken(
    host,
    new URLSearchParams({
      grant_type: 'password',
      client_id: OWL_GUARD_CLIENT_ID,
      username,
      password,
      scope: OWL_GUARD_SCOPE
    })
  )
  tokenCache.set(key, issued)
  void obtainGrafanaSession(host, username, password).catch((error) => {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка'
    console.warn(`[monitoring] Grafana OIDC failed host=${host}: ${message}`)
  })
  return issued.accessToken
}

async function obtainAccessToken(host: string, username: string, password: string): Promise<string> {
  const key = tokenCacheKey(host, username, password)
  const cached = tokenCache.get(key)
  if (cached && cached.accessExpiresAt - TOKEN_SKEW_MS > Date.now()) {
    return cached.accessToken
  }

  const inflight = tokenInflight.get(key)
  if (inflight) return inflight

  const pending = obtainAccessTokenUnlocked(host, username, password).finally(() => {
    if (tokenInflight.get(key) === pending) tokenInflight.delete(key)
  })
  tokenInflight.set(key, pending)
  return pending
}

function formatVersionPayload(payload: unknown, rawText: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim()

  if (isPlainObject(payload)) {
    for (const key of ['version', 'Version', 'value', 'Value', 'result', 'Result']) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }

  if (typeof payload === 'number' && Number.isFinite(payload)) return String(payload)

  const trimmed = rawText.trim()
  if (!trimmed) throw new Error('Пустой ответ версии')
  return trimmed.replace(/^"|"$/g, '')
}

async function authorizedFetch(
  request: MonitoringAuthRequest,
  init: (accessToken: string) => {
    url: string
    method?: string
    body?: string
    headers?: Record<string, string>
    timeoutMs?: number
  }
): Promise<{ status: number; text: string; payload: unknown }> {
  const key = tokenCacheKey(request.host, request.username, request.password)

  const run = async (accessToken: string): Promise<{ status: number; text: string; payload: unknown }> => {
    const { url, method = 'GET', body, headers = {}, timeoutMs = API_TIMEOUT_MS } = init(accessToken)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json, text/plain, */*',
          // OWL.Guard localizes `localizedName` from Accept-Language (browser sends ru).
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
          Authorization: `Bearer ${accessToken}`,
          ...headers
        },
        body,
        signal: controller.signal
      })

      const text = await response.text()
      let payload: unknown = text
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = text
      }

      if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
      }

      return { status: response.status, text, payload }
    } finally {
      clearTimeout(timer)
    }
  }

  let accessToken = await obtainAccessToken(request.host, request.username, request.password)

  try {
    return await run(accessToken)
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
    if (status !== 401) throw error

    tokenCache.delete(key)
    accessToken = await obtainAccessToken(request.host, request.username, request.password)
    return run(accessToken)
  }
}

function normalizeAuthRequest(raw: unknown): MonitoringAuthRequest | null {
  if (!isPlainObject(raw)) return null

  const id = typeof raw.id === 'string' ? raw.id : ''
  const host = typeof raw.host === 'string' ? raw.host.trim() : ''
  const username = typeof raw.username === 'string' ? raw.username.trim() : ''
  const password = typeof raw.password === 'string' ? raw.password : ''

  if (!id || !username || !password || !isValidIPv4(host)) return null

  return { id, host, username, password }
}

function normalizePreviewRequest(raw: unknown): MonitoringPreviewRequest | null {
  const auth = normalizeAuthRequest(raw)
  if (!auth || !isPlainObject(raw) || !Array.isArray(raw.streamIds)) return null

  const streamIds = raw.streamIds
    .map((value) => parseStreamId(value))
    .filter((value): value is number => value !== null)

  if (!streamIds.length) return null

  return { ...auth, streamIds }
}

function parseStreamId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function parseCameraStreams(payload: unknown): MonitoringCameraStream[] {
  if (!Array.isArray(payload)) {
    throw new Error('Некорректный ответ списка камер')
  }

  return payload
    .filter((item): item is Record<string, unknown> => isPlainObject(item))
    .map((item) => {
      const id = parseStreamId(item.id)
      if (id === null) return null

      const stream: MonitoringCameraStream = { id }
      if (typeof item.connected === 'boolean') stream.connected = item.connected

      if (isPlainObject(item.expectedImageSize)) {
        stream.expectedImageSize = {
          ...(typeof item.expectedImageSize.width === 'number'
            ? { width: item.expectedImageSize.width }
            : {}),
          ...(typeof item.expectedImageSize.height === 'number'
            ? { height: item.expectedImageSize.height }
            : {})
        }
      }

      if (isPlainObject(item.stream)) {
        stream.stream = {
          ...(typeof item.stream.url === 'string' || item.stream.url === null
            ? { url: item.stream.url as string | null }
            : {}),
          ...(item.stream.onvif !== undefined ? { onvif: item.stream.onvif } : {}),
          ...(typeof item.stream.locationId === 'number' || item.stream.locationId === null
            ? { locationId: item.stream.locationId as number | null }
            : {})
        }
      }

      return stream
    })
    .filter((item): item is MonitoringCameraStream => item !== null)
}

function extractPayloadArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload

  if (isPlainObject(payload)) {
    for (const key of ['items', 'result', 'results', 'data', 'previews', 'value', 'streams', 'statuses']) {
      const value = payload[key]
      if (Array.isArray(value)) return value
    }

    const values = Object.values(payload)
    if (values.length > 0 && values.every((value) => value !== null && typeof value === 'object')) {
      return values
    }
  }

  return null
}

function parseArrayCount(payload: unknown, label: string): number {
  const items = extractPayloadArray(payload)
  if (items) return items.length
  throw new Error(`Некорректный ответ ${label} (${Array.isArray(payload) ? 'array' : typeof payload})`)
}

/** IDs present in preview/status list responses (treated as online). */
function parseOnlineIds(payload: unknown): number[] {
  const items = extractPayloadArray(payload)
  if (!items) return []

  const ids: number[] = []
  for (const item of items) {
    if (typeof item === 'number' || typeof item === 'string') {
      const id = parseStreamId(item)
      if (id !== null) ids.push(id)
      continue
    }
    if (!isPlainObject(item)) continue
    const id = parseStreamId(
      item.id ?? item.streamId ?? item.StreamId ?? item.cameraId ?? item.megaphoneId ?? item.MegaphoneId
    )
    if (id !== null) ids.push(id)
  }

  return [...new Set(ids)]
}

function parseMegaphones(payload: unknown): MonitoringMegaphone[] {
  if (!Array.isArray(payload)) {
    throw new Error('Некорректный ответ списка рупоров')
  }

  const megaphones: MonitoringMegaphone[] = []
  for (const item of payload) {
    if (!isPlainObject(item)) continue
    const id = parseStreamId(item.id)
    if (id === null) continue

    const megaphone = isPlainObject(item.megaphone) ? item.megaphone : null
    const addressRaw =
      megaphone && typeof megaphone.address === 'string' ? megaphone.address.trim() : ''
    const address = addressRaw || undefined
    const locationIds = Array.isArray(megaphone?.locationIds)
      ? [
          ...new Set(
            megaphone.locationIds
              .map((value) => parseStreamId(value))
              .filter((value): value is number => value !== null)
          )
        ]
      : []

    megaphones.push({ id, locationIds, ...(address ? { address } : {}) })
  }

  return megaphones
}

async function fetchOwlGuardVersion(request: MonitoringVersionRequest): Promise<MonitoringVersionResult> {
  try {
    console.log(`[monitoring] auth+version start host=${request.host} user=${request.username}`)
    const { text, payload } = await authorizedFetch(request, (accessToken) => ({
      url: versionEndpoint(request.host),
      headers: { Authorization: `Bearer ${accessToken}` }
    }))
    const version = formatVersionPayload(payload, text)
    console.log(`[monitoring] version ok host=${request.host} version=${version}`)
    return { id: request.id, host: request.host, ok: true, version }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось получить версию'
    console.warn(`[monitoring] auth+version failed host=${request.host}: ${message}`)
    return {
      id: request.id,
      host: request.host,
      ok: false,
      version: null,
      error: message
    }
  }
}

async function fetchOwlGuardStreams(request: MonitoringAuthRequest): Promise<MonitoringStreamsResult> {
  try {
    console.log(`[monitoring] streams start host=${request.host}`)
    const { payload } = await authorizedFetch(request, () => ({
      url: streamsEndpoint(request.host)
    }))
    const streams = parseCameraStreams(payload)
    console.log(`[monitoring] streams ok host=${request.host} count=${streams.length}`)
    return { id: request.id, host: request.host, ok: true, streams }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось получить список камер'
    console.warn(`[monitoring] streams failed host=${request.host}: ${message}`)
    return {
      id: request.id,
      host: request.host,
      ok: false,
      streams: [],
      error: message
    }
  }
}

function parseLocations(payload: unknown): MonitoringLocation[] {
  if (!Array.isArray(payload)) {
    throw new Error('Некорректный ответ списка локаций')
  }

  const locations: MonitoringLocation[] = []
  for (const item of payload) {
    if (!isPlainObject(item)) continue
    const id = parseStreamId(item.id)
    if (id === null) continue

    const location = isPlainObject(item.location) ? item.location : null
    const params = location && isPlainObject(location.params) ? location.params : null
    const localizedName =
      params && typeof params.localizedName === 'string' ? params.localizedName.trim() : ''
    if (!localizedName) continue

    const parentId =
      params && typeof params.parentId === 'number' && Number.isFinite(params.parentId)
        ? Math.trunc(params.parentId)
        : params && params.parentId === null
          ? null
          : undefined

    locations.push({
      id,
      localizedName,
      ...(parentId !== undefined ? { parentId } : {})
    })
  }

  return locations
}

async function fetchOwlGuardLocations(request: MonitoringAuthRequest): Promise<MonitoringLocationsResult> {
  try {
    console.log(`[monitoring] locations start host=${request.host}`)
    const { payload } = await authorizedFetch(request, () => ({
      url: locationsEndpoint(request.host)
    }))
    const locations = parseLocations(payload)
    console.log(`[monitoring] locations ok host=${request.host} count=${locations.length}`)
    return { id: request.id, host: request.host, ok: true, locations }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось получить список локаций'
    console.warn(`[monitoring] locations failed host=${request.host}: ${message}`)
    return {
      id: request.id,
      host: request.host,
      ok: false,
      locations: [],
      error: message
    }
  }
}

async function previewOwlGuardCameras(request: MonitoringPreviewRequest): Promise<MonitoringPreviewResult> {
  return withPreviewSlot(async () => {
    try {
      console.log(
        `[monitoring] preview start host=${request.host} ids=${request.streamIds.length} sample=${JSON.stringify(request.streamIds.slice(0, 5))}`
      )
      const { payload, text } = await authorizedFetch(request, () => ({
        url: previewEndpoint(request.host),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.streamIds),
        timeoutMs: PREVIEW_TIMEOUT_MS
      }))

      const onlineCount = parseArrayCount(payload, 'PreviewV2')
      const onlineIds = parseOnlineIds(payload)
      console.log(
        `[monitoring] preview ok host=${request.host} online=${onlineCount} ids=${onlineIds.length} payloadType=${Array.isArray(payload) ? 'array' : typeof payload}`
      )
      if (!Array.isArray(payload) || onlineIds.length !== onlineCount) {
        console.log(`[monitoring] preview payload preview=${text.slice(0, 240)}`)
      }
      return { id: request.id, host: request.host, ok: true, onlineCount, onlineIds }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось проверить камеры'
      console.warn(`[monitoring] preview failed host=${request.host}: ${message}`)
      return {
        id: request.id,
        host: request.host,
        ok: false,
        onlineCount: 0,
        onlineIds: [],
        error: message
      }
    }
  })
}

async function fetchOwlGuardMegaphones(request: MonitoringAuthRequest): Promise<MonitoringMegaphonesResult> {
  try {
    console.log(`[monitoring] megaphones start host=${request.host}`)
    const { payload } = await authorizedFetch(request, () => ({
      url: megaphonesEndpoint(request.host)
    }))
    const megaphones = parseMegaphones(payload)
    console.log(`[monitoring] megaphones ok host=${request.host} count=${megaphones.length}`)
    return { id: request.id, host: request.host, ok: true, megaphones }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось получить список рупоров'
    console.warn(`[monitoring] megaphones failed host=${request.host}: ${message}`)
    return { id: request.id, host: request.host, ok: false, megaphones: [], error: message }
  }
}

function parseFiniteInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return fallback
}

function parseStringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseGuardDevices(payload: unknown): MonitoringGuardDevice[] {
  if (!Array.isArray(payload)) {
    throw new Error('Некорректный ответ списка устройств')
  }

  const devices: MonitoringGuardDevice[] = []
  for (const item of payload) {
    if (!isPlainObject(item)) continue
    const id = parseStreamId(item.id)
    if (id === null) continue

    const config = isPlainObject(item.config) ? item.config : null
    const type =
      config && typeof config.type === 'string' && config.type.trim() ? config.type.trim() : ''
    const device = config && isPlainObject(config.device) ? config.device : null
    const addressRaw =
      device && typeof device.address === 'string' ? device.address.trim() : ''
    const address = addressRaw || null

    devices.push({
      id,
      type: type || '—',
      address,
      logicalAddress: parseFiniteInt(device?.logicalAddress, 0),
      useRtuOverTcp: device?.useRtuOverTcp === true,
      startRegister: parseFiniteInt(device?.startRegister, 0),
      numRegisters: parseFiniteInt(device?.numRegisters, 64),
      login: parseStringField(device?.login),
      password: parseStringField(device?.password),
      wellUid: parseStringField(device?.wellUid),
      wellBoreUid: parseStringField(device?.wellBoreUid)
    })
  }

  return devices
}

function toTelemetryProbeBody(device: MonitoringGuardDevice): MonitoringDeviceProbeBody | null {
  if (!device.address || device.type === '—') return null
  return {
    type: device.type,
    address: device.address,
    logicalAddress: device.logicalAddress,
    useRtuOverTcp: device.useRtuOverTcp,
    startRegister: device.startRegister,
    numRegisters: device.numRegisters,
    login: device.login,
    password: device.password,
    wellUid: device.wellUid,
    wellBoreUid: device.wellBoreUid
  }
}

function parseProbeConnected(payload: unknown): boolean {
  if (!isPlainObject(payload)) return false
  return payload.connected === true
}

async function fetchOwlGuardDevices(request: MonitoringAuthRequest): Promise<MonitoringDevicesResult> {
  try {
    console.log(`[monitoring] devices start host=${request.host}`)
    const { payload } = await authorizedFetch(request, () => ({
      url: devicesEndpoint(request.host)
    }))
    const devices = parseGuardDevices(payload)
    console.log(`[monitoring] devices ok host=${request.host} count=${devices.length}`)
    return { id: request.id, host: request.host, ok: true, devices }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось получить список устройств'
    console.warn(`[monitoring] devices failed host=${request.host}: ${message}`)
    return { id: request.id, host: request.host, ok: false, devices: [], error: message }
  }
}

async function probeOwlGuardDevices(
  request: MonitoringDeviceProbeRequest
): Promise<MonitoringDeviceProbeResult> {
  return withPreviewSlot(async () => {
    try {
      console.log(`[monitoring] device probe start host=${request.host} count=${request.devices.length}`)
      const onlineIds: number[] = []

      await mapPool(request.devices, PREVIEW_CONCURRENCY, async (device) => {
        const body = toTelemetryProbeBody(device)
        if (!body) return

        try {
          const { payload } = await authorizedFetch(request, () => ({
            url: telemetryProbeEndpoint(request.host),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            timeoutMs: PREVIEW_TIMEOUT_MS
          }))
          if (parseProbeConnected(payload)) onlineIds.push(device.id)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'probe failed'
          console.warn(
            `[monitoring] device probe item failed host=${request.host} id=${device.id}: ${message}`
          )
        }
      })

      const uniqueOnlineIds = [...new Set(onlineIds)]
      console.log(
        `[monitoring] device probe ok host=${request.host} online=${uniqueOnlineIds.length}/${request.devices.length}`
      )
      return {
        id: request.id,
        host: request.host,
        ok: true,
        onlineCount: uniqueOnlineIds.length,
        onlineIds: uniqueOnlineIds
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось проверить устройства'
      console.warn(`[monitoring] device probe failed host=${request.host}: ${message}`)
      return {
        id: request.id,
        host: request.host,
        ok: false,
        onlineCount: 0,
        onlineIds: [],
        error: message
      }
    }
  })
}

function normalizeDeviceProbeRequest(raw: unknown): MonitoringDeviceProbeRequest | null {
  const auth = normalizeAuthRequest(raw)
  if (!auth || !isPlainObject(raw) || !Array.isArray(raw.devices)) return null

  const devices = normalizeGuardDevicesForProbe(raw.devices)
  if (!devices.length) return null
  return { ...auth, devices }
}

function normalizeGuardDevicesForProbe(value: unknown[]): MonitoringGuardDevice[] {
  const devices: MonitoringGuardDevice[] = []
  for (const item of value) {
    if (!isPlainObject(item)) continue
    const id = parseStreamId(item.id)
    if (id === null) continue
    const type = typeof item.type === 'string' && item.type.trim() ? item.type.trim() : ''
    const address =
      typeof item.address === 'string' && item.address.trim() ? item.address.trim() : null
    if (!type || !address) continue

    devices.push({
      id,
      type,
      address,
      logicalAddress: parseFiniteInt(item.logicalAddress, 0),
      useRtuOverTcp: item.useRtuOverTcp === true,
      startRegister: parseFiniteInt(item.startRegister, 0),
      numRegisters: parseFiniteInt(item.numRegisters, 64),
      login: parseStringField(item.login),
      password: parseStringField(item.password),
      wellUid: parseStringField(item.wellUid),
      wellBoreUid: parseStringField(item.wellBoreUid)
    })
  }
  return devices
}

async function fetchOwlGuardMegaphoneStatuses(
  request: MonitoringAuthRequest
): Promise<MonitoringMegaphoneStatusesResult> {
  return withPreviewSlot(async () => {
    try {
      console.log(`[monitoring] megaphone statuses start host=${request.host}`)
      const { payload, text } = await authorizedFetch(request, () => ({
        url: megaphoneStatusesEndpoint(request.host),
        timeoutMs: PREVIEW_TIMEOUT_MS
      }))
      const onlineCount = parseArrayCount(payload, 'Megaphone/statuses/V2')
      const onlineIds = parseOnlineIds(payload)
      console.log(
        `[monitoring] megaphone statuses ok host=${request.host} online=${onlineCount} ids=${onlineIds.length}`
      )
      if (!Array.isArray(payload) || onlineIds.length !== onlineCount) {
        console.log(`[monitoring] megaphone statuses payload preview=${text.slice(0, 240)}`)
      }
      return { id: request.id, host: request.host, ok: true, onlineCount, onlineIds }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось получить статусы рупоров'
      console.warn(`[monitoring] megaphone statuses failed host=${request.host}: ${message}`)
      return {
        id: request.id,
        host: request.host,
        ok: false,
        onlineCount: 0,
        onlineIds: [],
        error: message
      }
    }
  })
}

function invalidAuthResult(rawRequest: unknown): Pick<MonitoringAuthRequest, 'id' | 'host'> {
  return {
    id: isPlainObject(rawRequest) && typeof rawRequest.id === 'string' ? rawRequest.id : '',
    host: isPlainObject(rawRequest) && typeof rawRequest.host === 'string' ? rawRequest.host : ''
  }
}

export function setupMonitoring(): void {
  ipcMain.handle('monitoring:ping', async (_, rawTargets: unknown): Promise<MonitoringPingResult[]> => {
    const targets = normalizeHostTargets<MonitoringPingTarget>(rawTargets)
    return mapPool(targets, PING_CONCURRENCY, pingTarget)
  })

  ipcMain.handle('monitoring:http-probe', async (_, rawTargets: unknown): Promise<MonitoringHttpResult[]> => {
    const targets = normalizeHostTargets<MonitoringHttpTarget>(rawTargets)
    return mapPool(targets, HTTP_PROBE_CONCURRENCY, probeHttpTarget)
  })

  ipcMain.handle(
    'monitoring:fetch-version',
    async (_, rawRequest: unknown): Promise<MonitoringVersionResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          version: null,
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardVersion(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-server-resources',
    async (_, rawRequest: unknown): Promise<MonitoringServerResourcesResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          cpuLoad: null,
          cpuTempC: null,
          gpuLoad: null,
          gpuTempC: null,
          ramLoad: null,
          checkedAt: Date.now(),
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchGrafanaServerResources(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-streams',
    async (_, rawRequest: unknown): Promise<MonitoringStreamsResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          streams: [],
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardStreams(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-locations',
    async (_, rawRequest: unknown): Promise<MonitoringLocationsResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          locations: [],
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardLocations(request)
    }
  )

  ipcMain.handle(
    'monitoring:preview-cameras',
    async (_, rawRequest: unknown): Promise<MonitoringPreviewResult> => {
      const request = normalizePreviewRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          onlineCount: 0,
          onlineIds: [],
          error: 'Некорректные данные для проверки камер'
        }
      }

      return previewOwlGuardCameras(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-megaphones',
    async (_, rawRequest: unknown): Promise<MonitoringMegaphonesResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          megaphones: [],
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardMegaphones(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-megaphone-statuses',
    async (_, rawRequest: unknown): Promise<MonitoringMegaphoneStatusesResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          onlineCount: 0,
          onlineIds: [],
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardMegaphoneStatuses(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-devices',
    async (_, rawRequest: unknown): Promise<MonitoringDevicesResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          devices: [],
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardDevices(request)
    }
  )

  ipcMain.handle(
    'monitoring:probe-devices',
    async (_, rawRequest: unknown): Promise<MonitoringDeviceProbeResult> => {
      const request = normalizeDeviceProbeRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          onlineCount: 0,
          onlineIds: [],
          error: 'Некорректные данные для проверки устройств'
        }
      }

      return probeOwlGuardDevices(request)
    }
  )
}
