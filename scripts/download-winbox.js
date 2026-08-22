#!/usr/bin/env node
// Downloads the current WinBox for Windows from MikroTik into resources/winbox/
// Usage:
//   node scripts/download-winbox.js
//   WINBOX_DOWNLOAD_VERSION=4.3 node scripts/download-winbox.js   # pin, skip live lookup

const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')
const https = require('https')
const AdmZip = require('adm-zip')

const OUT_DIR = join(__dirname, '..', 'resources', 'winbox')
const WINBOX_PAGE = 'https://mikrotik.com/download/winbox'
const WINBOX_CDN_BASE = 'https://download.mikrotik.com/routeros/winbox'
const FALLBACK_VERSIONS = ['4.3', '4.2', '4.1']
const BINARY_IDLE_MS = 45_000
const BINARY_TOTAL_MS = 300_000
const MAX_REDIRECTS = 5
const MAX_ATTEMPTS = 3
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function downloadBuffer(url, headers, { idleMs = 15_000, totalMs = 30_000 } = {}) {
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
        if (res.statusCode !== 200) {
          res.resume()
          finish(new Error(`HTTP ${res.statusCode} for ${current}`))
          return
        }

        const chunks = []
        let idle = setTimeout(() => req.destroy(new Error('IDLE')), idleMs)
        res.on('data', (chunk) => {
          chunks.push(chunk)
          clearTimeout(idle)
          idle = setTimeout(() => req.destroy(new Error('IDLE')), idleMs)
        })
        res.on('end', () => {
          clearTimeout(idle)
          finish(null, Buffer.concat(chunks))
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
  const buf = await downloadBuffer(url, BROWSER_HEADERS)
  return buf.toString('utf8')
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

async function downloadFileWithRetry(url) {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) console.log(`  Retry ${attempt}/${MAX_ATTEMPTS}…`)
      const buf = await downloadBuffer(url, BINARY_HEADERS, {
        idleMs: BINARY_IDLE_MS,
        totalMs: BINARY_TOTAL_MS
      })
      if (!buf || buf.length === 0) throw new Error('Empty response')
      return buf
    } catch (err) {
      lastError = err
      console.warn(`  Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`)
      if (!isTransientDownloadError(err) || attempt === MAX_ATTEMPTS) break
      await sleep(1500 * attempt)
    }
  }
  throw lastError
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'knowhub-winbox-'))

  try {
    let zipBuf = null
    const tried = []
    for (const version of versions) {
      const url = `${WINBOX_CDN_BASE}/${version}/WinBox_Windows.zip`
      tried.push(version)
      console.log(`WinBox ZIP (version ${version}): ${url}`)
      try {
        console.log('  Downloading archive…')
        zipBuf = await downloadFileWithRetry(url)
        console.log(`  Downloaded ${(zipBuf.length / 1024 / 1024).toFixed(1)} MB`)
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
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('download-winbox failed:', err.message)
  process.exit(1)
})
