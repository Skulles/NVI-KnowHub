import { Router, Request, Response } from 'express'
import { requireAdminAuth } from '../auth.js'
import {
  readdirSync, readFileSync, writeFileSync, unlinkSync,
  existsSync, mkdirSync
} from 'fs'
import { join } from 'path'
import { blocksToArticleHtml, BNBlock } from '../html-renderer.js'
import {
  readManifest, writeManifest,
  upsertArticleInManifest, removeArticleFromManifest,
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
    subsectionId: raw.subsectionId ?? ''
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
    const draft = readDraft(draftsDir, req.params.id)
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

    const draft: DraftRecord = {
      id,
      title: body.title,
      lead: body.lead ?? '',
      blocks: body.blocks,
      updatedAt: new Date().toISOString(),
      published: existing?.published ?? false,
      publishedAt: existing?.publishedAt ?? null,
      sectionId: body.sectionId ?? existing?.sectionId ?? '',
      sectionTitle: body.sectionTitle ?? existing?.sectionTitle ?? '',
      sectionIcon: body.sectionIcon ?? existing?.sectionIcon ?? 'book',
      subsectionId: body.subsectionId ?? existing?.subsectionId ?? '',
      subsectionTitle: body.subsectionTitle ?? existing?.subsectionTitle ?? '',
      htmlFile
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

  router.post('/articles/:id/publish', (req, res) => {
    const path = join(draftsDir, `${req.params.id}.json`)
    if (!existsSync(path)) { res.status(404).json({ error: 'Draft not found' }); return }

    const draft = JSON.parse(readFileSync(path, 'utf8')) as DraftRecord
    const htmlFile = resolveHtmlFile(draft.title, draft.id, contentDir, draftsDir)
    const manifest = readManifest(contentDir)
    const manifestEntry = findManifestItem(manifest, draft.id)
    const previousHtmlFile = manifestEntry?.htmlFile || draft.htmlFile

    const html = blocksToArticleHtml(draft.title, draft.lead, draft.blocks)
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
    writeManifest(contentDir, manifest)

    const publishedAt = new Date().toISOString()
    const updatedDraft: DraftRecord = {
      ...draft,
      htmlFile,
      published: true,
      publishedAt,
      updatedAt: publishedAt
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
