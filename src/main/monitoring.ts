/**
 * Main-process ICMP ping + HTTP probe batch IPC used by the Monitoring tool.
 */
import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import type {
  MonitoringAuthRequest,
  MonitoringCameraStream,
  MonitoringCountResult,
  MonitoringHttpResult,
  MonitoringHttpTarget,
  MonitoringPingResult,
  MonitoringPingTarget,
  MonitoringPreviewRequest,
  MonitoringPreviewResult,
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
const PREVIEW_TIMEOUT_MS = 45000
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
      label: typeof target.label === 'string' ? target.label : ''
    }))
    .filter((target) => target.id && target.label && isValidIPv4(target.host)) as T[]
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
    execFile(
      'ping',
      getPingArgs(target.host),
      { timeout: PING_TIMEOUT_MS * PING_COUNT + 3000, encoding: 'buffer' },
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
            sentCount: PING_COUNT,
            checkedAt: Date.now()
          })
          return
        }

        if (!error) {
          resolve({
            ...target,
            status: 'online',
            latencyMs: null,
            replyCount: PING_COUNT,
            sentCount: PING_COUNT,
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
          sentCount: PING_COUNT,
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

function megaphoneStatusesEndpoint(host: string): string {
  return `http://${host}/gateway/Megaphone/statuses/V2`
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

function parseArrayCount(payload: unknown, label: string): number {
  if (Array.isArray(payload)) return payload.length

  if (isPlainObject(payload)) {
    for (const key of ['items', 'result', 'results', 'data', 'previews', 'value', 'streams', 'statuses']) {
      const value = payload[key]
      if (Array.isArray(value)) return value.length
    }

    const values = Object.values(payload)
    if (values.length > 0 && values.every((value) => value !== null && typeof value === 'object')) {
      return values.length
    }
  }

  throw new Error(`Некорректный ответ ${label} (${Array.isArray(payload) ? 'array' : typeof payload})`)
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
      console.log(
        `[monitoring] preview ok host=${request.host} online=${onlineCount} payloadType=${Array.isArray(payload) ? 'array' : typeof payload}`
      )
      if (!Array.isArray(payload)) {
        console.log(`[monitoring] preview payload preview=${text.slice(0, 240)}`)
      }
      return { id: request.id, host: request.host, ok: true, onlineCount }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось проверить камеры'
      console.warn(`[monitoring] preview failed host=${request.host}: ${message}`)
      return {
        id: request.id,
        host: request.host,
        ok: false,
        onlineCount: 0,
        error: message
      }
    }
  })
}

async function fetchOwlGuardMegaphones(request: MonitoringAuthRequest): Promise<MonitoringCountResult> {
  try {
    console.log(`[monitoring] megaphones start host=${request.host}`)
    const { payload } = await authorizedFetch(request, () => ({
      url: megaphonesEndpoint(request.host)
    }))
    const count = parseArrayCount(payload, 'megaphones')
    console.log(`[monitoring] megaphones ok host=${request.host} count=${count}`)
    return { id: request.id, host: request.host, ok: true, count }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось получить список рупоров'
    console.warn(`[monitoring] megaphones failed host=${request.host}: ${message}`)
    return { id: request.id, host: request.host, ok: false, count: 0, error: message }
  }
}

async function fetchOwlGuardMegaphoneStatuses(request: MonitoringAuthRequest): Promise<MonitoringCountResult> {
  return withPreviewSlot(async () => {
    try {
      console.log(`[monitoring] megaphone statuses start host=${request.host}`)
      const { payload } = await authorizedFetch(request, () => ({
        url: megaphoneStatusesEndpoint(request.host),
        timeoutMs: PREVIEW_TIMEOUT_MS
      }))
      const count = parseArrayCount(payload, 'Megaphone/statuses/V2')
      console.log(`[monitoring] megaphone statuses ok host=${request.host} count=${count}`)
      return { id: request.id, host: request.host, ok: true, count }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось получить статусы рупоров'
      console.warn(`[monitoring] megaphone statuses failed host=${request.host}: ${message}`)
      return { id: request.id, host: request.host, ok: false, count: 0, error: message }
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
    'monitoring:preview-cameras',
    async (_, rawRequest: unknown): Promise<MonitoringPreviewResult> => {
      const request = normalizePreviewRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          onlineCount: 0,
          error: 'Некорректные данные для проверки камер'
        }
      }

      return previewOwlGuardCameras(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-megaphones',
    async (_, rawRequest: unknown): Promise<MonitoringCountResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          count: 0,
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardMegaphones(request)
    }
  )

  ipcMain.handle(
    'monitoring:fetch-megaphone-statuses',
    async (_, rawRequest: unknown): Promise<MonitoringCountResult> => {
      const request = normalizeAuthRequest(rawRequest)
      if (!request) {
        return {
          ...invalidAuthResult(rawRequest),
          ok: false,
          count: 0,
          error: 'Некорректные данные для авторизации'
        }
      }

      return fetchOwlGuardMegaphoneStatuses(request)
    }
  )
}
