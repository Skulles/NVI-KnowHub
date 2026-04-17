import type { Database, SqlJsStatic } from 'sql.js'
import type {
  KnowledgeArticle,
  KnowledgeSection,
  SnapshotMeta,
} from '../../../entities/knowledge/types'
import { TOOLS_SECTION_ID } from '../../../entities/knowledge/types'

export const SNAPSHOT_SCHEMA_VERSION = 2
export const SNAPSHOT_MANIFEST_SUFFIX = '.manifest.json'

export const seededSnapshotMeta = {
  version: 'seed-3',
  updatedAt: '2026-04-08T18:30:00.000Z',
  publishedAt: '2026-04-08T18:30:00.000Z',
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  checksum: 'pending',
  source: 'seed',
} satisfies Omit<SnapshotMeta, 'articleCount' | 'sectionCount'>

export const seedSections: KnowledgeSection[] = [
  { id: TOOLS_SECTION_ID, title: 'Инструменты', parentId: null, orderIndex: 0 },
  { id: 'svyaz', title: 'Связь', parentId: null, orderIndex: 1 },
  { id: 'kamery', title: 'Камеры', parentId: null, orderIndex: 2 },
  { id: 'dokumenty', title: 'Документы', parentId: null, orderIndex: 3 },
]

export const seedArticles: KnowledgeArticle[] = []

export const snapshotSchema = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT,
    order_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    content_json TEXT NOT NULL,
    content_text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    audience_bu INTEGER NOT NULL DEFAULT 1,
    audience_tkrs INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    url TEXT NOT NULL,
    checksum TEXT,
    size_bytes INTEGER,
    created_at TEXT NOT NULL
  );
`

function getSingleValue(db: Database, query: string) {
  const result = db.exec(query)
  return result[0]?.values[0]?.[0]
}

function getCounts(db: Database) {
  return {
    articleCount: Number(getSingleValue(db, 'SELECT COUNT(*) FROM articles') ?? 0),
    sectionCount: Number(getSingleValue(db, 'SELECT COUNT(*) FROM sections') ?? 0),
  }
}

export function upsertAppMeta(db: Database, values: Record<string, string>) {
  const statement = db.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)

  Object.entries(values).forEach(([key, value]) => {
    statement.run([key, value])
  })

  statement.free()
}

export function readAppMeta(db: Database) {
  const rows =
    db.exec('SELECT key, value FROM app_meta')[0]?.values.map((row) => [
      String(row[0]),
      String(row[1]),
    ]) ?? []

  return Object.fromEntries(rows)
}

export function ensureSnapshotSchema(db: Database) {
  db.run(snapshotSchema)

  try {
    db.run(
      'ALTER TABLE articles ADD COLUMN audience_bu INTEGER NOT NULL DEFAULT 1',
    )
  } catch {
    /* column exists */
  }

  try {
    db.run(
      'ALTER TABLE articles ADD COLUMN audience_tkrs INTEGER NOT NULL DEFAULT 1',
    )
  } catch {
    /* column exists */
  }

  const meta = readAppMeta(db)

  upsertAppMeta(db, {
    schemaVersion:
      meta.schemaVersion ?? String(SNAPSHOT_SCHEMA_VERSION),
    version: meta.version ?? seededSnapshotMeta.version,
    updatedAt: meta.updatedAt ?? seededSnapshotMeta.updatedAt,
    publishedAt: meta.publishedAt ?? seededSnapshotMeta.publishedAt,
    checksum: meta.checksum ?? seededSnapshotMeta.checksum,
    source: meta.source ?? seededSnapshotMeta.source,
  })
}

export function readSnapshotMeta(db: Database): SnapshotMeta {
  const meta = readAppMeta(db)
  const counts = getCounts(db)

  return {
    version: meta.version ?? seededSnapshotMeta.version,
    updatedAt: meta.updatedAt ?? seededSnapshotMeta.updatedAt,
    publishedAt: meta.publishedAt ?? seededSnapshotMeta.publishedAt,
    schemaVersion: Number(
      meta.schemaVersion ?? seededSnapshotMeta.schemaVersion,
    ),
    checksum: meta.checksum ?? seededSnapshotMeta.checksum,
    source:
      meta.source === 'local' || meta.source === 'release'
        ? meta.source
        : 'seed',
    articleCount: counts.articleCount,
    sectionCount: counts.sectionCount,
  }
}

export function stampSnapshotMeta(
  db: Database,
  meta: Omit<SnapshotMeta, 'articleCount' | 'sectionCount'>,
) {
  const counts = getCounts(db)

  upsertAppMeta(db, {
    version: meta.version,
    updatedAt: meta.updatedAt,
    publishedAt: meta.publishedAt,
    schemaVersion: String(meta.schemaVersion),
    checksum: meta.checksum,
    source: meta.source,
    articleCount: String(counts.articleCount),
    sectionCount: String(counts.sectionCount),
  })
}

export function validateSnapshotDb(db: Database) {
  db.exec('SELECT COUNT(*) FROM sections')
  db.exec('SELECT COUNT(*) FROM articles')
  db.exec('SELECT 1 FROM app_meta LIMIT 1')

  const meta = readSnapshotMeta(db)

  if (!meta.version.trim()) {
    throw new Error('Snapshot version is missing.')
  }

  if (!meta.updatedAt.trim()) {
    throw new Error('Snapshot updatedAt is missing.')
  }

  if (!meta.publishedAt.trim()) {
    throw new Error('Snapshot publishedAt is missing.')
  }

  if (!meta.checksum.trim()) {
    throw new Error('Snapshot checksum is missing.')
  }

  if (meta.schemaVersion < SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('Snapshot schemaVersion is outdated.')
  }

  const brokenArticles =
    db.exec(`
      SELECT articles.id
      FROM articles
      LEFT JOIN sections ON sections.id = articles.section_id
      WHERE sections.id IS NULL
      LIMIT 1
    `)[0]?.values ?? []

  if (brokenArticles.length > 0) {
    throw new Error('Snapshot contains articles linked to missing sections.')
  }
}

export function createSeedDatabase(SQL: SqlJsStatic) {
  const db = new SQL.Database()
  ensureSnapshotSchema(db)

  const insertSection = db.prepare(`
    INSERT INTO sections (id, title, parent_id, order_index)
    VALUES (?, ?, ?, ?)
  `)

  seedSections.forEach((section) => {
    insertSection.run([
      section.id,
      section.title,
      section.parentId,
      section.orderIndex,
    ])
  })
  insertSection.free()

  const insertArticle = db.prepare(`
    INSERT INTO articles (
      id, section_id, slug, title, summary,
      content_json, content_text, updated_at,
      audience_bu, audience_tkrs
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  seedArticles.forEach((article) => {
    insertArticle.run([
      article.id,
      article.sectionId,
      article.slug,
      article.title,
      article.summary,
      article.contentJson,
      article.contentText,
      article.updatedAt,
      article.forBu ? 1 : 0,
      article.forTkrs ? 1 : 0,
    ])
  })
  insertArticle.free()

  stampSnapshotMeta(db, seededSnapshotMeta)

  return db
}

export function getManifestAssetName(assetName: string) {
  return `${assetName}${SNAPSHOT_MANIFEST_SUFFIX}`
}
