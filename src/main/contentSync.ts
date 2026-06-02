import { app, BrowserWindow, net } from 'electron'
import { join } from 'path'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { ContentManifest } from '../shared/types'
import { flattenManifestItems } from '../shared/manifest'

const SERVER_URL = process.env['KNOWHUB_SERVER_URL'] ?? 'http://localhost:3000'

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
      response.on('data', (chunk) => { data += chunk })
      response.on('end', () => {
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
      response.on('data', (chunk) => { data += chunk })
      response.on('end', () => resolve(data))
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

  let remote: ContentManifest
  try {
    remote = await fetchJson<ContentManifest>(`${SERVER_URL}/content/manifest.json`)
  } catch {
    return
  }

  if (local && remote.version <= local.version) return

  const localIds = local
    ? new Map(flattenManifestItems(local).map((i) => [i.id, i.version]))
    : new Map<string, number>()

  const allRemoteItems = flattenManifestItems(remote)
  const toDownload = allRemoteItems.filter(
    (item) => item.htmlFile && (!localIds.has(item.id) || localIds.get(item.id)! < item.version)
  )

  for (const item of toDownload) {
    if (!item.htmlFile) continue
    try {
      const html = await fetchText(`${SERVER_URL}/content/${item.htmlFile}`)
      const dest = join(getContentDir(), item.htmlFile)
      const dir = dest.substring(0, Math.max(dest.lastIndexOf('/'), dest.lastIndexOf('\\')))
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(dest, html, 'utf-8')
    } catch (e) {
      console.error(`Failed to download ${item.htmlFile}:`, e)
    }
  }

  const merged = local ? mergeManifests(local, remote) : remote
  writeFileSync(getManifestPath(), JSON.stringify(merged, null, 2), 'utf-8')
  window.webContents.send('content:updated')
}

function getBundledContentDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'content')
  }
  return join(__dirname, '../../resources/content')
}

function seedFromBundled(): void {
  // In prod: seed only on first launch. In dev: always overwrite so file edits are reflected immediately.
  if (app.isPackaged && existsSync(getManifestPath())) return
  const bundledDir = getBundledContentDir()
  if (!existsSync(bundledDir)) return
  ensureContentDir()
  cpSync(bundledDir, getContentDir(), { recursive: true, force: true })
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
