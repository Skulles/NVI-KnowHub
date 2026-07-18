/**
 * Seeds and syncs knowledge-base HTML into userData/content from
 * KNOWHUB_SERVER_URL; exposes getManifest / getArticleHtml for IPC.
 */
import { app, BrowserWindow, net } from 'electron'
import { join, dirname } from 'path'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import type { ContentManifest } from '../shared/types'
import { flattenManifestItems } from '../shared/manifest'
import { resolveContentHtmlPath } from './safe'
import { logger } from './logger'

const FETCH_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024

function serverUrl(): string | null {
  const raw = process.env['KNOWHUB_SERVER_URL']?.trim()
  if (!raw) {
    if (app.isPackaged) {
      logger.error('Content sync: KNOWHUB_SERVER_URL is not set in packaged build')
      return null
    }
    return 'http://localhost:3000'
  }

  if (app.isPackaged) {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== 'https:') {
        logger.error(`Content sync: packaged builds require HTTPS server URL, got ${parsed.protocol}`)
        return null
      }
    } catch {
      logger.error(`Content sync: invalid KNOWHUB_SERVER_URL: ${raw}`)
      return null
    }
  }

  return raw.replace(/\/+$/, '')
}

function getContentDir(): string {
  return join(app.getPath('userData'), 'content')
}

function getManifestPath(): string {
  return join(getContentDir(), 'manifest.json')
}

function ensureContentDir(): void {
  const dir = getContentDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function safeHtmlPath(htmlFile: string): string | null {
  return resolveContentHtmlPath(getContentDir(), htmlFile)
}

export function getManifest(): ContentManifest | null {
  ensureContentDir()
  const manifestPath = getManifestPath()
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ContentManifest
  } catch {
    return null
  }
}

export function getArticleHtml(htmlFile: string): string | null {
  const filePath = safeHtmlPath(htmlFile)
  if (!filePath || !existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function fetchWithLimit(url: string, asJson: false): Promise<string>
function fetchWithLimit<T>(url: string, asJson: true): Promise<T>
function fetchWithLimit(url: string, asJson: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    let data = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        request.abort()
      } catch {
        /* ignore */
      }
      reject(new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms for ${url}`))
    }, FETCH_TIMEOUT_MS)

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      response.on('data', (chunk) => {
        data += chunk
        if (data.length > MAX_RESPONSE_BYTES) {
          finish(() => reject(new Error(`Response too large for ${url}`)))
          try {
            request.abort()
          } catch {
            /* ignore */
          }
        }
      })
      response.on('end', () => {
        finish(() => {
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status} for ${url}`))
            return
          }
          if (asJson) {
            try {
              resolve(JSON.parse(data))
            } catch (e) {
              reject(e)
            }
          } else {
            resolve(data)
          }
        })
      })
    })
    request.on('error', (err) => {
      finish(() => reject(err))
    })
    request.end()
  })
}

function mergeManifests(local: ContentManifest, remote: ContentManifest): ContentManifest {
  const remoteSectionIds = new Set(remote.sections.map((s) => s.id))
  const localOnlySections = local.sections.filter((s) => !remoteSectionIds.has(s.id))
  return { version: remote.version, sections: [...localOnlySections, ...remote.sections] }
}

function sendContentUpdated(window: BrowserWindow): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send('content:updated')
}

async function syncContent(window: BrowserWindow): Promise<void> {
  ensureContentDir()
  const local = getManifest()
  const baseUrl = serverUrl()
  if (!baseUrl) return

  let remote: ContentManifest
  try {
    remote = await fetchWithLimit<ContentManifest>(`${baseUrl}/content/manifest.json`, true)
  } catch (e) {
    logger.error('Content sync: failed to fetch manifest', e)
    return
  }

  const localItems = local ? flattenManifestItems(local) : []
  const localIds = new Map(localItems.map((i) => [i.id, i.version]))
  const remoteItems = flattenManifestItems(remote)
  const remoteIds = new Set(remoteItems.map((i) => i.id))

  const toDownload = remoteItems.filter(
    (item) => item.htmlFile && (!localIds.has(item.id) || localIds.get(item.id)! < item.version)
  )

  const removedHtmlFiles = localItems
    .filter((item) => item.htmlFile && !remoteIds.has(item.id))
    .map((item) => item.htmlFile!)

  const manifestChanged =
    !local ||
    remote.version !== local.version ||
    JSON.stringify(local.sections) !== JSON.stringify(remote.sections)

  if (!manifestChanged && toDownload.length === 0 && removedHtmlFiles.length === 0) {
    return
  }

  let downloadFailures = 0

  for (const item of toDownload) {
    if (!item.htmlFile) continue
    const dest = safeHtmlPath(item.htmlFile)
    if (!dest) {
      logger.warn(`Content sync: rejected unsafe htmlFile ${item.htmlFile}`)
      downloadFailures += 1
      continue
    }
    try {
      const html = await fetchWithLimit(`${baseUrl}/content/${item.htmlFile}`, false)
      const dir = dirname(dest)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(dest, html, 'utf-8')
    } catch (e) {
      downloadFailures += 1
      logger.error(`Content sync: failed to download ${item.htmlFile}`, e)
    }
  }

  if (downloadFailures > 0) {
    logger.warn(`Content sync: skipped manifest update after ${downloadFailures} download failure(s)`)
    return
  }

  for (const htmlFile of removedHtmlFiles) {
    const path = safeHtmlPath(htmlFile)
    if (!path) {
      logger.warn(`Content sync: skipped unsafe delete ${htmlFile}`)
      continue
    }
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch (e) {
      logger.error(`Content sync: failed to delete ${htmlFile}`, e)
    }
  }

  const merged = local ? mergeManifests(local, remote) : remote
  const hasLocalOnlySections = (local?.sections ?? []).some(
    (section) => !remote.sections.some((remoteSection) => remoteSection.id === section.id)
  )
  const catalog = hasLocalOnlySections ? merged : remote
  writeFileSync(getManifestPath(), JSON.stringify(catalog, null, 2), 'utf-8')
  sendContentUpdated(window)
}

function getBundledContentDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'content')
  }
  return join(__dirname, '../../resources/content')
}

function seedFromBundled(): void {
  const bundledDir = getBundledContentDir()
  if (!existsSync(bundledDir)) return

  const bundledManifestPath = join(bundledDir, 'manifest.json')
  if (!existsSync(bundledManifestPath)) return

  ensureContentDir()
  const localManifestPath = getManifestPath()

  // Dev: always mirror bundled resources so local edits show up immediately.
  if (!app.isPackaged) {
    cpSync(bundledDir, getContentDir(), { recursive: true, force: true })
    return
  }

  if (!existsSync(localManifestPath)) {
    cpSync(bundledDir, getContentDir(), { recursive: true, force: true })
    return
  }

  try {
    const local = JSON.parse(readFileSync(localManifestPath, 'utf-8')) as ContentManifest
    const bundled = JSON.parse(readFileSync(bundledManifestPath, 'utf-8')) as ContentManifest
    if ((bundled.version ?? 0) > (local.version ?? 0)) {
      cpSync(bundledDir, getContentDir(), { recursive: true, force: true })
    }
  } catch {
    cpSync(bundledDir, getContentDir(), { recursive: true, force: true })
  }
}

/** Даём рендереру успеть навесить `ipcRenderer.on('content:updated')`, иначе первое событие теряется. */
function scheduleInitialSync(window: BrowserWindow): void {
  const run = (): void => {
    void syncContent(window).catch((e) => logger.error('Content sync failed', e))
  }
  const schedule = (): void => {
    setTimeout(run, 280)
  }
  const wc = window.webContents
  if (!wc.isDestroyed() && wc.isLoadingMainFrame()) {
    wc.once('did-finish-load', schedule)
  } else {
    schedule()
  }
}

export function setupContentSync(window: BrowserWindow): void {
  seedFromBundled()
  scheduleInitialSync(window)
}
