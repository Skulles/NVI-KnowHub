import { createWebPlatformBridge } from './webBridge'

export type RuntimePlatform = 'web' | 'desktop'

export type DownloadBinaryOptions = {
  headers?: Record<string, string>
  onProgress?: (payload: { loaded: number; total: number | null }) => void
}

export type PlatformBridge = {
  runtime: RuntimePlatform
  openExternal(url: string): void
  downloadBinary(url: string, options?: DownloadBinaryOptions): Promise<Uint8Array>
  requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T>
  uploadBinary(
    url: string,
    payload: Uint8Array,
    init?: Pick<RequestInit, 'headers' | 'method'>,
  ): Promise<{
    browser_download_url: string
    name: string
  }>
  computeChecksum(payload: Uint8Array): Promise<string>
}

let activeBridge: PlatformBridge = createWebPlatformBridge()

export function setPlatformBridge(bridge: PlatformBridge) {
  activeBridge = bridge
}

export const platformBridge: PlatformBridge = {
  get runtime() {
    return activeBridge.runtime
  },
  openExternal(url) {
    activeBridge.openExternal(url)
  },
  downloadBinary(url, options) {
    return activeBridge.downloadBinary(url, options)
  },
  requestJson(url, init) {
    return activeBridge.requestJson(url, init)
  },
  uploadBinary(url, payload, init) {
    return activeBridge.uploadBinary(url, payload, init)
  },
  computeChecksum(payload) {
    return activeBridge.computeChecksum(payload)
  },
}
