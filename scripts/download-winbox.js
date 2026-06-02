#!/usr/bin/env node
// Downloads WinBox for Windows from MikroTik (WinBox_Windows.zip), extracts exe into resources/winbox/
// Usage: WINBOX_DOWNLOAD_VERSION=4.1 node scripts/download-winbox.js

import { mkdirSync, createWriteStream, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import AdmZip from 'adm-zip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'resources', 'winbox')
/** Подкаталог на CDN, например 4.1 → …/routeros/winbox/4.1/WinBox_Windows.zip */
const WINBOX_DOWNLOAD_VERSION =
  process.env.WINBOX_DOWNLOAD_VERSION || '4.1'

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject)
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
  const url =
    `https://download.mikrotik.com/routeros/winbox/${WINBOX_DOWNLOAD_VERSION}/WinBox_Windows.zip`
  console.log(`WinBox ZIP (version ${WINBOX_DOWNLOAD_VERSION}): ${url}`)

  const tmpDir = mkdtempSync(join(tmpdir(), 'knowhub-winbox-'))
  const zipPath = join(tmpDir, 'WinBox_Windows.zip')

  try {
    console.log('  Downloading archive…')
    await downloadFile(url, zipPath)

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
