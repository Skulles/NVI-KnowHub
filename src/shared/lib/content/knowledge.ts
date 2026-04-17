import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import MiniSearch from 'minisearch'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import {
  type ApplySnapshotUpdateInput,
  type ApplySnapshotUpdateResult,
  type ApplySnapshotUpdateStage,
  type ArticleDraft,
  type AudienceKind,
  type CreateArticleInput,
  type GitHubReleaseSettings,
  type KnowledgeArticle,
  type KnowledgeSection,
  type PublishSnapshotInput,
  type PublishSnapshotResult,
  type SearchHit,
  type SnapshotManifest,
  type SnapshotMeta,
  type UpdateCheckResult,
  TOOLS_SECTION_ID,
} from '../../../entities/knowledge/types'
import { platformBridge, type PlatformBridge } from '../platform'
import { DraftStore } from './draftStore'
import { MediaAssetStore, type StoredMediaAsset } from './mediaAssetStore'
import {
  addPendingLocalArticleId,
  clearPendingLocalArticleIds,
  getPendingLocalArticleIds,
  removePendingLocalArticleId,
} from './pendingLocalArticlesStore'
import {
  deleteReleaseAsset,
  fetchLatestRelease,
  getOrCreateRelease,
  uploadReleaseAsset,
} from './githubReleases'
import {
  createSeedDatabase,
  ensureSnapshotSchema,
  getManifestAssetName,
  readSnapshotMeta,
  seededSnapshotMeta,
  SNAPSHOT_SCHEMA_VERSION,
  stampSnapshotMeta,
  validateSnapshotDb,
} from './schema'
import { SnapshotStore } from './snapshotStore'
import { articleLinkExtension } from '../tiptap/articleLinkExtension'
import { articleBodyNodeExtensions } from '../tiptap/articleBodyNodeExtensions'
import { RELEASE_SOURCE_NOT_CONFIGURED_MESSAGE } from '../../config/releaseSource'

const MEDIA_ASSET_REF_PREFIX = 'asset://'

/**
 * Тег релиза (`releases/latest`) и `version` в snapshot/manifest часто разные
 * (например тег `2026-04-11` и version `16-213045` в манифесте).
 * Дополнительно сравниваем с `manifest.version` в checkForUpdates.
 */
function normalizeSnapshotVersionLabel(value: string): string {
  return value
    .trim()
    .replace(/\u2013|\u2014/g, '-')
    .toLowerCase()
}

function snapshotChecksumsEqual(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  return x.length > 0 && y.length > 0 && x === y
}

function releaseTagMatchesSnapshotVersion(
  releaseTag: string,
  snapshotVersion: string,
): boolean {
  const a = normalizeSnapshotVersionLabel(releaseTag)
  const b = normalizeSnapshotVersionLabel(snapshotVersion)
  if (a === b) {
    return true
  }
  const stripLeadingV = (s: string) =>
    s.startsWith('v') ? s.slice(1) : s
  return stripLeadingV(a) === stripLeadingV(b)
}

function createEditorExtensions(placeholder?: string) {
  const baseExtensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      codeBlock: false,
    }),
    articleLinkExtension,
    Underline,
    ...articleBodyNodeExtensions(),
  ]

  if (placeholder) {
    return [...baseExtensions, Placeholder.configure({ placeholder })]
  }

  return baseExtensions
}

/** Убирает узлы без type и прочий мусор, из‑за которого generateHTML падает. */
function sanitizeTipTapNode(node: unknown): unknown | null {
  if (!node || typeof node !== 'object') {
    return null
  }
  const n = node as Record<string, unknown>
  if (typeof n.type !== 'string' || !n.type.trim()) {
    return null
  }
  const out: Record<string, unknown> = { type: n.type }
  if (n.attrs !== undefined && n.attrs !== null && typeof n.attrs === 'object') {
    out.attrs = n.attrs
  }
  if (typeof n.text === 'string') {
    out.text = n.text
  }
  if (Array.isArray(n.marks)) {
    out.marks = n.marks.filter(
      (m) =>
        m &&
        typeof m === 'object' &&
        typeof (m as { type?: string }).type === 'string',
    )
  }
  if (Array.isArray(n.content)) {
    const children = n.content
      .map(sanitizeTipTapNode)
      .filter((c): c is unknown => c !== null)
    if (children.length > 0) {
      out.content = children
    }
  }
  return out
}

function sanitizeTipTapDoc(parsed: unknown): Record<string, unknown> {
  const fallback: Record<string, unknown> = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Не удалось прочитать содержимое статьи.' },
        ],
      },
    ],
  }
  if (!parsed || typeof parsed !== 'object') {
    return fallback
  }
  const d = parsed as Record<string, unknown>
  if (d.type !== 'doc') {
    return fallback
  }
  const raw = Array.isArray(d.content) ? d.content : []
  const content = raw
    .map(sanitizeTipTapNode)
    .filter((c): c is unknown => c !== null)
  return {
    type: 'doc',
    content:
      content.length > 0
        ? content
        : [{ type: 'paragraph', content: [] }],
  }
}

function safeParseContent(contentJson: string) {
  try {
    const parsed = JSON.parse(contentJson) as unknown
    return sanitizeTipTapDoc(parsed)
  } catch {
    return sanitizeTipTapDoc(null)
  }
}

function extractAssetId(src: string) {
  return src.startsWith(MEDIA_ASSET_REF_PREFIX)
    ? src.slice(MEDIA_ASSET_REF_PREFIX.length)
    : null
}

function assetSrc(assetId: string) {
  return `${MEDIA_ASSET_REF_PREFIX}${assetId}`
}

function dataUrlMimeType(src: string) {
  const match = /^data:([^;,]+)[;,]/i.exec(src)
  return match?.[1] ?? 'application/octet-stream'
}

function dataUrlSizeBytes(src: string) {
  const marker = ';base64,'
  const idx = src.indexOf(marker)
  if (idx === -1) {
    return null
  }

  const payload = src.slice(idx + marker.length)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

function mapTipTapContent(node: unknown, mapNode: (node: Record<string, unknown>) => Record<string, unknown>) {
  if (!node || typeof node !== 'object') {
    return node
  }

  const current = node as Record<string, unknown>
  const next = mapNode({ ...current })

  if (Array.isArray(next.content)) {
    next.content = next.content.map((child) =>
      mapTipTapContent(child, mapNode),
    )
  }

  return next
}

function collectAssetIdsFromContent(contentJson: string) {
  const ids = new Set<string>()
  const doc = safeParseContent(contentJson)

  mapTipTapContent(doc, (node) => {
    const attrs =
      node.attrs && typeof node.attrs === 'object'
        ? (node.attrs as Record<string, unknown>)
        : null
    const src = typeof attrs?.src === 'string' ? attrs.src : null
    const assetId = src ? extractAssetId(src) : null
    if (assetId) {
      ids.add(assetId)
    }
    return node
  })

  return [...ids]
}

function rewriteContentMedia(
  contentJson: string,
  rewrite: (payload: {
    nodeType: string
    src: string
    attrs: Record<string, unknown>
  }) => string | null,
) {
  const doc = safeParseContent(contentJson)

  const rewritten = mapTipTapContent(doc, (node) => {
    const nodeType = typeof node.type === 'string' ? node.type : ''
    if (nodeType !== 'image' && nodeType !== 'video') {
      return node
    }

    const attrs =
      node.attrs && typeof node.attrs === 'object'
        ? ({ ...(node.attrs as Record<string, unknown>) } satisfies Record<string, unknown>)
        : {}
    const src = typeof attrs.src === 'string' ? attrs.src : null
    if (!src) {
      return node
    }

    const nextSrc = rewrite({ nodeType, src, attrs })
    if (!nextSrc || nextSrc === src) {
      return node
    }

    return {
      ...node,
      attrs: {
        ...attrs,
        src: nextSrc,
      },
    }
  })

  return JSON.stringify(rewritten)
}

function extractEmbeddedMediaAssets(contentJson: string, articleId: string) {
  const assets: StoredMediaAsset[] = []
  const normalizedContentJson = rewriteContentMedia(contentJson, ({ nodeType, src }) => {
    if (!src.startsWith('data:')) {
      return src
    }

    const id = crypto.randomUUID()
    assets.push({
      id,
      articleId,
      kind: nodeType === 'video' ? 'video' : 'image',
      mimeType: dataUrlMimeType(src),
      dataUrl: src,
      sizeBytes: dataUrlSizeBytes(src),
      createdAt: new Date().toISOString(),
    })
    return assetSrc(id)
  })

  return { contentJson: normalizedContentJson, assets }
}

/** Транслитерация кириллицы (рус.) в латиницу для URL-slug без не-ASCII. */
const RU_TO_LAT: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

export function slugifyArticleTitle(title: string) {
  const lower = title.trim().toLowerCase()
  let translit = ''
  for (const ch of lower) {
    translit += RU_TO_LAT[ch] ?? ch
  }

  const ascii = translit
    .normalize('NFD')
    .replace(/\p{M}/gu, '')

  const base = ascii
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const slug = (base || 'article').slice(0, 96)
  return slug
}

type KnowledgeBaseDeps = {
  snapshotStore?: Pick<SnapshotStore, 'load' | 'save' | 'saveBackup' | 'loadBackup'>
  draftStore?: Pick<
    DraftStore,
    | 'getDraft'
    | 'listDrafts'
    | 'saveDraft'
    | 'discardDraft'
    | 'discardMany'
    | 'reconcileWithSnapshot'
  >
  mediaAssetStore?: Pick<
    MediaAssetStore,
    | 'saveDraftAssets'
    | 'getDraftAssets'
    | 'discardDraftAssets'
    | 'discardDraftAssetsMany'
  >
  platform?: PlatformBridge
  initSqlJsImpl?: typeof initSqlJs
}

type PreparedSnapshot = {
  bytes: Uint8Array
  meta: SnapshotMeta
  manifest: SnapshotManifest
  db: Database
}

export class KnowledgeBaseService {
  private sql: SqlJsStatic | null = null
  private db: Database | null = null
  private snapshotStore: NonNullable<KnowledgeBaseDeps['snapshotStore']>
  private draftStore: NonNullable<KnowledgeBaseDeps['draftStore']>
  private mediaAssetStore: NonNullable<KnowledgeBaseDeps['mediaAssetStore']>
  private platform: PlatformBridge
  private initSqlJsImpl: typeof initSqlJs
  private search = new MiniSearch<SearchHit>({
    fields: ['title', 'summary'],
    storeFields: ['slug', 'title', 'summary', 'sectionId'],
    searchOptions: {
      fuzzy: 0.2,
      prefix: true,
    },
  })

  constructor(deps: KnowledgeBaseDeps = {}) {
    this.snapshotStore = deps.snapshotStore ?? new SnapshotStore()
    this.draftStore = deps.draftStore ?? new DraftStore()
    this.mediaAssetStore = deps.mediaAssetStore ?? new MediaAssetStore()
    this.platform = deps.platform ?? platformBridge
    this.initSqlJsImpl = deps.initSqlJsImpl ?? initSqlJs
  }

  private async loadSql() {
    if (!this.sql) {
      this.sql = await this.initSqlJsImpl({
        locateFile: () => sqlWasmUrl,
      })
    }

    return this.sql
  }

  private ensureDb() {
    if (!this.db) {
      throw new Error('KnowledgeBaseService has not been bootstrapped yet.')
    }

    return this.db
  }

  private rowToSection(row: unknown[]) {
    return {
      id: String(row[0]),
      title: String(row[1]),
      parentId: row[2] ? String(row[2]) : null,
      orderIndex: Number(row[3]),
    } satisfies KnowledgeSection
  }

  private rowToArticle(row: unknown[]) {
    return {
      id: String(row[0]),
      sectionId: String(row[1]),
      slug: String(row[2]),
      title: String(row[3]),
      summary: String(row[4]),
      contentJson: String(row[5]),
      contentText: String(row[6]),
      updatedAt: String(row[7]),
      forBu: Number(row[8]) !== 0,
      forTkrs: Number(row[9]) !== 0,
    } satisfies KnowledgeArticle
  }

  private getRows(
    query: string,
    params: Array<string | number> = [],
    db = this.ensureDb(),
  ) {
    const result = db.exec(query, params)
    return result[0]?.values ?? []
  }

  private loadArticleAssetMap(
    assetIds: string[],
    db = this.ensureDb(),
  ): Record<string, StoredMediaAsset> {
    if (assetIds.length === 0) {
      return {}
    }

    const placeholders = assetIds.map(() => '?').join(', ')
    const rows = this.getRows(
      `SELECT id, article_id, kind, mime_type, url, size_bytes, created_at
       FROM assets
       WHERE id IN (${placeholders})`,
      assetIds,
      db,
    )

    return Object.fromEntries(
      rows.map((row) => [
        String(row[0]),
        {
          id: String(row[0]),
          articleId: String(row[1]),
          kind: String(row[2]) === 'video' ? 'video' : 'image',
          mimeType: String(row[3]),
          dataUrl: String(row[4]),
          sizeBytes:
            row[5] === null || row[5] === undefined ? null : Number(row[5]),
          createdAt: String(row[6]),
        } satisfies StoredMediaAsset,
      ]),
    )
  }

  private replaceArticleAssets(
    db: Database,
    articleId: string,
    assets: StoredMediaAsset[],
  ) {
    db.run('DELETE FROM assets WHERE article_id = ?', [articleId])

    if (assets.length === 0) {
      return
    }

    const statement = db.prepare(`
      INSERT INTO assets (
        id, article_id, kind, name, mime_type, url,
        checksum, size_bytes, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    assets.forEach((asset, index) => {
      const extension = asset.mimeType.split('/')[1] || 'bin'
      statement.run([
        asset.id,
        articleId,
        asset.kind,
        `${asset.kind}-${index + 1}.${extension}`,
        asset.mimeType,
        asset.dataUrl,
        null,
        asset.sizeBytes,
        asset.createdAt,
      ])
    })

    statement.free()
  }

  private async hydrateContentMedia(
    contentJson: string,
    loadAssets: (assetIds: string[]) => Promise<Record<string, StoredMediaAsset>>,
  ) {
    const assetIds = collectAssetIdsFromContent(contentJson)
    if (assetIds.length === 0) {
      return contentJson
    }

    const assets = await loadAssets(assetIds)
    return rewriteContentMedia(contentJson, ({ src }) => {
      const assetId = extractAssetId(src)
      return assetId ? assets[assetId]?.dataUrl ?? src : src
    })
  }

  private async persistSnapshot(db = this.ensureDb()) {
    await this.snapshotStore.save(db.export())
  }

  private async computeSnapshotChecksum(db: Database) {
    const SQL = await this.loadSql()
    const clone = new SQL.Database(db.export())
    const current = readSnapshotMeta(clone)

    stampSnapshotMeta(clone, {
      ...current,
      checksum: '',
      schemaVersion: Math.max(current.schemaVersion, SNAPSHOT_SCHEMA_VERSION),
    })

    const checksum = await this.platform.computeChecksum(clone.export())
    clone.close()
    return checksum
  }

  private async normalizeSnapshotMetadata(
    db: Database,
    overrides: Partial<Omit<SnapshotMeta, 'articleCount' | 'sectionCount'>> = {},
  ) {
    ensureSnapshotSchema(db)
    const current = readSnapshotMeta(db)

    stampSnapshotMeta(db, {
      version: overrides.version ?? current.version,
      updatedAt: overrides.updatedAt ?? current.updatedAt,
      publishedAt: overrides.publishedAt ?? current.publishedAt,
      schemaVersion:
        overrides.schemaVersion ??
        Math.max(current.schemaVersion, SNAPSHOT_SCHEMA_VERSION),
      checksum: '',
      source: overrides.source ?? current.source,
    })

    const checksum = await this.computeSnapshotChecksum(db)

    stampSnapshotMeta(db, {
      version: overrides.version ?? current.version,
      updatedAt: overrides.updatedAt ?? current.updatedAt,
      publishedAt: overrides.publishedAt ?? current.publishedAt,
      schemaVersion:
        overrides.schemaVersion ??
        Math.max(current.schemaVersion, SNAPSHOT_SCHEMA_VERSION),
      checksum,
      source: overrides.source ?? current.source,
    })

    return readSnapshotMeta(db)
  }

  private async listArticlesForSearchIndex(
    db = this.ensureDb(),
  ): Promise<KnowledgeArticle[]> {
    return this.getRows(
      'SELECT id, section_id, slug, title, summary, content_json, content_text, updated_at, audience_bu, audience_tkrs FROM articles ORDER BY title ASC',
      [],
      db,
    ).map((row: unknown[]) => this.rowToArticle(row))
  }

  private async rebuildSearch(db = this.ensureDb()) {
    const articles = await this.listArticlesForSearchIndex(db)
    this.search.removeAll()
    this.search.addAll(
      articles.map((article) => ({
        id: article.id,
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        sectionId: article.sectionId,
      })),
    )
  }

  private async applyDraftToDb(db: Database, articleId: string, draft: ArticleDraft) {
    const rows = db.exec(
      'SELECT section_id, audience_bu, audience_tkrs FROM articles WHERE id = ?',
      [articleId],
    )[0]?.values

    if (!rows?.[0]) {
      return false
    }

    const current = rows[0]
    const hydratedDraftContentJson = await this.resolveDraftContent(draft.contentJson)
    const normalizedDraft = extractEmbeddedMediaAssets(
      hydratedDraftContentJson,
      articleId,
    )
    const statement = db.prepare(`
      UPDATE articles
      SET
        section_id = ?,
        title = ?,
        summary = ?,
        content_json = ?,
        content_text = ?,
        updated_at = ?,
        audience_bu = ?,
        audience_tkrs = ?
      WHERE id = ?
    `)

    statement.run([
      draft.sectionId ?? String(current[0]),
      draft.title,
      draft.summary,
      normalizedDraft.contentJson,
      draft.contentText,
      draft.updatedAt,
      draft.forBu === undefined ? Number(current[1]) : draft.forBu ? 1 : 0,
      draft.forTkrs === undefined ? Number(current[2]) : draft.forTkrs ? 1 : 0,
      articleId,
    ])
    statement.free()
    this.replaceArticleAssets(db, articleId, normalizedDraft.assets)
    return true
  }

  private async buildPreparedSnapshot(
    db: Database,
    assetName: string,
  ): Promise<PreparedSnapshot> {
    const meta = await this.normalizeSnapshotMetadata(db)
    validateSnapshotDb(db)

    const manifest: SnapshotManifest = {
      version: meta.version,
      publishedAt: meta.publishedAt,
      schemaVersion: meta.schemaVersion,
      checksum: meta.checksum,
      assetName,
      articleCount: meta.articleCount,
      sectionCount: meta.sectionCount,
    }

    return {
      bytes: db.export(),
      meta,
      manifest,
      db,
    }
  }

  /** Раздел «Инструменты» в старых snapshot без миграции. */
  private ensureToolsSection() {
    const db = this.ensureDb()
    const probe = db.prepare('SELECT 1 FROM sections WHERE id = ? LIMIT 1')
    probe.bind([TOOLS_SECTION_ID])
    const exists = probe.step()
    probe.free()
    if (exists) {
      return
    }
    db.run(
      'INSERT INTO sections (id, title, parent_id, order_index) VALUES (?, ?, NULL, ?)',
      [TOOLS_SECTION_ID, 'Инструменты', 0],
    )
  }

  async bootstrap() {
    const SQL = await this.loadSql()
    const snapshot = await this.snapshotStore.load()

    this.db = snapshot ? new SQL.Database(snapshot) : createSeedDatabase(SQL)
    const meta = readSnapshotMeta(this.ensureDb())
    if (meta.source === 'seed' && meta.version !== seededSnapshotMeta.version) {
      this.db.close()
      this.db = createSeedDatabase(SQL)
    }
    this.ensureToolsSection()
    await this.normalizeSnapshotMetadata(this.ensureDb())
    await this.persistSnapshot()
    await this.rebuildSearch()
  }

  async listSections() {
    return this.getRows(
      'SELECT id, title, parent_id, order_index FROM sections ORDER BY order_index ASC, title ASC',
    ).map((row: unknown[]) => this.rowToSection(row))
  }

  async listArticles(audience: AudienceKind): Promise<KnowledgeArticle[]> {
    const all = await this.listArticlesForSearchIndex()
    return all.filter((article) =>
      audience === 'bu' ? article.forBu : article.forTkrs,
    )
  }

  async getArticleBySlug(slug: string) {
    const db = this.ensureDb()
    const statement = db.prepare(
      'SELECT id, section_id, slug, title, summary, content_json, content_text, updated_at, audience_bu, audience_tkrs FROM articles WHERE slug = ? LIMIT 1',
    )
    statement.bind([slug])

    let row: unknown[] | undefined
    if (statement.step()) {
      row = statement.get() as unknown[]
    }
    statement.free()

    return row ? this.rowToArticle(row) : null
  }

  async getDraft(articleId: string) {
    return this.draftStore.getDraft(articleId)
  }

  async listDrafts() {
    return this.draftStore.listDrafts()
  }

  async saveDraft(payload: ArticleDraft) {
    const normalized = extractEmbeddedMediaAssets(payload.contentJson, payload.articleId)
    await this.mediaAssetStore.saveDraftAssets(payload.articleId, normalized.assets)
    const currentMeta = await this.getSnapshotMeta()
    return this.draftStore.saveDraft({
      ...payload,
      contentJson: normalized.contentJson,
      status: payload.status ?? 'active',
      baseSnapshotVersion: currentMeta.version,
      baseSnapshotChecksum: currentMeta.checksum,
    })
  }

  async discardDraft(articleId: string) {
    await this.mediaAssetStore.discardDraftAssets(articleId)
    await this.draftStore.discardDraft(articleId)
  }

  async resolveArticleContent(contentJson: string) {
    return this.hydrateContentMedia(
      contentJson,
      async (assetIds) => this.loadArticleAssetMap(assetIds),
    )
  }

  async resolveDraftContent(contentJson: string) {
    return this.hydrateContentMedia(contentJson, (assetIds) =>
      this.mediaAssetStore.getDraftAssets(assetIds),
    )
  }

  async searchArticles(query: string, audience: AudienceKind) {
    if (!query.trim()) {
      return [] as SearchHit[]
    }

    const allowedIds = new Set(
      (await this.listArticles(audience)).map((article) => article.id),
    )

    return this.search
      .search(query)
      .filter((result) => allowedIds.has(String(result.id)))
      .map((result) => ({
        id: String(result.id),
        slug: String(result.slug),
        title: String(result.title),
        summary: String(result.summary),
        sectionId: String(result.sectionId),
      }))
  }

  async getSnapshotMeta() {
    return readSnapshotMeta(this.ensureDb())
  }

  async checkForUpdates(
    settings: GitHubReleaseSettings,
  ): Promise<UpdateCheckResult> {
    const manifestAssetName =
      settings.manifestAssetName || getManifestAssetName(settings.assetName)

    if (
      !settings.owner.trim() ||
      !settings.repo.trim() ||
      !settings.assetName.trim()
    ) {
      return {
        status: 'not-configured',
        message: RELEASE_SOURCE_NOT_CONFIGURED_MESSAGE,
      }
    }

    const release = await fetchLatestRelease(this.platform, settings)
    const asset =
      release.assets.find((item) => item.name === settings.assetName) ?? null
    const manifestAsset =
      release.assets.find((item) => item.name === manifestAssetName) ?? null
    const current = await this.getSnapshotMeta()

    let remoteChecksum: string | undefined
    let remoteManifestVersion: string | undefined
    if (manifestAsset) {
      try {
        const manifest = await this.platform.requestJson<SnapshotManifest>(
          manifestAsset.browser_download_url,
        )
        remoteChecksum = manifest.checksum
        remoteManifestVersion = manifest.version
      } catch {
        remoteChecksum = undefined
        remoteManifestVersion = undefined
      }
    }

    if (!asset) {
      return {
        status: 'up-to-date',
        latestVersion: release.tag_name,
        assetUrl: null,
        manifestUrl: manifestAsset?.browser_download_url ?? null,
        checksum: remoteChecksum,
        message: 'Релиз найден, но нужный snapshot asset отсутствует.',
      }
    }

    const remote = remoteChecksum?.trim()
    const local = current.checksum.trim()

    // 1) Версия из манифеста — главный идентификатор релиза (напр. `16-213045`), тег GitHub может отличаться.
    // Не требуем совпадения checksum: после bootstrap локальный hash может чуть расходиться с json (sql.js export).
    if (
      remoteManifestVersion != null &&
      remoteManifestVersion.trim() !== '' &&
      normalizeSnapshotVersionLabel(remoteManifestVersion) ===
        normalizeSnapshotVersionLabel(current.version)
    ) {
      return {
        status: 'up-to-date',
        latestVersion: release.tag_name,
        assetUrl: asset.browser_download_url,
        manifestUrl: manifestAsset?.browser_download_url ?? null,
        checksum: remoteChecksum,
        message: 'У вас уже активна последняя версия базы знаний.',
      }
    }

    // 2) Совпадение checksum (регистр hex и пробелы не должны ломать сравнение).
    if (remote && local && snapshotChecksumsEqual(remote, local)) {
      return {
        status: 'up-to-date',
        latestVersion: release.tag_name,
        assetUrl: asset.browser_download_url,
        manifestUrl: manifestAsset?.browser_download_url ?? null,
        checksum: remoteChecksum,
        message: 'У вас уже активна последняя версия базы знаний.',
      }
    }

    // 3) Тег релиза совпадает с версией в базе (в т.ч. префикс `v`), checksum не противоречит.
    if (
      releaseTagMatchesSnapshotVersion(release.tag_name, current.version) &&
      (!remote || !local || snapshotChecksumsEqual(remote, local))
    ) {
      return {
        status: 'up-to-date',
        latestVersion: release.tag_name,
        assetUrl: asset.browser_download_url,
        manifestUrl: manifestAsset?.browser_download_url ?? null,
        checksum: remoteChecksum,
        message: 'У вас уже активна последняя версия базы знаний.',
      }
    }

    return {
      status: 'update-available',
      latestVersion: release.tag_name,
      assetUrl: asset.browser_download_url,
      manifestUrl: manifestAsset?.browser_download_url ?? null,
      checksum: remoteChecksum,
      message: 'Найдена новая версия базы знаний.',
    }
  }

  async createArticle(input: CreateArticleInput): Promise<KnowledgeArticle> {
    const title = input.title.trim()
    const summary = input.summary?.trim() || title.slice(0, 240)

    if (!title) {
      throw new Error('Укажите заголовок статьи.')
    }

    if (!input.forBu && !input.forTkrs) {
      throw new Error('Выберите хотя бы один тип: БУРОВАЯ или ТКРС.')
    }

    if (input.sectionId === TOOLS_SECTION_ID) {
      throw new Error('В раздел «Инструменты» нельзя добавлять статьи.')
    }

    const slugBase = slugifyArticleTitle(title)

    let slug = slugBase
    let suffix = 2
    while (await this.getArticleBySlug(slug)) {
      slug = `${slugBase}-${suffix}`
      suffix += 1
    }

    const id = crypto.randomUUID()
    const updatedAt = new Date().toISOString()
    const db = this.ensureDb()
    const normalized = extractEmbeddedMediaAssets(input.contentJson, id)
    const statement = db.prepare(`
      INSERT INTO articles (
        id, section_id, slug, title, summary,
        content_json, content_text, updated_at,
        audience_bu, audience_tkrs
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    statement.run([
      id,
      input.sectionId,
      slug,
      title,
      summary,
      normalized.contentJson,
      input.contentText,
      updatedAt,
      input.forBu ? 1 : 0,
      input.forTkrs ? 1 : 0,
    ])
    statement.free()
    this.replaceArticleAssets(db, id, normalized.assets)

    await this.normalizeSnapshotMetadata(db, {
      updatedAt,
      source: 'local',
    })
    await this.persistSnapshot(db)
    await this.rebuildSearch(db)

    const created = await this.getArticleBySlug(slug)
    if (!created) {
      throw new Error('Не удалось прочитать созданную статью.')
    }

    await addPendingLocalArticleId(created.id)

    return created
  }

  async getPendingLocalArticleIds(): Promise<Set<string>> {
    return getPendingLocalArticleIds()
  }

  async deleteArticle(articleId: string): Promise<void> {
    const db = this.ensureDb()
    const probe = db.prepare('SELECT 1 FROM articles WHERE id = ? LIMIT 1')
    probe.bind([articleId])
    const exists = probe.step()
    probe.free()
    if (!exists) {
      throw new Error('Статья не найдена.')
    }

    db.run('DELETE FROM assets WHERE article_id = ?', [articleId])
    db.run('DELETE FROM articles WHERE id = ?', [articleId])

    const updatedAt = new Date().toISOString()
    await this.normalizeSnapshotMetadata(db, {
      updatedAt,
      source: 'local',
    })
    await this.persistSnapshot(db)
    await this.rebuildSearch(db)
    await this.mediaAssetStore.discardDraftAssets(articleId)
    await this.draftStore.discardDraft(articleId)
    await removePendingLocalArticleId(articleId)
  }

  async publishSnapshot(input: PublishSnapshotInput): Promise<PublishSnapshotResult> {
    if (!input.token.trim()) {
      throw new Error('Укажите GitHub token для публикации snapshot.')
    }

    if (!input.version.trim()) {
      throw new Error('Укажите версию snapshot перед публикацией.')
    }

    const SQL = await this.loadSql()
    const workingDb = new SQL.Database(this.ensureDb().export())
    const drafts = await this.draftStore.listDrafts()
    const mergedDraftIds: string[] = []

    for (const [articleId, draft] of Object.entries(drafts)) {
      if (draft.status === 'orphaned') {
        continue
      }

      if (await this.applyDraftToDb(workingDb, articleId, draft)) {
        mergedDraftIds.push(articleId)
      }
    }

    const now = new Date().toISOString()
    await this.normalizeSnapshotMetadata(workingDb, {
      version: input.version.trim(),
      updatedAt: now,
      publishedAt: now,
      source: 'release',
    })

    const prepared = await this.buildPreparedSnapshot(
      workingDb,
      input.settings.assetName,
    )
    const release = await getOrCreateRelease(
      this.platform,
      input.settings,
      prepared.meta.version,
      input.releaseNotes,
      input.token.trim(),
    )
    const manifestAssetName =
      input.settings.manifestAssetName ||
      getManifestAssetName(input.settings.assetName)

    await Promise.all(
      release.assets
        .filter(
          (asset) =>
            asset.name === input.settings.assetName ||
            asset.name === manifestAssetName,
        )
        .map((asset) =>
          deleteReleaseAsset(
            this.platform,
            input.settings,
            asset.id,
            input.token.trim(),
          ),
        ),
    )

    const snapshotAsset = await uploadReleaseAsset(
      this.platform,
      release,
      input.settings.assetName,
      prepared.bytes,
      input.token.trim(),
      'application/vnd.sqlite3',
    )
    const manifestAsset = await uploadReleaseAsset(
      this.platform,
      release,
      manifestAssetName,
      new TextEncoder().encode(JSON.stringify(prepared.manifest, null, 2)),
      input.token.trim(),
      'application/json',
    )

    this.db = prepared.db
    await this.persistSnapshot(prepared.db)
    await this.rebuildSearch(prepared.db)
    await this.mediaAssetStore.discardDraftAssetsMany(mergedDraftIds)
    await this.draftStore.discardMany(mergedDraftIds)
    await clearPendingLocalArticleIds()

    return {
      version: prepared.meta.version,
      checksum: prepared.meta.checksum,
      releaseUrl: release.html_url,
      assetUrl: snapshotAsset.browser_download_url,
      manifestUrl: manifestAsset.browser_download_url,
    }
  }

  async applySnapshotUpdate(
    input: ApplySnapshotUpdateInput,
    onStageChange?: (stage: ApplySnapshotUpdateStage, message: string) => void,
  ): Promise<ApplySnapshotUpdateResult> {
    const SQL = await this.loadSql()
    const backup = this.ensureDb().export()
    await this.snapshotStore.saveBackup(backup)
    onStageChange?.('backup', 'Создан backup текущего snapshot.')

    try {
      onStageChange?.('download', 'Загрузка snapshot из GitHub Releases.')
      const bytes = await this.platform.downloadBinary(input.downloadUrl, {
        onProgress: ({ loaded, total }) => {
          if (!total) {
            onStageChange?.(
              'download',
              `Скачано ${Math.round(loaded / 1024)} KB snapshot.`,
            )
            return
          }

          const percent = Math.round((loaded / total) * 100)
          onStageChange?.(
            'download',
            `Загрузка snapshot: ${percent}% (${Math.round(loaded / 1024)} / ${Math.round(total / 1024)} KB).`,
          )
        },
      })
      const db = new SQL.Database(bytes)
      ensureSnapshotSchema(db)
      const embeddedMeta = readSnapshotMeta(db)

      onStageChange?.('verify', 'Проверяю схему, метаданные и checksum.')
      if (
        input.checksum?.trim() &&
        embeddedMeta.checksum.trim() !== input.checksum.trim()
      ) {
        throw new Error('Checksum загруженного snapshot не совпадает с manifest.')
      }
      validateSnapshotDb(db)

      await this.normalizeSnapshotMetadata(db, {
        version: embeddedMeta.version.trim() || input.version.trim(),
        updatedAt: embeddedMeta.updatedAt || new Date().toISOString(),
        publishedAt: embeddedMeta.publishedAt || new Date().toISOString(),
        source: 'release',
      })
      validateSnapshotDb(db)

      const nextMeta = readSnapshotMeta(db)

      onStageChange?.('apply', 'Применяю snapshot и перестраиваю поиск.')
      this.db = db
      await this.persistSnapshot(db)
      await this.rebuildSearch(db)

      onStageChange?.('reconcile', 'Проверяю локальные черновики после обновления.')
      const drafts = await this.draftStore.reconcileWithSnapshot(
        await this.listArticlesForSearchIndex(db),
        nextMeta,
      )

      await clearPendingLocalArticleIds()

      onStageChange?.('done', 'Новый snapshot успешно применен.')
      return {
        meta: nextMeta,
        drafts,
      }
    } catch (error) {
      onStageChange?.('restore', 'Возвращаю предыдущий snapshot из backup.')
      const restored = new SQL.Database(backup)
      this.db = restored
      await this.persistSnapshot(restored)
      await this.rebuildSearch(restored)
      throw error
    }
  }

  exportSnapshotBytes(): Uint8Array {
    return new Uint8Array(this.ensureDb().export())
  }

  async importSnapshotFromBytes(bytes: Uint8Array): Promise<SnapshotMeta> {
    const SQL = await this.loadSql()
    const backup = this.ensureDb().export()
    await this.snapshotStore.saveBackup(backup)

    try {
      const db = new SQL.Database(bytes)
      const loadedMeta = readSnapshotMeta(db)
      await this.normalizeSnapshotMetadata(db, {
        version: loadedMeta.version,
        updatedAt: loadedMeta.updatedAt || new Date().toISOString(),
        publishedAt: loadedMeta.publishedAt || new Date().toISOString(),
        source: loadedMeta.source,
      })
      validateSnapshotDb(db)

      const nextMeta = readSnapshotMeta(db)
      this.db = db
      await this.persistSnapshot(db)
      await this.rebuildSearch(db)

      await this.draftStore.reconcileWithSnapshot(
        await this.listArticlesForSearchIndex(db),
        nextMeta,
      )
      await clearPendingLocalArticleIds()

      return nextMeta
    } catch (error) {
      const restored = new SQL.Database(backup)
      this.db = restored
      await this.persistSnapshot(restored)
      await this.rebuildSearch(restored)
      throw error
    }
  }
}

export const knowledgeBase = new KnowledgeBaseService()

export function renderKnowledgeHtml(contentJson: string) {
  try {
    const doc = safeParseContent(contentJson)
    return generateHTML(doc, createEditorExtensions())
  } catch {
    return '<p>Не удалось отобразить содержимое статьи.</p>'
  }
}

export type ArticleTocItem = { id: string; title: string }

function extractTextFromTipTapNode(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return ''
  }
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (n.type === 'text' && typeof n.text === 'string') {
    return n.text
  }
  if (Array.isArray(n.content)) {
    return n.content.map(extractTextFromTipTapNode).join('')
  }
  return ''
}

function extractH2TitlesFromDoc(doc: unknown): string[] {
  const out: string[] = []
  const content = (doc as { content?: unknown[] }).content
  if (!Array.isArray(content)) {
    return out
  }
  for (const node of content) {
    if (!node || typeof node !== 'object') {
      continue
    }
    const n = node as { type?: string; attrs?: { level?: number } }
    if (n.type === 'heading' && n.attrs?.level === 2) {
      out.push(extractTextFromTipTapNode(node).trim())
    }
  }
  return out
}

/** HTML тела статьи с id у заголовков блоков (h2) и список для оглавления. */
export function renderArticleBodyForView(contentJson: string): {
  html: string
  toc: ArticleTocItem[]
} {
  const doc = safeParseContent(contentJson)
  const titles = extractH2TitlesFromDoc(doc)
  const toc: ArticleTocItem[] = titles.map((title, i) => ({
    id: `article-block-${i}`,
    title: title || `Раздел ${i + 1}`,
  }))

  let html = renderKnowledgeHtml(contentJson)
  let idx = 0
  html = html.replace(/<h2\b[^>]*>/gi, (tag) => {
    if (idx >= toc.length) {
      return tag
    }
    const id = toc[idx++].id
    if (/\bid\s*=/i.test(tag)) {
      return tag
    }
    return tag.replace(/<h2/i, `<h2 id="${id}"`)
  })

  return { html, toc }
}

export function editorExtensions(placeholder?: string) {
  return createEditorExtensions(placeholder)
}
