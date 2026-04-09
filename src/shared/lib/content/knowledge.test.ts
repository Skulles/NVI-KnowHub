import { beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type {
  ArticleDraft,
  DraftReconcileReport,
  KnowledgeArticle,
  SnapshotMeta,
} from '../../../entities/knowledge/types'
import { KnowledgeBaseService } from './knowledge'
import {
  ensureSnapshotSchema,
  readSnapshotMeta,
  SNAPSHOT_SCHEMA_VERSION,
  stampSnapshotMeta,
} from './schema'

const wasmPath = decodeURIComponent(
  new URL('../../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)
    .pathname,
)

let sqlPromise: Promise<SqlJsStatic>
const SAMPLE_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotk1sAAAAASUVORK5CYII='

beforeAll(() => {
  sqlPromise = initSqlJs({
    locateFile: () => wasmPath,
  })
})

class MemorySnapshotStore {
  snapshot: Uint8Array | null = null
  backup: Uint8Array | null = null

  async load() {
    return this.snapshot ? new Uint8Array(this.snapshot) : null
  }

  async save(bytes: Uint8Array) {
    this.snapshot = new Uint8Array(bytes)
  }

  async saveBackup(bytes: Uint8Array) {
    this.backup = new Uint8Array(bytes)
  }

  async loadBackup() {
    return this.backup ? new Uint8Array(this.backup) : null
  }
}

class MemoryDraftStore {
  drafts: Record<string, ArticleDraft> = {}

  async getDraft(articleId: string) {
    return this.drafts[articleId] ?? null
  }

  async listDrafts() {
    return { ...this.drafts }
  }

  async saveDraft(payload: ArticleDraft) {
    this.drafts[payload.articleId] = { ...payload }
    return this.drafts[payload.articleId]
  }

  async discardDraft(articleId: string) {
    delete this.drafts[articleId]
  }

  async discardMany(articleIds: string[]) {
    articleIds.forEach((articleId) => {
      delete this.drafts[articleId]
    })
  }

  async reconcileWithSnapshot(
    articles: KnowledgeArticle[],
    snapshotMeta: SnapshotMeta,
  ): Promise<DraftReconcileReport> {
    const articleIds = new Set(articles.map((article) => article.id))
    let active = 0
    let orphaned = 0

    Object.entries(this.drafts).forEach(([articleId, draft]) => {
      if (articleIds.has(articleId)) {
        this.drafts[articleId] = {
          ...draft,
          status: 'active',
          issue: undefined,
          baseSnapshotVersion: snapshotMeta.version,
          baseSnapshotChecksum: snapshotMeta.checksum,
        }
        active += 1
        return
      }

      this.drafts[articleId] = {
        ...draft,
        status: 'orphaned',
        issue: `Статья отсутствует в snapshot ${snapshotMeta.version}.`,
        baseSnapshotVersion: snapshotMeta.version,
        baseSnapshotChecksum: snapshotMeta.checksum,
      }
      orphaned += 1
    })

    return { active, orphaned }
  }
}

class MemoryMediaAssetStore {
  assets: Record<
    string,
    {
      id: string
      articleId: string
      kind: 'image' | 'video'
      mimeType: string
      dataUrl: string
      sizeBytes: number | null
      createdAt: string
    }
  > = {}
  articleIndex: Record<string, string[]> = {}

  async saveDraftAssets(
    articleId: string,
    assets: Array<{
      id: string
      articleId: string
      kind: 'image' | 'video'
      mimeType: string
      dataUrl: string
      sizeBytes: number | null
      createdAt: string
    }>,
  ) {
    const previous = this.articleIndex[articleId] ?? []
    this.articleIndex[articleId] = assets.map((asset) => asset.id)
    previous
      .filter((assetId) => !this.articleIndex[articleId].includes(assetId))
      .forEach((assetId) => {
        delete this.assets[assetId]
      })
    assets.forEach((asset) => {
      this.assets[asset.id] = { ...asset, articleId }
    })
  }

  async getDraftAssets(assetIds: string[]) {
    return Object.fromEntries(
      assetIds
        .filter((assetId) => this.assets[assetId])
        .map((assetId) => [assetId, this.assets[assetId]]),
    )
  }

  async discardDraftAssets(articleId: string) {
    ;(this.articleIndex[articleId] ?? []).forEach((assetId) => {
      delete this.assets[assetId]
    })
    delete this.articleIndex[articleId]
  }

  async discardDraftAssetsMany(articleIds: string[]) {
    await Promise.all(articleIds.map((articleId) => this.discardDraftAssets(articleId)))
  }
}

function createPlatformMock(overrides: Partial<ReturnType<typeof buildPlatformMock>> = {}) {
  return {
    ...buildPlatformMock(),
    ...overrides,
  }
}

function buildPlatformMock() {
  return {
    runtime: 'web' as const,
    openExternal: vi.fn(),
    downloadBinary: vi.fn(async () => new Uint8Array()),
    requestJson: vi.fn(async () => ({})),
    uploadBinary: vi.fn(async () => ({
      browser_download_url: 'https://example.test/asset',
      name: 'asset',
    })),
    computeChecksum: vi.fn(async (payload: Uint8Array) => {
      const copy = new Uint8Array(payload.byteLength)
      copy.set(payload)
      const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
      return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
    }),
  }
}

async function createService() {
  const snapshotStore = new MemorySnapshotStore()
  const draftStore = new MemoryDraftStore()
  const mediaAssetStore = new MemoryMediaAssetStore()
  const platform = createPlatformMock()
  const service = new KnowledgeBaseService({
    snapshotStore,
    draftStore,
    mediaAssetStore,
    platform: platform as never,
    initSqlJsImpl: (() => sqlPromise) as never,
  })

  await service.bootstrap()

  return { service, snapshotStore, draftStore, mediaAssetStore, platform }
}

async function createTestArticle(service: KnowledgeBaseService) {
  return service.createArticle({
    title: 'Тестовая статья',
    summary: 'Тестовое описание',
    sectionId: 'svyaz',
    contentJson: JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Тестовое содержимое статьи.' }],
        },
      ],
    }),
    contentText: 'Тестовое содержимое статьи.',
    forBu: true,
    forTkrs: true,
  })
}

async function createSnapshotBytes(
  bytes: Uint8Array,
  overrides: {
    version: string
    removeArticleId?: string
  },
) {
  const SQL = await sqlPromise
  const db = new SQL.Database(bytes)

  ensureSnapshotSchema(db)

  if (overrides.removeArticleId) {
    db.run('DELETE FROM articles WHERE id = ?', [overrides.removeArticleId])
  }

  const now = new Date().toISOString()
  stampSnapshotMeta(db, {
    ...readSnapshotMeta(db),
    version: overrides.version,
    updatedAt: now,
    publishedAt: now,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    checksum: '',
    source: 'release',
  })

  const checksum = await computeChecksum(db)

  stampSnapshotMeta(db, {
    ...readSnapshotMeta(db),
    version: overrides.version,
    updatedAt: now,
    publishedAt: now,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    checksum,
    source: 'release',
  })

  const exported = db.export()
  db.close()

  return { bytes: exported, checksum }
}

async function computeChecksum(db: Database) {
  const SQL = await sqlPromise
  const clone = new SQL.Database(db.export())
  const current = readSnapshotMeta(clone)
  stampSnapshotMeta(clone, {
    ...current,
    checksum: '',
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  })

  const digest = await crypto.subtle.digest('SHA-256', clone.export())
  clone.close()

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

describe('KnowledgeBaseService', () => {
  it('bootstraps seed snapshot with normalized metadata', async () => {
    const { service } = await createService()

    const meta = await service.getSnapshotMeta()

    expect(meta.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
    expect(meta.articleCount).toBe(0)
    expect(meta.sectionCount).toBe(3)
    expect(meta.checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('saves and deletes drafts with snapshot provenance', async () => {
    const { service } = await createService()
    const article = await createTestArticle(service)
    const meta = await service.getSnapshotMeta()

    expect(article).not.toBeNull()

    await service.saveDraft({
      articleId: article!.id,
      title: 'Обновленный заголовок',
      summary: 'Локальный черновик',
      contentJson: article!.contentJson,
      contentText: article!.contentText,
      updatedAt: new Date().toISOString(),
    })

    const saved = await service.getDraft(article!.id)
    expect(saved?.baseSnapshotVersion).toBe(meta.version)
    expect(saved?.baseSnapshotChecksum).toBe(meta.checksum)

    await service.discardDraft(article!.id)
    expect(await service.getDraft(article!.id)).toBeNull()
  })

  it('moves embedded media out of draft content json', async () => {
    const { service, mediaAssetStore } = await createService()
    const article = await createTestArticle(service)

    await service.saveDraft({
      articleId: article.id,
      title: article.title,
      summary: article.summary,
      contentJson: JSON.stringify({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: SAMPLE_IMAGE_DATA_URL } }],
      }),
      contentText: '',
      updatedAt: new Date().toISOString(),
    })

    const saved = await service.getDraft(article.id)
    expect(saved?.contentJson).toContain('asset://')
    expect(saved?.contentJson).not.toContain('data:image/png;base64')
    expect(Object.keys(mediaAssetStore.assets)).toHaveLength(1)

    const resolved = await service.resolveDraftContent(saved!.contentJson)
    expect(resolved).toContain('data:image/png;base64')
  })

  it('deletes an article from the local database', async () => {
    const { service } = await createService()
    const article = await createTestArticle(service)
    expect(article).not.toBeNull()
    const beforeCount = (await service.listArticles('bu')).length

    await service.deleteArticle(article!.id)

    expect(await service.getArticleBySlug(article!.slug)).toBeNull()
    expect((await service.listArticles('bu')).length).toBe(beforeCount - 1)
    expect(await service.getDraft(article!.id)).toBeNull()
  })

  it('reconciles drafts after applying a snapshot update', async () => {
    const { service, snapshotStore, platform } = await createService()
    const article = await createTestArticle(service)

    await service.saveDraft({
      articleId: article!.id,
      title: 'Черновик без исходной статьи',
      summary: 'Останется локально',
      contentJson: article!.contentJson,
      contentText: article!.contentText,
      updatedAt: new Date().toISOString(),
    })

    const nextSnapshot = await createSnapshotBytes(snapshotStore.snapshot!, {
      version: 'release-3',
      removeArticleId: article!.id,
    })

    platform.downloadBinary.mockResolvedValue(nextSnapshot.bytes)

    const result = await service.applySnapshotUpdate({
      downloadUrl: 'https://example.test/next.sqlite',
      version: 'release-3',
    })

    expect(result.meta.version).toBe('release-3')
    expect(result.drafts.orphaned).toBe(1)
    expect((await service.getDraft(article!.id))?.status).toBe('orphaned')
  })

  it('rolls back to the previous snapshot when checksum verification fails', async () => {
    const { service, snapshotStore, platform } = await createService()
    const initialMeta = await service.getSnapshotMeta()
    const nextSnapshot = await createSnapshotBytes(snapshotStore.snapshot!, {
      version: 'release-4',
    })

    platform.downloadBinary.mockResolvedValue(nextSnapshot.bytes)

    await expect(
      service.applySnapshotUpdate({
        downloadUrl: 'https://example.test/bad.sqlite',
        version: 'release-4',
        checksum: 'deadbeef',
      }),
    ).rejects.toThrow(/Checksum/)

    const restoredMeta = await service.getSnapshotMeta()
    expect(restoredMeta.version).toBe(initialMeta.version)
    expect(snapshotStore.backup).not.toBeNull()
  })

  it('publishes snapshot assets and clears merged drafts', async () => {
    const { service, draftStore, platform } = await createService()
    const article = await createTestArticle(service)

    await service.saveDraft({
      articleId: article!.id,
      title: 'Опубликованный черновик',
      summary: 'Станет частью релиза',
      contentJson: article!.contentJson,
      contentText: article!.contentText,
      updatedAt: new Date().toISOString(),
    })

    platform.requestJson
      .mockRejectedValueOnce(new Error('HTTP 404: tag not found'))
      .mockResolvedValueOnce({
        id: 1,
        tag_name: 'release-5',
        html_url: 'https://github.com/example/release/release-5',
        upload_url: 'https://uploads.github.com/assets{?name,label}',
        assets: [],
      })
    platform.uploadBinary
      .mockResolvedValueOnce({
        browser_download_url: 'https://example.test/release-5.sqlite',
        name: 'knowhub-snapshot.sqlite',
      })
      .mockResolvedValueOnce({
        browser_download_url: 'https://example.test/release-5.manifest.json',
        name: 'knowhub-snapshot.sqlite.manifest.json',
      })

    const result = await service.publishSnapshot({
      settings: {
        owner: 'example',
        repo: 'knowhub',
        assetName: 'knowhub-snapshot.sqlite',
        manifestAssetName: 'knowhub-snapshot.sqlite.manifest.json',
      },
      token: 'ghp_test',
      version: 'release-5',
      releaseNotes: 'Snapshot update',
    })

    expect(result.version).toBe('release-5')
    expect(platform.uploadBinary).toHaveBeenCalledTimes(2)
    expect(await service.getDraft(article!.id)).toBeNull()
    expect(Object.keys(await draftStore.listDrafts())).toHaveLength(0)
  })

  it('imports exported snapshot bytes', async () => {
    const { service } = await createService()
    await createTestArticle(service)
    const bytes = service.exportSnapshotBytes()
    const meta = await service.importSnapshotFromBytes(new Uint8Array(bytes))
    expect(meta.articleCount).toBeGreaterThanOrEqual(1)
  })

  it('rolls back import when file is invalid', async () => {
    const { service } = await createService()
    const before = await service.getSnapshotMeta()
    await expect(
      service.importSnapshotFromBytes(new Uint8Array([0, 1, 2])),
    ).rejects.toThrow()
    const after = await service.getSnapshotMeta()
    expect(after.checksum).toBe(before.checksum)
  })
})
