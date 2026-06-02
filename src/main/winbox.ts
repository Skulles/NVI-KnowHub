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
import { tmpdir } from 'os'
import { join } from 'path'
import AdmZip from 'adm-zip'
import type { IZipEntry } from 'adm-zip'
import type { WinboxUpdateInfo } from '../shared/api'

function winboxResourcesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'winbox')
  }
  // В dev-режиме: __dirname = out/main/, ../../resources/ = корень проекта
  return join(__dirname, '../../resources/winbox')
}

/** Ожидаемое имя артефакта внутри resources/winbox/ для текущей платформы. */
export function getBundledExpectedName(): string {
  if (process.platform === 'win32') return 'WinBox64.exe'
  if (process.platform === 'darwin') return 'WinBox.app'
  return 'WinBox'
}

/** Путь к бандлу WinBox внутри ресурсов приложения. */
function getBundledPath(): string {
  return join(winboxResourcesDir(), getBundledExpectedName())
}

const WINBOX_DOWNLOAD_URL = 'https://mikrotik.com/download/winbox'
const WINBOX_CDN_BASE = 'https://download.mikrotik.com/routeros/winbox'

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

function decodeWinboxPageHtml(html: string): string {
  return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\\//g, '/')
}

function parseWinboxVersionFromPage(html: string): string {
  const data = decodeWinboxPageHtml(html)
  const anchor = data.indexOf('alt="WinBox logo"')
  const slice = anchor === -1 ? data : data.slice(anchor, anchor + 24000)
  const fromHeading = slice.match(/<h4 class="font-bold mb-4">v([\d.]+)</)
  if (fromHeading) return fromHeading[1]

  const fromComponent = data.match(/components\.software\.winbox[^]*?"version":"([\d.]+)"/)
  if (fromComponent) return fromComponent[1]

  return ''
}

function parseWinboxArtifactNamesFromPage(html: string): string[] {
  const data = decodeWinboxPageHtml(html)
  const names: string[] = []
  const re = /"name":"(WinBox[^"]+\.(?:zip|dmg))"/g
  for (let m = re.exec(data); m; m = re.exec(data)) {
    names.push(m[1])
  }
  return [...new Set(names)]
}

function artifactNamesForPlatform(platform: NodeJS.Platform, fromPage: string[]): string[] {
  const pageMatches = fromPage.filter((name) => {
    if (platform === 'win32') return /windows/i.test(name)
    if (platform === 'darwin') return name.endsWith('.dmg') || /macos|darwin/i.test(name)
    return /linux/i.test(name)
  })

  const fallback =
    platform === 'win32'
      ? ['WinBox_Windows.zip']
      : platform === 'darwin'
        ? ['WinBox.dmg', 'WinBox_macOS.zip', 'WinBox_macos.zip', 'WinBox_Darwin.zip']
        : ['WinBox_Linux.zip', 'WinBox_linux.zip', 'WinBox_Linux_x64.zip']

  return [...new Set([...pageMatches, ...fallback])]
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

function zipEntryBasename(entryName: string): string {
  return entryName.replace(/\\/g, '/').split('/').pop() ?? ''
}

async function tryFetchBinary(url: string): Promise<Buffer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: FETCH_BINARY_HEADERS
    })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function versionCandidatesForCdn(pageVersion: string): Promise<string[]> {
  return [...new Set([pageVersion, '4.1', '4.0'].filter((v): v is string => !!v))]
}

async function downloadWinboxArtifactBuffer(): Promise<{ buffer: Buffer; kind: 'zip' | 'dmg' }> {
  const page = await fetchWinboxPageStatus()
  const versions = await versionCandidatesForCdn(page.version)
  const names = artifactNamesForPlatform(process.platform, page.artifactNames)

  for (const ver of versions) {
    for (const name of names) {
      const url = `${WINBOX_CDN_BASE}/${ver}/${name}`
      const buffer = await tryFetchBinary(url)
      if (buffer) {
        return { buffer, kind: name.endsWith('.dmg') ? 'dmg' : 'zip' }
      }
    }
  }

  throw new Error('NOT_FOUND')
}

function pickWindowsExe(zip: AdmZip): IZipEntry | null {
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const byName = (want: string) =>
    entries.find((e) => zipEntryBasename(e.entryName).toLowerCase() === want.toLowerCase())
  return byName('winbox64.exe') || byName('WinBox.exe') || null
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
      zip.extractAllTo(tmp, true)
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
    return 'Нет прав на запись в папку приложения. Запустите от имени администратора или скачайте WinBox вручную со страницы MikroTik.'
  }
  if (err.message === 'NOT_FOUND') {
    return 'На сервере MikroTik не найден архив WinBox для вашей системы. Откройте страницу загрузки и установите вручную.'
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
  return new Promise((resolve) => {
    const escaped = exePath.replace(/'/g, "''")
    const ps = spawn(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-Command',
        `try { (Get-Item '${escaped}').VersionInfo.FileVersion } catch { '' }`],
      { windowsHide: true }
    )
    let out = ''
    ps.stdout.on('data', (d: Buffer) => (out += d.toString()))
    ps.on('close', () => resolve(out.trim().replace(/,/g, '.')))
    ps.on('error', () => resolve(''))
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

export function setupWinbox(): void {
  ipcMain.handle('winbox:open', async (): Promise<{ ok: boolean; error?: string }> => {
    const exePath = getBundledPath()
    if (!existsSync(exePath)) return { ok: false, error: 'not-bundled' }
    const err = await shell.openPath(exePath)
    return err ? { ok: false, error: err } : { ok: true }
  })

  ipcMain.handle('winbox:check-update', async (): Promise<WinboxUpdateInfo> => {
    const exePath = getBundledPath()
    const bundledExpectedName = getBundledExpectedName()
    const [fetchResult, local] = await Promise.all([
      fetchWinboxPageStatus(),
      getBundledVersion(exePath)
    ])
    const latest = fetchResult.version
    return {
      latest,
      local,
      hasUpdate: !!latest && !!local && versionGt(latest, local),
      bundled: existsSync(exePath),
      mikrotikOnline: fetchResult.reachable,
      bundledExpectedName
    }
  })

  ipcMain.handle('winbox:download-bundled', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const destDir = winboxResourcesDir()
      const destPath = getBundledPath()
      const artifact = await downloadWinboxArtifactBuffer()
      installWinboxFromArtifact(artifact, destDir, destPath)
      return { ok: true }
    } catch (e) {
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
