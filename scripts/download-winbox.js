#!/usr/bin/env node
// Downloads the current WinBox for Windows from MikroTik into resources/winbox/
// Usage:
//   node scripts/download-winbox.js
//   WINBOX_DOWNLOAD_VERSION=4.3 node scripts/download-winbox.js   # pin, skip live lookup
//   WINBOX_DOWNLOAD_CONNECTIONS=8 node scripts/download-winbox.js  # parallel Range requests

const { mkdirSync, writeFileSync } = require('fs')
const { join } = require('path')
const https = require('https')
const AdmZip = require('adm-zip')

const OUT_DIR = join(__dirname, '..', 'resources', 'winbox')
const WINBOX_PAGE = 'https://mikrotik.com/download/winbox'
const WINBOX_CDN_BASE = 'https://download.mikrotik.com/routeros/winbox'
const FALLBACK_VERSIONS = ['4.3', '4.2', '4.1']
const BINARY_IDLE_MS = 45_000
const BINARY_TOTAL_MS = 600_000
const MAX_REDIRECTS = 5
const MAX_ATTEMPTS = 3
const MIN_PARALLEL_BYTES = 512 * 1024
const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}
const BINARY_HEADERS = {
  Accept: '*/*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const CONNECTIONS = Math.min(16, parsePositiveInt(process.env.WINBOX_DOWNLOAD_CONNECTIONS, 8))

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function createProgress(total) {
  let loaded = 0
  let lastLog = 0
  const started = Date.now()
  return (delta) => {
    loaded += delta
    const now = Date.now()
    if (now - lastLog < 2000 && total && loaded < total) return
    lastLog = now
    const elapsed = Math.max(0.001, (now - started) / 1000)
    const speed = `${formatMb(loaded / elapsed)}/s`
    const totalLabel = total ? formatMb(total) : '? MB'
    console.log(`  ${formatMb(loaded)} / ${totalLabel}  (${speed})`)
  }
}

function downloadResult(url, headers, { idleMs = 15_000, totalMs = 30_000, onData, allowPartial = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(value)
    }

    const get = (current, hops) => {
      if (hops > MAX_REDIRECTS) {
        finish(new Error(`Too many redirects for ${url}`))
        return
      }

      const req = https.get(current, { headers }, (res) => {
        const location = res.headers.location
        if (res.statusCode >= 300 && res.statusCode < 400 && location) {
          res.resume()
          get(new URL(location, current).toString(), hops + 1)
          return
        }

        const ok = res.statusCode === 200 || (allowPartial && res.statusCode === 206)
        if (!ok) {
          res.resume()
          finish(new Error(`HTTP ${res.statusCode} for ${current}`))
          return
        }

        const chunks = []
        let idle = setTimeout(() => req.destroy(new Error('IDLE')), idleMs)
        res.on('data', (chunk) => {
          chunks.push(chunk)
          onData?.(chunk.length)
          clearTimeout(idle)
          idle = setTimeout(() => req.destroy(new Error('IDLE')), idleMs)
        })
        res.on('end', () => {
          clearTimeout(idle)
          finish(null, {
            url: current,
            status: res.statusCode,
            headers: res.headers,
            buffer: Buffer.concat(chunks)
          })
        })
        res.on('error', (err) => {
          clearTimeout(idle)
          finish(err)
        })
      })

      req.setTimeout(totalMs, () => req.destroy(new Error('TIMEOUT')))
      req.on('error', (err) => finish(err))
    }

    get(url, 0)
  })
}

async function downloadText(url) {
  const result = await downloadResult(url, BROWSER_HEADERS)
  return result.buffer.toString('utf8')
}

function isTransientDownloadError(err) {
  const message = String(err?.message || err)
  const code = err?.code
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'ECONNABORTED' ||
    /aborted|socket hang up|IDLE|TIMEOUT/i.test(message)
  )
}

function parseContentRangeTotal(header) {
  const match = String(header || '').match(/\/(\d+)\s*$/)
  return match ? Number(match[1]) : 0
}

function planRanges(total, connections) {
  const chunkSize = Math.max(MIN_PARALLEL_BYTES, Math.ceil(total / Math.max(connections * 4, 1)))
  const ranges = []
  for (let start = 0; start < total; start += chunkSize) {
    ranges.push([start, Math.min(total, start + chunkSize) - 1])
  }
  return ranges
}

async function downloadWithRetry(task, label) {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) console.log(`  Retry ${label} (${attempt}/${MAX_ATTEMPTS})…`)
      return await task()
    } catch (err) {
      lastError = err
      console.warn(`  ${label} failed: ${err.message}`)
      if (!isTransientDownloadError(err) || attempt === MAX_ATTEMPTS) break
      await sleep(1500 * attempt)
    }
  }
  throw lastError
}

async function downloadRange(url, start, end, onData) {
  const expected = end - start + 1
  const result = await downloadResult(
    url,
    { ...BINARY_HEADERS, Range: `bytes=${start}-${end}` },
    { idleMs: BINARY_IDLE_MS, totalMs: BINARY_TOTAL_MS, onData, allowPartial: true }
  )
  if (result.status === 200) {
    if (start === 0 && result.buffer.length > expected) return { full: result.buffer }
    if (result.buffer.length !== expected) {
      throw new Error(`Server ignored Range (${result.buffer.length} bytes)`)
    }
  } else if (result.buffer.length !== expected) {
    throw new Error(`Chunk ${start}-${end} size mismatch: ${result.buffer.length}`)
  }
  return { part: result.buffer, url: result.url }
}

async function probeRangeSupport(url) {
  const result = await downloadResult(
    url,
    { ...BINARY_HEADERS, Range: 'bytes=0-0' },
    { idleMs: BINARY_IDLE_MS, totalMs: 60_000, allowPartial: true }
  )
  if (result.status === 200) {
    return { url: result.url, buffer: result.buffer, total: result.buffer.length, ranges: false }
  }
  const total = parseContentRangeTotal(result.headers['content-range'])
  if (!total) {
    const length = Number.parseInt(String(result.headers['content-length'] || ''), 10)
    if (Number.isFinite(length) && length > 1) {
      return { url: result.url, buffer: null, total: length, ranges: true }
    }
    return { url: result.url, buffer: result.buffer, total: result.buffer.length, ranges: false }
  }
  return { url: result.url, buffer: null, total, ranges: true }
}

async function downloadParallel(url) {
  const probe = await probeRangeSupport(url)
  const onData = createProgress(probe.total || probe.buffer?.length || 0)
  if (probe.buffer && !probe.ranges) {
    onData(probe.buffer.length)
    return probe.buffer
  }

  const ranges = planRanges(probe.total, CONNECTIONS)
  const concurrency = Math.min(CONNECTIONS, ranges.length)
  if (concurrency <= 1) {
    const result = await downloadResult(probe.url, BINARY_HEADERS, {
      idleMs: BINARY_IDLE_MS,
      totalMs: BINARY_TOTAL_MS,
      onData
    })
    return result.buffer
  }

  console.log(`  Using ${concurrency} parallel connections (${ranges.length} chunks)`)
  const parts = new Array(ranges.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= ranges.length) return
      const [start, end] = ranges[index]
      const result = await downloadWithRetry(
        () => downloadRange(probe.url, start, end, onData),
        `chunk ${index + 1}/${ranges.length}`
      )
      if (result.full) {
        parts[0] = result
        cursor = ranges.length
        return
      }
      parts[index] = result
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const complete = parts.find((part) => part?.full)
  if (complete?.full) return complete.full

  return Buffer.concat(parts.map((part) => part.part), probe.total)
}

async function downloadFileWithRetry(url) {
  return downloadWithRetry(async () => {
    const buf = await downloadParallel(url)
    if (!buf || buf.length === 0) throw new Error('Empty response')
    return buf
  }, 'download')
}

function decodeHtml(html) {
  return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\\//g, '/')
}

function parseWinboxVersionFromPage(html) {
  const data = decodeHtml(html)
  const anchor = data.indexOf('alt="WinBox logo"')
  const slice = anchor === -1 ? data : data.slice(anchor, anchor + 24000)
  const fromHeading = slice.match(/<h4 class="font-bold mb-4">v([\d.]+)</)
  if (fromHeading) return fromHeading[1]
  const fromComponent = data.match(/components\.software\.winbox[^]*?"version":"([\d.]+)"/)
  if (fromComponent) return fromComponent[1]
  const fromCdn = data.match(/routeros\/winbox\/([\d.]+)\//)
  if (fromCdn) return fromCdn[1]
  return ''
}

async function resolveVersions() {
  if (process.env.WINBOX_DOWNLOAD_VERSION) {
    return [process.env.WINBOX_DOWNLOAD_VERSION]
  }

  try {
    console.log(`Looking up current WinBox version: ${WINBOX_PAGE}`)
    const html = await downloadText(WINBOX_PAGE)
    const version = parseWinboxVersionFromPage(html)
    if (version) {
      console.log(`  MikroTik reports WinBox ${version}`)
      return [version, ...FALLBACK_VERSIONS.filter((item) => item !== version)]
    }
    console.warn('  Could not parse version from the download page')
  } catch (err) {
    console.warn(`  Live lookup failed: ${err.message}`)
  }

  return FALLBACK_VERSIONS
}

function zipEntryBasename(entryName) {
  const n = entryName.replace(/\\/g, '/').split('/').pop() ?? ''
  return n
}

/** Предпочитаем явный winbox64.exe из архива, иначе WinBox.exe (в 4.x оба есть). */
function pickWindowsExe(zip) {
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const byName = (want) =>
    entries.find((e) => zipEntryBasename(e.entryName).toLowerCase() === want.toLowerCase())
  return byName('winbox64.exe') || byName('WinBox.exe') || null
}

async function main() {
  const versions = await resolveVersions()
  let zipBuf = null
  const tried = []
  for (const version of versions) {
    const url = `${WINBOX_CDN_BASE}/${version}/WinBox_Windows.zip`
    tried.push(version)
    console.log(`WinBox ZIP (version ${version}): ${url}`)
    try {
      console.log(`  Downloading archive…`)
      zipBuf = await downloadFileWithRetry(url)
      console.log(`  Downloaded ${formatMb(zipBuf.length)}`)
      break
    } catch (err) {
      console.warn(`  ${version} failed: ${err.message}`)
    }
  }
  if (!zipBuf) {
    throw new Error(`Could not download WinBox_Windows.zip (tried ${tried.join(', ')})`)
  }

  const zip = new AdmZip(zipBuf)
  const entry = pickWindowsExe(zip)
  if (!entry) {
    throw new Error('No WinBox.exe or winbox64.exe found inside WinBox_Windows.zip')
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const outExe = join(OUT_DIR, 'WinBox64.exe')
  writeFileSync(outExe, entry.getData())
  console.log(`  Extracted ${zipEntryBasename(entry.entryName)} → resources/winbox/WinBox64.exe ✓`)
}

main().catch((err) => {
  console.error('download-winbox failed:', err.message)
  process.exit(1)
})
