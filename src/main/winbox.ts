/**
 * WinBox install/launch helpers and IPC: bundled resources, userData copy,
 * MikroTik download, and update checks for the WinBox tool.
 */
import { ipcMain, shell, app } from 'electron'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  renameSync
} from 'fs'
import { execFileSync, spawn } from 'child_process'
import https from 'https'
import { tmpdir } from 'os'
import { join, resolve, sep, isAbsolute, relative } from 'path'
import { URL } from 'url'
import AdmZip from 'adm-zip'
import type { IZipEntry } from 'adm-zip'
import type { WinboxUpdateInfo } from '../shared/api'
import { logger } from './logger'
import {
  WINBOX_DOWNLOAD_URL,
  bundledCandidateNames,
  getBundledExpectedName,
  parseWinboxArtifactNamesFromPage,
  parseWinboxVersionFromPage,
  pickWindowsExeBasename,
  winboxCdnUrls,
  zipEntryBasename
} from './winboxArtifacts'

export { getBundledExpectedName }

/** Seeded / packaged WinBox directory (read-only when packaged). */
function winboxBundledDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'winbox')
  }
  // В dev-режиме: __dirname = out/main/, ../../resources/ = корень проекта
  return join(__dirname, '../../resources/winbox')
}

/** Writable install location — survives updates and avoids elevation on resources/. */
function winboxUserDir(): string {
  return join(app.getPath('userData'), 'winbox')
}

function winboxInstallDir(): string {
  return winboxUserDir()
}

function firstExisting(dir: string, names: string[]): string | null {
  for (const name of names) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Prefer userData install; fall back to bundled seed. Accepts legacy WinBox.exe names. */
function resolveWinboxPath(): string | null {
  const names = bundledCandidateNames()
  return firstExisting(winboxUserDir(), names) ?? firstExisting(winboxBundledDir(), names)
}

/** Copy bundled exe into userData so NSIS updates don't wipe a working install. */
function seedUserInstall(): string | null {
  const found = resolveWinboxPath()
  if (!found) return null

  const dest = join(winboxUserDir(), getBundledExpectedName())
  if (found === dest) return dest

  try {
    mkdirSync(winboxUserDir(), { recursive: true })
    if (!existsSync(dest)) {
      cpSync(found, dest, { recursive: true })
    }
    return existsSync(dest) ? dest : found
  } catch (err) {
    logger.warn('Failed to copy WinBox into userData', err)
    return found
  }
}

function isSafeZipEntryName(entryName: string, destRoot: string): boolean {
  const normalized = entryName.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0')) return false
  if (normalized.split('/').some((part) => part === '..')) return false
  const full = resolve(destRoot, normalized)
  const root = resolve(destRoot)
  const rel = relative(root, full)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel) && full.startsWith(root + sep)
}

function extractZipSafely(zip: AdmZip, destRoot: string): void {
  mkdirSync(destRoot, { recursive: true })
  for (const entry of zip.getEntries()) {
    if (!isSafeZipEntryName(entry.entryName, destRoot)) {
      throw new Error('BAD_ZIP')
    }
    const target = resolve(destRoot, entry.entryName.replace(/\\/g, '/'))
    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true })
      continue
    }
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, entry.getData())
  }
}

const FETCH_BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

const FETCH_BINARY_HEADERS = {
  Accept: '*/*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

/**
 * Страница загрузки WinBox: доступность, версия и имена файлов на CDN.
 * Используем fetch (следует редиректам); https.get без обхода 301/302 давал reachable: false.
 */
async function fetchWinboxPageStatus(): Promise<{
  version: string
  reachable: boolean
  artifactNames: string[]
}> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(WINBOX_DOWNLOAD_URL, {
      redirect: 'follow',
      signal: controller.signal,
      headers: FETCH_BROWSER_HEADERS
    })
    clearTimeout(timer)

    if (!res.ok) {
      return { version: '', reachable: false, artifactNames: [] }
    }

    const data = await res.text()
    return {
      version: parseWinboxVersionFromPage(data),
      reachable: true,
      artifactNames: parseWinboxArtifactNamesFromPage(data),
    }
  } catch {
    return { version: '', reachable: false, artifactNames: [] }
  }
}

const BINARY_IDLE_MS = 45_000
const BINARY_TOTAL_MS = 300_000

function downloadBinaryViaHttps(url: string): Promise<Buffer | null> {
  return new Promise((resolveBuffer) => {
    let settled = false
    const finish = (value: Buffer | null): void => {
      if (settled) return
      settled = true
      resolveBuffer(value)
    }

    const get = (current: string, hops: number): void => {
      if (hops > 5) {
        finish(null)
        return
      }

      const req = https.get(current, { headers: FETCH_BINARY_HEADERS }, (res) => {
        const location = res.headers.location
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
          res.resume()
          get(new URL(location, current).toString(), hops + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          finish(null)
          return
        }

        const chunks: Buffer[] = []
        let idle = setTimeout(() => req.destroy(new Error('IDLE')), BINARY_IDLE_MS)
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
          clearTimeout(idle)
          idle = setTimeout(() => req.destroy(new Error('IDLE')), BINARY_IDLE_MS)
        })
        res.on('end', () => {
          clearTimeout(idle)
          finish(Buffer.concat(chunks))
        })
        res.on('error', () => {
          clearTimeout(idle)
          finish(null)
        })
      })

      req.setTimeout(BINARY_TOTAL_MS, () => req.destroy())
      req.on('error', () => finish(null))
    }

    get(url, 0)
  })
}

async function downloadWinboxArtifactBuffer(): Promise<{ buffer: Buffer; kind: 'zip' | 'dmg' }> {
  const page = await fetchWinboxPageStatus()
  if (page.version) {
    logger.info(`WinBox latest on MikroTik: ${page.version}`)
  } else {
    logger.warn('WinBox download page did not expose a version; trying known CDN folders')
  }

  const urls = winboxCdnUrls(
    process.platform,
    process.arch,
    page.version,
    page.artifactNames
  )

  for (const url of urls) {
    logger.info(`WinBox download try ${url}`)
    const buffer = await downloadBinaryViaHttps(url)
    if (buffer && buffer.length > 0) {
      const kind = url.endsWith('.dmg') ? 'dmg' : 'zip'
      return { buffer, kind }
    }
  }

  throw new Error('NOT_FOUND')
}

function pickWindowsExe(zip: AdmZip): IZipEntry | null {
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const chosen = pickWindowsExeBasename(entries.map((e) => zipEntryBasename(e.entryName)))
  if (!chosen) return null
  return (
    entries.find(
      (e) => zipEntryBasename(e.entryName).toLowerCase() === chosen.toLowerCase()
    ) ?? null
  )
}

function pickLinuxBinary(zip: AdmZip): IZipEntry | null {
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const base = (e: IZipEntry) => zipEntryBasename(e.entryName)
  const by = (want: string) =>
    entries.find((e) => base(e).toLowerCase() === want.toLowerCase())
  return by('WinBox') || by('winbox') || null
}

function atomicWriteFile(filePath: string, data: Buffer): void {
  const tmp = `${filePath}.download-${process.pid}-${Date.now()}`
  writeFileSync(tmp, data)
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    rmSync(filePath, { recursive: true, force: true })
  }
  renameSync(tmp, filePath)
}

function installMacFromDmgBuffer(buf: Buffer, destBundledPath: string): void {
  const tmp = mkdtempSync(join(tmpdir(), 'kh-wb-'))
  const dmgPath = join(tmp, 'WinBox.dmg')
  const mountPoint = join(tmp, 'mount')
  mkdirSync(mountPoint)
  writeFileSync(dmgPath, buf)
  try {
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmgPath], {
      stdio: 'ignore',
    })
    try {
      const items = readdirSync(mountPoint)
      const appFolder = items.find((n) => n.endsWith('.app'))
      if (!appFolder) throw new Error('BAD_DMG')
      const src = join(mountPoint, appFolder)
      rmSync(destBundledPath, { recursive: true, force: true })
      cpSync(src, destBundledPath, { recursive: true })
    } finally {
      execFileSync('hdiutil', ['detach', mountPoint, '-quiet'], { stdio: 'ignore' })
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function installWinboxFromZipBuffer(buf: Buffer, destDir: string, destBundledPath: string): void {
  const zip = new AdmZip(buf)
  mkdirSync(destDir, { recursive: true })

  if (process.platform === 'win32') {
    const entry = pickWindowsExe(zip)
    if (!entry) throw new Error('BAD_ZIP')
    atomicWriteFile(destBundledPath, entry.getData())
    return
  }

  if (process.platform === 'darwin') {
    const tmp = mkdtempSync(join(tmpdir(), 'kh-wb-'))
    try {
      extractZipSafely(zip, tmp)
      const items = readdirSync(tmp)
      const appFolder = items.find((n) => n.endsWith('.app'))
      if (!appFolder) throw new Error('BAD_ZIP')
      const src = join(tmp, appFolder)
      rmSync(destBundledPath, { recursive: true, force: true })
      cpSync(src, destBundledPath, { recursive: true })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    return
  }

  const entry = pickLinuxBinary(zip)
  if (!entry) throw new Error('BAD_ZIP')
  atomicWriteFile(destBundledPath, entry.getData())
  try {
    chmodSync(destBundledPath, 0o755)
  } catch {
    /* ignore */
  }
}

function installWinboxFromArtifact(
  artifact: { buffer: Buffer; kind: 'zip' | 'dmg' },
  destDir: string,
  destBundledPath: string,
): void {
  if (artifact.kind === 'dmg') {
    mkdirSync(destDir, { recursive: true })
    installMacFromDmgBuffer(artifact.buffer, destBundledPath)
    return
  }
  installWinboxFromZipBuffer(artifact.buffer, destDir, destBundledPath)
}

function humanDownloadError(err: unknown): string {
  if (!(err instanceof Error)) return 'Не удалось загрузить WinBox.'
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') {
    return 'Нет прав на запись в данные приложения. Скачайте WinBox вручную со страницы MikroTik.'
  }
  if (err.message === 'NOT_FOUND') {
    return 'На сервере MikroTik не найден архив WinBox для вашей системы. Откройте страницу загрузки и установите вручную.'
  }
  if (err.message === 'TIMEOUT') {
    return 'Превышено время ожидания при загрузке. Проверьте интернет и повторите попытку.'
  }
  if (err.message === 'BAD_ZIP') {
    return 'Архив WinBox не удалось разобрать. Попробуйте позже или скачайте вручную.'
  }
  if (err.message === 'BAD_DMG') {
    return 'Образ WinBox (.dmg) не удалось разобрать. Попробуйте позже или скачайте вручную.'
  }
  if (err.name === 'AbortError') {
    return 'Превышено время ожидания при загрузке. Проверьте интернет и повторите попытку.'
  }
  return 'Не удалось загрузить WinBox. Проверьте интернет и повторите попытку.'
}

function getBundledVersion(exePath: string): Promise<string> {
  if (process.platform !== 'win32' || !existsSync(exePath)) {
    return Promise.resolve('')
  }
  return new Promise((resolveVersion) => {
    const escaped = exePath.replace(/'/g, "''")
    const ps = spawn(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-Command',
        `try { (Get-Item '${escaped}').VersionInfo.FileVersion } catch { '' }`],
      { windowsHide: true }
    )
    let settled = false
    const finish = (value: string): void => {
      if (settled) return
      settled = true
      resolveVersion(value)
    }
    const timer = setTimeout(() => {
      try {
        ps.kill()
      } catch {
        /* ignore */
      }
      finish('')
    }, 5000)
    let out = ''
    ps.stdout.on('data', (d: Buffer) => (out += d.toString()))
    ps.on('close', () => {
      clearTimeout(timer)
      finish(out.trim().replace(/,/g, '.'))
    })
    ps.on('error', () => {
      clearTimeout(timer)
      finish('')
    })
  })
}

function versionGt(a: string, b: string): boolean {
  const ap = a.split('.').map(Number)
  const bp = b.split('.').map(Number)
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const av = ap[i] ?? 0
    const bv = bp[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return false
}

function localStatus(): { bundled: boolean; bundledExpectedName: string } {
  const bundledExpectedName = getBundledExpectedName()
  const seeded = seedUserInstall()
  return {
    bundled: !!seeded && existsSync(seeded),
    bundledExpectedName
  }
}

export function setupWinbox(): void {
  ipcMain.handle('winbox:open', async (): Promise<{ ok: boolean; error?: string }> => {
    const exePath = seedUserInstall()
    if (!exePath || !existsSync(exePath)) return { ok: false, error: 'not-bundled' }
    const err = await shell.openPath(exePath)
    return err ? { ok: false, error: err } : { ok: true }
  })

  /** Быстрый локальный статус без сети — для кнопки «Открыть» / «Загрузить». */
  ipcMain.handle(
    'winbox:get-local-status',
    (): { bundled: boolean; bundledExpectedName: string } => localStatus()
  )

  ipcMain.handle('winbox:check-update', async (): Promise<WinboxUpdateInfo> => {
    const status = localStatus()
    const exePath = seedUserInstall() ?? join(winboxBundledDir(), status.bundledExpectedName)
    const [fetchResult, local] = await Promise.all([
      fetchWinboxPageStatus(),
      getBundledVersion(exePath)
    ])
    const latest = fetchResult.version
    return {
      latest,
      local,
      hasUpdate: !!latest && !!local && versionGt(latest, local),
      bundled: status.bundled,
      mikrotikOnline: fetchResult.reachable,
      bundledExpectedName: status.bundledExpectedName
    }
  })

  ipcMain.handle('winbox:download-bundled', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const destDir = winboxInstallDir()
      const destPath = join(destDir, getBundledExpectedName())
      const artifact = await downloadWinboxArtifactBuffer()
      installWinboxFromArtifact(artifact, destDir, destPath)
      return { ok: true }
    } catch (e) {
      logger.error('WinBox download failed', e)
      return { ok: false, error: humanDownloadError(e) }
    }
  })

  ipcMain.handle('winbox:open-download-page', async (): Promise<{ ok: boolean }> => {
    try {
      await shell.openExternal(WINBOX_DOWNLOAD_URL)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })
}
