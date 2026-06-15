import { app, BrowserWindow, net } from 'electron'
import { join } from 'path'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import type { ContentManifest } from '../shared/types'
import { flattenManifestItems } from '../shared/manifest'

function serverUrl(): string {
  const raw = process.env['KNOWHUB_SERVER_URL']?.trim()
  return raw || 'http://localhost:3000'
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
  const filePath = join(getContentDir(), htmlFile)
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    let data = ''
    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      response.on('data', (chunk) => { data += chunk })
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} for ${url}`))
          return
        }
        try { resolve(JSON.parse(data) as T) }
        catch (e) { reject(e) }
      })
    })
    request.on('error', reject)
    request.end()
  })
}

async function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    let data = ''
    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      response.on('data', (chunk) => { data += chunk })
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} for ${url}`))
          return
        }
        resolve(data)
      })
    })
    request.on('error', reject)
    request.end()
  })
}

function mergeManifests(local: ContentManifest, remote: ContentManifest): ContentManifest {
  const remoteSectionIds = new Set(remote.sections.map((s) => s.id))
  const localOnlySections = local.sections.filter((s) => !remoteSectionIds.has(s.id))
  return { version: remote.version, sections: [...localOnlySections, ...remote.sections] }
}

async function syncContent(window: BrowserWindow): Promise<void> {
  ensureContentDir()
  const local = getManifest()
  const baseUrl = serverUrl()

  let remote: ContentManifest
  try {
    remote = await fetchJson<ContentManifest>(`${baseUrl}/content/manifest.json`)
  } catch (e) {
    console.error('Content sync: failed to fetch manifest:', e)
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

  for (const item of toDownload) {
    if (!item.htmlFile) continue
    try {
      const html = await fetchText(`${baseUrl}/content/${item.htmlFile}`)
      const dest = join(getContentDir(), item.htmlFile)
      const dir = dest.substring(0, Math.max(dest.lastIndexOf('/'), dest.lastIndexOf('\\')))
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(dest, html, 'utf-8')
    } catch (e) {
      console.error(`Content sync: failed to download ${item.htmlFile}:`, e)
    }
  }

  for (const htmlFile of removedHtmlFiles) {
    const path = join(getContentDir(), htmlFile)
    if (existsSync(path)) unlinkSync(path)
  }

  const merged = local ? mergeManifests(local, remote) : remote
  const hasLocalOnlySections = (local?.sections ?? []).some(
    (section) => !remote.sections.some((remoteSection) => remoteSection.id === section.id)
  )
  const catalog = hasLocalOnlySections ? merged : remote
  writeFileSync(getManifestPath(), JSON.stringify(catalog, null, 2), 'utf-8')
  window.webContents.send('content:updated')
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
    void syncContent(window).catch(console.error)
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
