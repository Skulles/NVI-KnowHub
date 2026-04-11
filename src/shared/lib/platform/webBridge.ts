import type { PlatformBridge } from './index'
import {
  formatFailedFetchError,
  NETWORK_FETCH_FAILED_MESSAGE,
} from './formatFailedFetchError'

function toArrayBuffer(payload: Uint8Array) {
  const copy = new Uint8Array(payload.byteLength)
  copy.set(payload)
  return copy.buffer
}

export function createWebPlatformBridge(): PlatformBridge {
  return {
    runtime: 'web',
    openExternal(url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    async downloadBinary(url, options) {
      let response
      try {
        response = await fetch(url, {
          headers: options?.headers,
        })
      } catch {
        throw new Error(NETWORK_FETCH_FAILED_MESSAGE)
      }

      if (!response.ok) {
        throw new Error(`Failed to download snapshot: ${response.status}`)
      }

      const totalHeader = response.headers.get('content-length')
      const total = totalHeader ? Number(totalHeader) : null

      if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        options?.onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength })
        return bytes
      }

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        if (value) {
          chunks.push(value)
          loaded += value.byteLength
          options?.onProgress?.({ loaded, total })
        }
      }

      const bytes = new Uint8Array(loaded)
      let offset = 0

      chunks.forEach((chunk) => {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      })

      return bytes
    },
    async requestJson(url, init) {
      let response
      try {
        response = await fetch(url, init)
      } catch {
        throw new Error(NETWORK_FETCH_FAILED_MESSAGE)
      }
      const text = await response.text()

      if (!response.ok) {
        throw new Error(formatFailedFetchError(response.status, url, text))
      }

      if (response.status === 204) {
        return undefined as never
      }

      return (text ? JSON.parse(text) : null) as never
    },
    async uploadBinary(url, payload, init) {
      let response
      try {
        response = await fetch(url, {
          method: init?.method ?? 'POST',
          headers: init?.headers,
          body: toArrayBuffer(payload),
        })
      } catch {
        throw new Error(NETWORK_FETCH_FAILED_MESSAGE)
      }
      const text = await response.text()

      if (!response.ok) {
        throw new Error(formatFailedFetchError(response.status, url, text))
      }

      return (text ? JSON.parse(text) : null) as {
        browser_download_url: string
        name: string
      }
    },
    async computeChecksum(payload) {
      const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(payload))
      const bytes = new Uint8Array(digest)
      return Array.from(bytes)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
    },
  }
}
