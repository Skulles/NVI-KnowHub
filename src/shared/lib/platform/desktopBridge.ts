import type { PlatformBridge } from './index'
import {
  formatFailedFetchError,
  NETWORK_FETCH_FAILED_MESSAGE,
} from './formatFailedFetchError'
import { createWebPlatformBridge } from './webBridge'

type NetRequestPayload = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | null
  kind: 'json' | 'binary' | 'upload-json'
}

export type MikroTikDiscoveryStatus = 'idle' | 'listening' | 'error'

export type MikroTikDiscoveredDevice = {
  id: string
  identity: string | null
  mac: string | null
  ipv4: string | null
  ipv6: string | null
  version: string | null
  platform: string | null
  board: string | null
  interfaceName: string | null
  softwareId: string | null
  uptimeSeconds: number | null
  address: string | null
  lastSeen: string
}

export type MikroTikDiscoverySnapshot = {
  status: MikroTikDiscoveryStatus
  lastError: string | null
  devices: MikroTikDiscoveredDevice[]
}

type DesktopMikroTikDiscoveryApi = {
  start: () => Promise<MikroTikDiscoverySnapshot>
  stop: () => Promise<MikroTikDiscoverySnapshot>
  getSnapshot: () => Promise<MikroTikDiscoverySnapshot>
  onSnapshot: (callback: (snapshot: MikroTikDiscoverySnapshot) => void) => () => void
}

export type MacTelnetPhase =
  | 'idle'
  | 'discovering'
  | 'authenticating'
  | 'connected'
  | 'closed'

export type MacTelnetEvent =
  | { type: 'phase'; phase: MacTelnetPhase; authMode?: 'md5' | 'ec-srp'; reason?: string | null }
  | { type: 'interface-try'; interface: string }
  | { type: 'interface-use'; interface: string; address: string }
  | { type: 'interface-skip'; interface: string; reason: string }
  | { type: 'error'; message: string }
  | { type: 'closed'; remote?: boolean }
  | { type: string; [key: string]: unknown }

export type MacTelnetConnectRequest = {
  dstMac: string
  username?: string
  password?: string
  cols?: number
  rows?: number
  term?: string
}

type DesktopMacTelnetApi = {
  connect: (payload: MacTelnetConnectRequest) => Promise<{ sessionId: number }>
  sendInput: (payload: { sessionId: number; data: string }) => Promise<boolean>
  resize: (payload: { sessionId: number; cols: number; rows: number }) => Promise<boolean>
  disconnect: (payload: { sessionId: number }) => Promise<boolean>
  onData: (
    callback: (payload: { sessionId: number; data: string }) => void,
  ) => () => void
  onEvent: (
    callback: (payload: { sessionId: number; event: MacTelnetEvent }) => void,
  ) => () => void
}

type NetRequestResult =
  | { ok: true; status: number; data: unknown }
  | { ok: true; status: 204; data: null }
  | { ok: true; status: number; buffer: Uint8Array }
  | {
      ok: false
      status: number
      text?: string
      errorText?: string
      networkError?: boolean
    }

declare global {
  interface Window {
    desktopNet?: {
      request: (payload: NetRequestPayload) => Promise<NetRequestResult>
    }
    desktopMikrotikDiscovery?: DesktopMikroTikDiscoveryApi
    desktopMacTelnet?: DesktopMacTelnetApi
  }
}

export function getDesktopMikroTikDiscovery(): DesktopMikroTikDiscoveryApi | null {
  return window.desktopMikrotikDiscovery ?? null
}

export function getDesktopMacTelnet(): DesktopMacTelnetApi | null {
  return window.desktopMacTelnet ?? null
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {}
  }
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return { ...headers }
}

function normalizeRequestBody(body: RequestInit['body']): string | Uint8Array | null {
  if (body == null) {
    return null
  }
  if (typeof body === 'string') {
    return body
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  if (body instanceof Uint8Array) {
    return body
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  throw new Error('Unsupported request body type for desktop bridge')
}

export function createDesktopPlatformBridge(
  overrides: Partial<PlatformBridge> = {},
): PlatformBridge {
  const webBridge = createWebPlatformBridge()
  const net = window.desktopNet
  if (!net) {
    throw new Error('desktopNet is missing (preload not loaded?)')
  }

  return {
    ...webBridge,
    runtime: 'desktop',
    async requestJson(url, init) {
      const result = await net.request({
        url,
        method: init?.method,
        headers: headersToRecord(init?.headers),
        body: normalizeRequestBody(init?.body ?? null),
        kind: 'json',
      })
      if (!result.ok) {
        if ('networkError' in result && result.networkError) {
          throw new Error(NETWORK_FETCH_FAILED_MESSAGE)
        }
        throw new Error(
          formatFailedFetchError(result.status, url, result.text ?? ''),
        )
      }
      if (result.status === 204) {
        return undefined as never
      }
      if (!('data' in result)) {
        throw new Error(`HTTP ${result.status}: ${url}`)
      }
      return result.data as never
    },
    async downloadBinary(url, options) {
      const result = await net.request({
        url,
        method: 'GET',
        headers: headersToRecord(options?.headers),
        body: null,
        kind: 'binary',
      })
      if (!result.ok || !('buffer' in result)) {
        if ('networkError' in result && result.networkError) {
          throw new Error(NETWORK_FETCH_FAILED_MESSAGE)
        }
        throw new Error(
          formatFailedFetchError(
            result.status,
            url,
            'errorText' in result && result.errorText
              ? String(result.errorText)
              : '',
          ),
        )
      }
      options?.onProgress?.({
        loaded: result.buffer.byteLength,
        total: result.buffer.byteLength,
      })
      return result.buffer
    },
    async uploadBinary(url, payload, init) {
      const result = await net.request({
        url,
        method: init?.method ?? 'POST',
        headers: headersToRecord(init?.headers),
        body: payload,
        kind: 'upload-json',
      })
      if (!result.ok || !('data' in result)) {
        if ('networkError' in result && result.networkError) {
          throw new Error(NETWORK_FETCH_FAILED_MESSAGE)
        }
        const detail =
          result.ok === false
            ? String(result.errorText ?? result.text ?? '')
            : ''
        throw new Error(
          formatFailedFetchError(result.status, url, detail),
        )
      }
      return result.data as {
        browser_download_url: string
        name: string
      }
    },
    ...overrides,
  }
}
