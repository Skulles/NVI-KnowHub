#!/usr/bin/env node
// Downloads the current WinBox for Windows from MikroTik into resources/winbox/
// Usage:
//   node scripts/download-winbox.js
//   WINBOX_DOWNLOAD_VERSION=4.3 node scripts/download-winbox.js   # pin, skip live lookup

const { mkdirSync, createWriteStream, mkdtempSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join, dirname } = require('path')
const https = require('https')
const AdmZip = require('adm-zip')

const OUT_DIR = join(__dirname, '..', 'resources', 'winbox')
const WINBOX_PAGE = 'https://mikrotik.com/download/winbox'
const WINBOX_CDN_BASE = 'https://download.mikrotik.com/routeros/winbox'
const FALLBACK_VERSIONS = ['4.3', '4.2', '4.1']
const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000, headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString()
        return httpsGet(next, headers).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      resolve(res)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)) })
  })
}

async function downloadText(url) {
  const res = await httpsGet(url, BROWSER_HEADERS)
  return new Promise((resolve, reject) => {
    const chunks = []
    res.on('data', (d) => chunks.push(d))
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    res.on('error', reject)
  })
}

async function downloadFile(url, dest) {
  const res = await httpsGet(url)
  mkdirSync(dirname(dest), { recursive: true })
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    res.pipe(file)
    file.on('finish', () => file.close(resolve))
    file.on('error', reject)
    res.on('error', reject)
  })
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
      return [version]
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
  const zipPath = join(tmpDir, 'WinBox_Windows.zip')

  try {
    let downloaded = false
    for (const version of versions) {
      const url = `${WINBOX_CDN_BASE}/${version}/WinBox_Windows.zip`
      console.log(`WinBox ZIP (version ${version}): ${url}`)
      try {
        console.log('  Downloading archive…')
        await downloadFile(url, zipPath)
        downloaded = true
        break
      } catch (err) {
        console.warn(`  ${version} failed: ${err.message}`)
      }
    }
    if (!downloaded) {
      throw new Error(`Could not download WinBox_Windows.zip (tried ${versions.join(', ')})`)
    }

    const zip = new AdmZip(zipPath)
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
