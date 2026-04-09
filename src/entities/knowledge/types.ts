/** БУРОВАЯ — буровой контур; ТКРС — товарно-кредитная розничная сеть (или ваш внутренний контур). */
export type AudienceKind = 'bu' | 'tkrs'

export type KnowledgeSection = {
  id: string
  title: string
  parentId: string | null
  orderIndex: number
}

export type KnowledgeArticleSummary = {
  id: string
  sectionId: string
  slug: string
  title: string
  summary: string
  updatedAt: string
  /** Статья показывается в контуре «БУРОВАЯ» */
  forBu: boolean
  /** Статья показывается в контуре ТКРС */
  forTkrs: boolean
}

export type KnowledgeArticle = KnowledgeArticleSummary & {
  contentJson: string
  contentText: string
}

export type DraftStatus = 'active' | 'orphaned'

export type ArticleDraft = {
  articleId: string
  title: string
  summary: string
  contentJson: string
  contentText: string
  updatedAt: string
  /** Локально изменённые поля (в snapshot до публикации не попадают) */
  sectionId?: string
  forBu?: boolean
  forTkrs?: boolean
  baseSnapshotVersion?: string
  baseSnapshotChecksum?: string
  status?: DraftStatus
  issue?: string
}

export type SearchHit = {
  id: string
  slug: string
  title: string
  summary: string
  sectionId: string
}

export type SnapshotMeta = {
  version: string
  updatedAt: string
  publishedAt: string
  schemaVersion: number
  checksum: string
  articleCount: number
  sectionCount: number
  source: 'seed' | 'local' | 'release'
}

export type CreateArticleInput = {
  title: string
  /** Если не задано, в БД подставляется из заголовка */
  summary?: string
  sectionId: string
  contentJson: string
  contentText: string
  forBu: boolean
  forTkrs: boolean
}

export type GitHubReleaseSettings = {
  owner: string
  repo: string
  assetName: string
  manifestAssetName: string
}

export type SnapshotManifest = {
  version: string
  publishedAt: string
  schemaVersion: number
  checksum: string
  assetName: string
  articleCount: number
  sectionCount: number
}

export type UpdateCheckResult =
  | {
      status: 'not-configured'
      message: string
    }
  | {
      status: 'up-to-date'
      latestVersion: string
      assetUrl: string | null
      manifestUrl: string | null
      checksum?: string
      message: string
    }
  | {
      status: 'update-available'
      latestVersion: string
      assetUrl: string
      manifestUrl: string | null
      checksum?: string
      message: string
    }

export type DraftReconcileReport = {
  active: number
  orphaned: number
}

export type ApplySnapshotUpdateStage =
  | 'backup'
  | 'download'
  | 'verify'
  | 'apply'
  | 'reconcile'
  | 'restore'
  | 'done'

export type ApplySnapshotUpdateInput = {
  downloadUrl: string
  version: string
  manifestUrl?: string | null
  checksum?: string
}

export type ApplySnapshotUpdateResult = {
  meta: SnapshotMeta
  drafts: DraftReconcileReport
}

export type PublishSnapshotInput = {
  settings: GitHubReleaseSettings
  token: string
  version: string
  releaseNotes?: string
}

export type PublishSnapshotResult = {
  version: string
  checksum: string
  releaseUrl: string
  assetUrl: string
  manifestUrl: string
}
