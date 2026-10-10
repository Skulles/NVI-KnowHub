/**
 * Device label from the HTTP home page. Cudy prints the model in <title>.
 */
import { request as httpRequest } from 'http'
import { isIPv4 } from './discoveryMndp'
import { decodeDiscoveryDocument, normalizeDiscoveryText } from './discoveryText'

const HTTP_TIMEOUT_MS = 800
const HTTP_LIMIT = 24_000

const TITLE_RE = /<title[^>]*>\s*([^<]{1,64}?)\s*<\/title>/i
const REFRESH_RE = /http-equiv=["']refresh["'][^>]*content=["'][^"']*?\burl=([^"'\s>;]+)/i
const REFRESH_RE_ALT = /content=["'][^"']*?\burl=([^"'\s>;]+)["'][^>]*http-equiv=["']refresh["']/i
const BORING_TITLE =
  /^(ok|home|index|index of|login|log in|sign in|web|router|admin|forbidden|404 not found|403 forbidden|document|untitled|loading|redirect|redirecting)$/i

export function httpDeviceTitle(html: string): string | null {
  const raw = html.match(TITLE_RE)?.[1]?.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim() ?? ''
  const title = normalizeDiscoveryText(raw)
  if (!title || BORING_TITLE.test(title)) return null
  return title
}

/** One same-origin path from a meta refresh. Off-box URLs are ignored. */
export function httpRefreshPath(html: string): string | null {
  const raw = (html.match(REFRESH_RE)?.[1] ?? html.match(REFRESH_RE_ALT)?.[1] ?? '').trim()
  if (!raw) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:') return null
      return `${url.pathname}${url.search}` || '/'
    } catch {
      return null
    }
  }
  return raw.startsWith('/') ? raw : `/${raw}`
}

function httpGet(ip: string, path: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.resolve('')
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: ip,
        port: 80,
        path,
        method: 'GET',
        timeout: HTTP_TIMEOUT_MS,
        headers: { Host: ip, Connection: 'close', Accept: 'text/html' }
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size <= HTTP_LIMIT) chunks.push(chunk)
        })
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          const header = res.headers['content-type']
          const contentType = Array.isArray(header) ? (header[0] ?? '') : (header ?? '')
          resolve(decodeDiscoveryDocument(body, contentType))
        })
      }
    )
    const finish = (value = ''): void => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = (): void => {
      req.destroy()
      finish()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    req.on('timeout', () => {
      req.destroy()
      finish()
    })
    req.on('error', () => finish())
    req.end()
  })
}

export async function readHttpDeviceTitle(ip: string, signal: AbortSignal): Promise<string | null> {
  if (!isIPv4(ip) || signal.aborted) return null
  const first = await httpGet(ip, '/', signal)
  const direct = httpDeviceTitle(first)
  if (direct) return direct
  const next = httpRefreshPath(first)
  if (!next || signal.aborted) return null
  return httpDeviceTitle(await httpGet(ip, next, signal))
}

export async function readHttpDeviceTitles(ips: string[], signal: AbortSignal): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const targets = [...new Set(ips.filter((ip) => isIPv4(ip)))]
  await Promise.all(
    targets.map(async (ip) => {
      const title = await readHttpDeviceTitle(ip, signal)
      if (title) found.set(ip, title)
    })
  )
  return found
}
