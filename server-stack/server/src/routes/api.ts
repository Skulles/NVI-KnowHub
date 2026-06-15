import { Router, Request, Response } from 'express'
import { requireAdminAuth } from '../auth.js'
import { randomBytes } from 'crypto'
import {
  readdirSync, readFileSync, writeFileSync, unlinkSync,
  existsSync, mkdirSync
} from 'fs'
import { join } from 'path'
import { basePath, withBase } from '../base-path.js'
import { blocksToArticleHtml, BNBlock } from '../html-renderer.js'
import {
  readManifest, writeManifest,
  upsertArticleInManifest, removeArticleFromManifest,
  reorderArticlesInManifest,
  Manifest, ManifestItem
} from '../manifest.js'
import { titleToHtmlFile } from '../utils.js'

interface DraftRecord {
  id: string
  title: string
  lead: string
  blocks: BNBlock[]
  updatedAt: string
  published: boolean
  publishedAt: string | null
  sectionId: string
  sectionTitle: string
  sectionIcon: string
  subsectionId: string
  subsectionTitle: string
  htmlFile: string
  sortOrder?: number
}

const UPLOAD_EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4'
}

function parseUploadDataUrl(value: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:((?:image\/(?:gif|jpeg|png|webp))|video\/mp4);base64,([A-Za-z0-9+/=]+)$/i.exec(value)
  if (!match) return null
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') }
}

function uploadUrl(filename: string): string {
  return withBase(`/content/uploads/${filename}`)
}

function writeUploadedAsset(contentDir: string, dataUrl: string): string | null {
  const parsed = parseUploadDataUrl(dataUrl)
  if (!parsed) return null
  const ext = UPLOAD_EXTENSIONS[parsed.mime]
  if (!ext) return null

  const uploadsDir = join(contentDir, 'uploads')
  mkdirSync(uploadsDir, { recursive: true })
  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`
  writeFileSync(join(uploadsDir, filename), parsed.buffer)
  return uploadUrl(filename)
}

function uploadedContentPathFromUrl(value: string): string | null {
  if (!value) return null
  try {
    const pathname = value.startsWith('http://') || value.startsWith('https://')
      ? new URL(value).pathname
      : value
    const prefix = `${basePath()}/content/`.replace(/^\/content\//, '/content/')
    if (!pathname.startsWith(prefix)) return null
    const contentPath = pathname.slice(prefix.length)
    return /^uploads\/[A-Za-z0-9._-]+$/.test(contentPath) ? contentPath : null
  } catch {
    return null
  }
}

function normalizeDraftMediaUploads(blocks: BNBlock[], contentDir: string): BNBlock[] {
  let changed = false

  const normalizeBlock = (block: BNBlock): BNBlock => {
    let next = block
    const url = typeof block.props?.url === 'string' ? block.props.url : ''
    if ((block.type === 'image' || block.type === 'video') && /^data:(image\/|video\/mp4)/i.test(url)) {
      const uploaded = writeUploadedAsset(contentDir, url)
      if (uploaded) {
        next = { ...block, props: { ...block.props, url: uploaded } }
        changed = true
      }
    }

    if (Array.isArray(next.children) && next.children.length > 0) {
      const children = next.children.map(normalizeBlock)
      if (children.some((child, index) => child !== next.children[index])) {
        next = { ...next, children }
      }
    }

    return next
  }

  const normalized = blocks.map(normalizeBlock)
  return changed ? normalized : blocks
}

function mimeFromContentPath(contentPath: string): string {
  const ext = contentPath.split('.').pop()?.toLowerCase()
  if (ext === 'jpg') return 'image/jpeg'
  if (ext === 'mp4') return 'video/mp4'
  return ext ? `image/${ext}` : 'application/octet-stream'
}

function inlineUploadedMedia(blocks: BNBlock[], contentDir: string): BNBlock[] {
  const inlineBlock = (block: BNBlock): BNBlock => {
    let next = block
    const url = typeof block.props?.url === 'string' ? block.props.url : ''
    const contentPath = uploadedContentPathFromUrl(url)
    if ((block.type === 'image' || block.type === 'video') && contentPath) {
      const filePath = join(contentDir, contentPath)
      if (existsSync(filePath)) {
        const mime = mimeFromContentPath(contentPath)
        const dataUrl = `data:${mime};base64,${readFileSync(filePath).toString('base64')}`
        next = { ...block, props: { ...block.props, url: dataUrl } }
      }
    }

    if (Array.isArray(next.children) && next.children.length > 0) {
      next = { ...next, children: next.children.map(inlineBlock) }
    }

    return next
  }

  return blocks.map(inlineBlock)
}

function normalizeDraftAssets(draftsDir: string, contentDir: string, draft: DraftRecord): DraftRecord {
  const blocks = normalizeDraftMediaUploads(draft.blocks, contentDir)
  if (blocks === draft.blocks) return draft
  const normalized = { ...draft, blocks }
  writeFileSync(join(draftsDir, `${draft.id}.json`), JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

function normalizeDraft(raw: DraftRecord): DraftRecord {
  if (raw.published && !raw.publishedAt) {
    return { ...raw, publishedAt: raw.updatedAt }
  }
  return raw
}

function readDraft(draftsDir: string, id: string): DraftRecord | null {
  const path = join(draftsDir, `${id}.json`)
  if (!existsSync(path)) return null
  return normalizeDraft(JSON.parse(readFileSync(path, 'utf8')) as DraftRecord)
}

function findHtmlFileOwner(manifest: Manifest, htmlFile: string, excludeId: string): string | null {
  for (const section of manifest.sections) {
    for (const item of section.items ?? []) {
      if (item.htmlFile === htmlFile && item.id !== excludeId) return item.id
    }
    for (const sub of section.subsections ?? []) {
      for (const item of sub.items) {
        if (item.htmlFile === htmlFile && item.id !== excludeId) return item.id
      }
    }
  }
  return null
}

function findDraftHtmlFileOwner(draftsDir: string, htmlFile: string, excludeId: string): string | null {
  mkdirSync(draftsDir, { recursive: true })
  for (const f of readdirSync(draftsDir).filter((name) => name.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(draftsDir, f), 'utf8')) as DraftRecord
    if (raw.id !== excludeId && raw.htmlFile === htmlFile) return raw.id
  }
  return null
}

function resolveHtmlFile(
  title: string,
  articleId: string,
  contentDir: string,
  draftsDir: string
): string {
  let htmlFile = titleToHtmlFile(title, articleId)
  const manifest = readManifest(contentDir)

  const taken = (file: string): boolean =>
    findHtmlFileOwner(manifest, file, articleId) !== null ||
    findDraftHtmlFileOwner(draftsDir, file, articleId) !== null

  if (!taken(htmlFile)) return htmlFile

  const suffix = articleId.replace(/^article-/, '').slice(-8) || articleId
  htmlFile = titleToHtmlFile(`${title}-${suffix}`, articleId)
  if (!taken(htmlFile)) return htmlFile

  return `${titleToHtmlFile(title, articleId).replace(/\.html$/, '')}-${suffix}.html`
}

function hasUnpublishedChanges(draft: Pick<DraftRecord, 'published' | 'updatedAt' | 'publishedAt'>): boolean {
  if (!draft.published || !draft.publishedAt) return false
  return new Date(draft.updatedAt).getTime() > new Date(draft.publishedAt).getTime()
}

function articleMetaFromDraft(raw: DraftRecord): Record<string, unknown> {
  return {
    id: raw.id,
    title: raw.title,
    updatedAt: raw.updatedAt,
    published: raw.published ?? false,
    publishedAt: raw.publishedAt ?? null,
    hasUnpublishedChanges: hasUnpublishedChanges(raw),
    htmlFile: raw.htmlFile,
    sectionId: raw.sectionId ?? '',
    subsectionId: raw.subsectionId ?? '',
    sortOrder: raw.sortOrder
  }
}

function findManifestItem(manifest: Manifest, id: string): { item: ManifestItem; htmlFile: string } | null {
  for (const section of manifest.sections) {
    for (const item of section.items ?? []) {
      if (item.id === id) return { item, htmlFile: item.htmlFile ?? '' }
    }
    for (const sub of section.subsections ?? []) {
      for (const item of sub.items) {
        if (item.id === id) return { item, htmlFile: item.htmlFile ?? '' }
      }
    }
  }
  return null
}

function listAllDrafts(draftsDir: string): DraftRecord[] {
  mkdirSync(draftsDir, { recursive: true })
  return readdirSync(draftsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => normalizeDraft(JSON.parse(readFileSync(join(draftsDir, f), 'utf8')) as DraftRecord))
}

function listDraftsInDivision(
  draftsDir: string,
  sectionId: string,
  subsectionId: string
): DraftRecord[] {
  return listAllDrafts(draftsDir).filter(
    (draft) => draft.sectionId === sectionId && draft.subsectionId === subsectionId
  )
}

function getManifestArticleOrder(
  manifest: Manifest,
  sectionId: string,
  subsectionId?: string
): Record<string, number> {
  const section = manifest.sections.find((s) => s.id === sectionId)
  if (!section) return {}
  const items = subsectionId
    ? (section.subsections?.find((s) => s.id === subsectionId)?.items ?? [])
    : (section.items ?? [])
  const order: Record<string, number> = {}
  items.forEach((item, index) => {
    order[item.id] = index
  })
  return order
}

function getNextSortOrder(
  draftsDir: string,
  sectionId: string,
  subsectionId: string
): number {
  const drafts = listDraftsInDivision(draftsDir, sectionId, subsectionId)
  const orders = drafts
    .map((draft) => draft.sortOrder)
    .filter((value): value is number => typeof value === 'number')
  if (orders.length > 0) return Math.max(...orders) + 1
  return drafts.length
}

function getOrderedArticleIdsForDivision(
  draftsDir: string,
  manifest: Manifest,
  sectionId: string,
  subsectionId?: string
): string[] {
  const manifestOrder = getManifestArticleOrder(manifest, sectionId, subsectionId)
  const subsectionKey = subsectionId ?? ''
  return listDraftsInDivision(draftsDir, sectionId, subsectionKey).sort((a, b) => {
    const orderA = a.sortOrder ?? manifestOrder[a.id] ?? Number.MAX_SAFE_INTEGER
    const orderB = b.sortOrder ?? manifestOrder[b.id] ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
  }).map((draft) => draft.id)
}

function getOrderedPublishedArticleIds(
  draftsDir: string,
  manifest: Manifest,
  sectionId: string,
  subsectionId?: string
): string[] {
  const manifestOrder = getManifestArticleOrder(manifest, sectionId, subsectionId)
  const publishedIds = new Set(Object.keys(manifestOrder))
  return getOrderedArticleIdsForDivision(draftsDir, manifest, sectionId, subsectionId).filter((id) =>
    publishedIds.has(id)
  )
}

function syncManifestOrderFromDrafts(
  draftsDir: string,
  manifest: Manifest,
  sectionId: string,
  subsectionId?: string
): void {
  const orderedIds = getOrderedPublishedArticleIds(draftsDir, manifest, sectionId, subsectionId)
  if (orderedIds.length === 0) return
  reorderArticlesInManifest(manifest, sectionId, subsectionId, orderedIds)
}

export function createApiRouter(draftsDir: string, contentDir: string): Router {
  const router = Router()

  router.use(requireAdminAuth)

  router.get('/articles', (_req, res) => {
    mkdirSync(draftsDir, { recursive: true })
    const files = readdirSync(draftsDir).filter((f) => f.endsWith('.json'))
    const articles = files.map((f) => {
      const raw = normalizeDraft(JSON.parse(readFileSync(join(draftsDir, f), 'utf8')) as DraftRecord)
      return articleMetaFromDraft(raw)
    })
    res.json(articles)
  })

  router.get('/articles/:id', (req, res) => {
    const raw = readDraft(draftsDir, req.params.id)
    const draft = raw ? normalizeDraftAssets(draftsDir, contentDir, raw) : null
    if (!draft) { res.status(404).json({ error: 'Not found' }); return }
    res.json({
      ...draft,
      hasUnpublishedChanges: hasUnpublishedChanges(draft)
    })
  })

  router.post('/articles', (req: Request, res: Response) => {
    const body = req.body as {
      id?: string
      title: string
      lead?: string
      blocks: BNBlock[]
      sectionId?: string
      sectionTitle?: string
      sectionIcon?: string
      subsectionId?: string
      subsectionTitle?: string
    }
    const id = body.id ?? `article-${Date.now()}`
    mkdirSync(draftsDir, { recursive: true })

    const existing = readDraft(draftsDir, id)
    const htmlFile = resolveHtmlFile(body.title, id, contentDir, draftsDir)
    const sectionId = body.sectionId ?? existing?.sectionId ?? ''
    const subsectionId = body.subsectionId ?? existing?.subsectionId ?? ''

    const draftBlocks = normalizeDraftMediaUploads(body.blocks, contentDir)
    const draft: DraftRecord = {
      id,
      title: body.title,
      lead: body.lead ?? '',
      blocks: draftBlocks,
      updatedAt: new Date().toISOString(),
      published: existing?.published ?? false,
      publishedAt: existing?.publishedAt ?? null,
      sectionId,
      sectionTitle: body.sectionTitle ?? existing?.sectionTitle ?? '',
      sectionIcon: body.sectionIcon ?? existing?.sectionIcon ?? 'book',
      subsectionId,
      subsectionTitle: body.subsectionTitle ?? existing?.subsectionTitle ?? '',
      htmlFile,
      sortOrder:
        existing?.sortOrder ??
        (sectionId ? getNextSortOrder(draftsDir, sectionId, subsectionId) : undefined)
    }

    writeFileSync(join(draftsDir, `${id}.json`), JSON.stringify(draft, null, 2), 'utf8')
    res.json({
      id,
      htmlFile: draft.htmlFile,
      published: draft.published,
      publishedAt: draft.publishedAt,
      updatedAt: draft.updatedAt,
      hasUnpublishedChanges: hasUnpublishedChanges(draft)
    })
  })

  router.post('/uploads', (req: Request, res: Response) => {
    const body = req.body as { dataUrl?: string }
    if (!body.dataUrl) {
      res.status(400).json({ error: 'Missing file data' })
      return
    }

    const url = writeUploadedAsset(contentDir, body.dataUrl)
    if (!url) {
      res.status(400).json({ error: 'Unsupported file format' })
      return
    }

    res.json({ url })
  })

  router.post('/articles/reorder', (req: Request, res: Response) => {
    const body = req.body as {
      sectionId?: string
      subsectionId?: string
      articleIds?: string[]
    }
    const { sectionId, subsectionId, articleIds } = body
    if (!sectionId || !Array.isArray(articleIds)) {
      res.status(400).json({ error: 'Invalid request' })
      return
    }

    mkdirSync(draftsDir, { recursive: true })
    for (let i = 0; i < articleIds.length; i++) {
      const id = articleIds[i]
      const draft = readDraft(draftsDir, id)
      if (!draft) continue
      writeFileSync(
        join(draftsDir, `${id}.json`),
        JSON.stringify({ ...draft, sortOrder: i }, null, 2),
        'utf8'
      )
    }

    const manifest = readManifest(contentDir)
    reorderArticlesInManifest(manifest, sectionId, subsectionId || undefined, articleIds)
    writeManifest(contentDir, manifest)

    res.json({ ok: true })
  })

  router.post('/articles/:id/publish', (req, res) => {
    const path = join(draftsDir, `${req.params.id}.json`)
    if (!existsSync(path)) { res.status(404).json({ error: 'Draft not found' }); return }

    const draft = JSON.parse(readFileSync(path, 'utf8')) as DraftRecord
    const htmlFile = resolveHtmlFile(draft.title, draft.id, contentDir, draftsDir)
    const manifest = readManifest(contentDir)
    const manifestEntry = findManifestItem(manifest, draft.id)
    const previousHtmlFile = manifestEntry?.htmlFile || draft.htmlFile

    const html = blocksToArticleHtml(draft.title, draft.lead, inlineUploadedMedia(draft.blocks, contentDir))
    mkdirSync(contentDir, { recursive: true })
    writeFileSync(join(contentDir, htmlFile), html, 'utf8')

    if (previousHtmlFile && previousHtmlFile !== htmlFile) {
      const oldPath = join(contentDir, previousHtmlFile)
      if (existsSync(oldPath)) unlinkSync(oldPath)
    }

    upsertArticleInManifest(manifest, {
      id: draft.id,
      title: draft.title,
      htmlFile,
      sectionId: draft.sectionId,
      sectionTitle: draft.sectionTitle,
      sectionIcon: draft.sectionIcon,
      subsectionId: draft.subsectionId || undefined,
      subsectionTitle: draft.subsectionTitle || undefined
    })
    syncManifestOrderFromDrafts(
      draftsDir,
      manifest,
      draft.sectionId,
      draft.subsectionId || undefined
    )
    writeManifest(contentDir, manifest)

    const publishedAt = new Date().toISOString()
    const orderedIds = getOrderedArticleIdsForDivision(
      draftsDir,
      manifest,
      draft.sectionId,
      draft.subsectionId || undefined
    )
    const sortOrder = orderedIds.indexOf(draft.id)
    const updatedDraft: DraftRecord = {
      ...draft,
      htmlFile,
      published: true,
      publishedAt,
      updatedAt: publishedAt,
      sortOrder: sortOrder >= 0 ? sortOrder : draft.sortOrder
    }
    writeFileSync(path, JSON.stringify(updatedDraft, null, 2), 'utf8')

    res.json({
      ok: true,
      htmlFile,
      published: true,
      publishedAt,
      updatedAt: publishedAt,
      hasUnpublishedChanges: false
    })
  })

  router.delete('/articles/:id', (req, res) => {
    const draftPath = join(draftsDir, `${req.params.id}.json`)
    let htmlFile: string | undefined
    if (existsSync(draftPath)) {
      const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as DraftRecord
      htmlFile = draft.htmlFile
      unlinkSync(draftPath)
    }

    if (htmlFile) {
      const htmlPath = join(contentDir, htmlFile)
      if (existsSync(htmlPath)) unlinkSync(htmlPath)
      const manifest = readManifest(contentDir)
      removeArticleFromManifest(manifest, req.params.id)
      writeManifest(contentDir, manifest)
    }

    res.json({ ok: true })
  })

  router.get('/manifest', (_req, res) => {
    res.json(readManifest(contentDir))
  })

  router.put('/manifest', (req: Request, res: Response) => {
    const body = req.body as Manifest
    if (!body?.sections) { res.status(400).json({ error: 'Invalid manifest' }); return }
    writeManifest(contentDir, body)
    res.json({ ok: true })
  })

  return router
}
