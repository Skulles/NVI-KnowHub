/**
 * Parallel HTTP Range downloads for large update artifacts.
 * A cheap VPS often underfills one TCP stream (latency / per-connection
 * shaping); a few Range connections can use more of the same uplink.
 * Falls back when the server ignores Range or the file is small.
 */
import { createHash } from 'crypto'
import { closeSync, createReadStream, existsSync, ftruncateSync, openSync, unlinkSync, writeSync } from 'fs'
import { net, session, type Session } from 'electron'
import { logger } from './logger'
import {
  MIN_PARALLEL_BYTES,
  UPDATE_DOWNLOAD_CONNECTIONS,
  headerHasRange,
  parseContentRangeTotal,
  planByteRanges,
  sha512DigestEncoding
} from './parallelDownloadPlan'

export { UPDATE_DOWNLOAD_CONNECTIONS } from './parallelDownloadPlan'

export class ParallelDownloadUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParallelDownloadUnsupportedError'
  }
}

export interface UpdateProgressInfo {
  total: number
  delta: number
  transferred: number
  percent: number
  bytesPerSecond: number
}

export interface ParallelDownloadOptions {
  headers?: Record<string, unknown> | null
  sha512?: string | null
  sha2?: string | null
  cancellationToken: {
    cancelled: boolean
    onCancel?: (handler: () => void) => void
  }
  onProgress?: (info: UpdateProgressInfo) => void
}

type HeaderMap = Record<string, string>

const CHUNK_ATTEMPTS = 3
const REQUEST_IDLE_MS = 120_000
const MAX_REDIRECTS = 5
const UPDATER_SESSION = 'electron-updater'

function normalizeHeaders(headers?: Record<string, unknown> | null): HeaderMap {
  const out: HeaderMap = {}
  if (!headers) return out
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue
    out[key] = Array.isArray(value) ? String(value[value.length - 1]) : String(value)
  }
  return out
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const want = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value
  }
  return undefined
}

function throwIfCancelled(options: ParallelDownloadOptions): void {
  if (options.cancellationToken.cancelled) {
    const error = new Error('cancelled')
    error.name = 'CancellationError'
    throw error
  }
}

function unlinkQuiet(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface NetResponse {
  url: string
  status: number
  headers: HeaderMap
}

function discardBody(response: { on(event: 'data', listener: (chunk: Buffer) => void): void }): void {
  response.on('data', () => undefined)
}

function responseHeaders(raw: Record<string, string[] | string | undefined>): HeaderMap {
  const out: HeaderMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    out[key] = Array.isArray(value) ? String(value[value.length - 1]) : String(value)
  }
  return out
}

function updaterSession(): Session {
  return session.fromPartition(UPDATER_SESSION, { cache: false })
}

function requestRange(
  url: string,
  headers: HeaderMap,
  options: ParallelDownloadOptions,
  onBody: (chunk: Buffer) => void,
  expectPartial: boolean
): Promise<NetResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err: Error | null, value?: NetResponse): void => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(value as NetResponse)
    }

    const get = (current: string, hops: number): void => {
      if (hops > MAX_REDIRECTS) {
        finish(new Error(`Too many redirects for ${url}`))
        return
      }
      try {
        throwIfCancelled(options)
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)))
        return
      }

      const request = net.request({
        method: 'GET',
        url: current,
        session: updaterSession()
      })

      for (const [key, value] of Object.entries(headers)) {
        request.setHeader(key, value)
      }

      const abort = (): void => {
        try {
          request.abort()
        } catch {
          // ignore
        }
      }
      options.cancellationToken.onCancel?.(abort)

      let idle = setTimeout(() => {
        abort()
        finish(new Error('IDLE'))
      }, REQUEST_IDLE_MS)

      request.on('response', (response) => {
        const status = response.statusCode ?? 0
        const headersOut = responseHeaders(response.headers)
        const location = headerValue(headersOut, 'location')
        if (status >= 300 && status < 400 && location) {
          discardBody(response)
          abort()
          clearTimeout(idle)
          get(new URL(location, current).toString(), hops + 1)
          return
        }

        if (expectPartial && status === 200) {
          discardBody(response)
          abort()
          clearTimeout(idle)
          finish(new ParallelDownloadUnsupportedError('Server ignored Range and sent a full body'))
          return
        }

        if (status >= 400) {
          discardBody(response)
          abort()
          clearTimeout(idle)
          finish(new Error(`HTTP ${status} for ${current}`))
          return
        }

        response.on('data', (chunk) => {
          clearTimeout(idle)
          idle = setTimeout(() => {
            abort()
            finish(new Error('IDLE'))
          }, REQUEST_IDLE_MS)
          try {
            throwIfCancelled(options)
            onBody(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          } catch (err) {
            abort()
            finish(err instanceof Error ? err : new Error(String(err)))
          }
        })
        response.on('end', () => {
          clearTimeout(idle)
          finish(null, { url: current, status, headers: headersOut })
        })
        response.on('error', (err) => {
          clearTimeout(idle)
          finish(err)
        })
      })

      request.on('error', (err) => finish(err))
      request.end()
    }

    get(url, 0)
  })
}

async function hashFile(
  filePath: string,
  algorithm: 'sha512' | 'sha256',
  encoding: 'hex' | 'base64'
): Promise<string> {
  const digest = createHash(algorithm)
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return digest.digest(encoding)
}

export async function verifyDownloadedFile(
  filePath: string,
  sha512?: string | null,
  sha2?: string | null
): Promise<void> {
  if (sha512) {
    const actual = await hashFile(filePath, 'sha512', sha512DigestEncoding(sha512))
    if (actual !== sha512) {
      throw new Error(`sha512 checksum mismatch, expected ${sha512}, got ${actual}`)
    }
    return
  }
  if (sha2) {
    const actual = await hashFile(filePath, 'sha256', 'hex')
    if (actual !== sha2) {
      throw new Error(`sha256 checksum mismatch, expected ${sha2}, got ${actual}`)
    }
  }
}

async function downloadRangeToFd(
  url: string,
  headers: HeaderMap,
  start: number,
  end: number,
  fd: number,
  options: ParallelDownloadOptions,
  onBytes: (n: number) => void
): Promise<void> {
  const expected = end - start + 1
  let offset = start
  let received = 0

  const result = await requestRange(
    url,
    { ...headers, Range: `bytes=${start}-${end}` },
    options,
    (chunk) => {
      writeSync(fd, chunk, 0, chunk.length, offset)
      offset += chunk.length
      received += chunk.length
      onBytes(chunk.length)
    },
    true
  )

  if (result.status !== 206) {
    throw new Error(`HTTP ${result.status} for bytes=${start}-${end}`)
  }
  if (received !== expected) {
    throw new Error(`Chunk ${start}-${end} size mismatch: ${received}`)
  }
}

async function probeRangeSupport(
  url: string,
  headers: HeaderMap,
  options: ParallelDownloadOptions
): Promise<{ url: string; total: number }> {
  const result = await requestRange(url, { ...headers, Range: 'bytes=0-0' }, options, () => undefined, true)
  const total =
    parseContentRangeTotal(headerValue(result.headers, 'content-range')) ||
    Number.parseInt(headerValue(result.headers, 'content-length') || '', 10)
  if (!Number.isFinite(total) || total < 2) {
    throw new ParallelDownloadUnsupportedError('Could not determine file size from Content-Range')
  }
  return { url: result.url, total }
}

async function downloadChunkWithRetry(
  url: string,
  headers: HeaderMap,
  start: number,
  end: number,
  fd: number,
  options: ParallelDownloadOptions,
  onBytes: (n: number) => void
): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt += 1) {
    throwIfCancelled(options)
    try {
      await downloadRangeToFd(url, headers, start, end, fd, options, onBytes)
      return
    } catch (err) {
      lastError = err
      if (err instanceof ParallelDownloadUnsupportedError) throw err
      if (options.cancellationToken.cancelled) throw err
      if (attempt === CHUNK_ATTEMPTS) break
      logger.warn(
        `Update chunk ${start}-${end} failed (${attempt}/${CHUNK_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`
      )
      await sleep(750 * attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function downloadFileParallel(
  url: URL,
  destination: string,
  options: ParallelDownloadOptions,
  connections = UPDATE_DOWNLOAD_CONNECTIONS
): Promise<string> {
  throwIfCancelled(options)
  const headers = normalizeHeaders(options.headers)
  if (!headers['User-Agent'] && !headers['user-agent']) {
    headers['User-Agent'] = 'electron-builder'
  }
  if (!headers['Cache-Control'] && !headers['cache-control']) {
    headers['Cache-Control'] = 'no-cache'
  }

  const probe = await probeRangeSupport(url.toString(), headers, options)
  if (probe.total < MIN_PARALLEL_BYTES) {
    throw new ParallelDownloadUnsupportedError(`File too small for parallel download (${probe.total} bytes)`)
  }

  const ranges = planByteRanges(probe.total, connections)
  const concurrency = Math.min(connections, ranges.length)
  if (concurrency <= 1) {
    throw new ParallelDownloadUnsupportedError('Not enough ranges for parallel download')
  }

  logger.info(`Update download: ${concurrency} parallel Range connections (${probe.total} bytes)`)

  unlinkQuiet(destination)
  const seedFd = openSync(destination, 'w+')
  try {
    ftruncateSync(seedFd, probe.total)
  } finally {
    closeSync(seedFd)
  }

  let transferred = 0
  let lastProgress = 0
  const started = Date.now()
  const onBytes = (n: number): void => {
    transferred += n
    const now = Date.now()
    if (now - lastProgress < 250 && transferred < probe.total) return
    lastProgress = now
    const elapsed = Math.max(0.001, (now - started) / 1000)
    options.onProgress?.({
      total: probe.total,
      delta: n,
      transferred,
      percent: Math.min(100, (transferred / probe.total) * 100),
      bytesPerSecond: transferred / elapsed
    })
  }

  try {
    let next = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const index = next
        next += 1
        if (index >= ranges.length) return
        const [start, end] = ranges[index]
        const fd = openSync(destination, 'r+')
        try {
          await downloadChunkWithRetry(probe.url, headers, start, end, fd, options, onBytes)
        } finally {
          closeSync(fd)
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  } catch (err) {
    unlinkQuiet(destination)
    throw err
  }

  try {
    await verifyDownloadedFile(destination, options.sha512, options.sha2)
  } catch (err) {
    unlinkQuiet(destination)
    throw err
  }

  options.onProgress?.({
    total: probe.total,
    delta: 0,
    transferred: probe.total,
    percent: 100,
    bytesPerSecond: 0
  })
  return destination
}

export function installParallelUpdateDownloader(executor: {
  download: (url: URL, destination: string, options: ParallelDownloadOptions) => Promise<string>
}): void {
  const tagged = executor as { download: typeof executor.download; __knowhubParallel?: boolean }
  if (tagged.__knowhubParallel) return

  const original = executor.download.bind(executor)
  tagged.download = async (url, destination, options) => {
    if (headerHasRange(options.headers as Record<string, unknown> | null | undefined)) {
      return original(url, destination, options)
    }
    try {
      return await downloadFileParallel(url, destination, options)
    } catch (err) {
      if (options.cancellationToken.cancelled || (err instanceof Error && err.name === 'CancellationError')) {
        throw err
      }
      unlinkQuiet(destination)
      logger.warn(
        `Parallel update download failed, falling back to a single stream: ${err instanceof Error ? err.message : String(err)}`
      )
      return original(url, destination, options)
    }
  }
  tagged.__knowhubParallel = true
}
