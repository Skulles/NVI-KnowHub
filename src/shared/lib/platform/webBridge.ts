import type { PlatformBridge } from './index'

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
      const response = await fetch(url, {
        headers: options?.headers,
      })

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
      const response = await fetch(url, init)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`)
      }

      if (response.status === 204) {
        return undefined as never
      }

      return (await response.json()) as never
    },
    async uploadBinary(url, payload, init) {
      const response = await fetch(url, {
        method: init?.method ?? 'POST',
        headers: init?.headers,
        body: toArrayBuffer(payload),
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`)
      }

      return (await response.json()) as {
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
