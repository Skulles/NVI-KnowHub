import { get, set } from 'idb-keyval'
import type {
  ArticleDraft,
  DraftReconcileReport,
  KnowledgeArticle,
  SnapshotMeta,
} from '../../../entities/knowledge/types'

const DRAFTS_KEY = 'knowhub-local-drafts'

export class DraftStore {
  private async getDraftMap() {
    return (await get<Record<string, ArticleDraft>>(DRAFTS_KEY)) ?? {}
  }

  private async setDraftMap(payload: Record<string, ArticleDraft>) {
    await set(DRAFTS_KEY, payload)
  }

  async getDraft(articleId: string) {
    const drafts = await this.getDraftMap()
    return drafts[articleId] ?? null
  }

  async listDrafts() {
    return this.getDraftMap()
  }

  async saveDraft(payload: ArticleDraft) {
    const drafts = await this.getDraftMap()
    drafts[payload.articleId] = {
      ...payload,
      status: payload.status ?? 'active',
    }
    await this.setDraftMap(drafts)
    return drafts[payload.articleId]
  }

  async discardDraft(articleId: string) {
    const drafts = await this.getDraftMap()
    delete drafts[articleId]
    await this.setDraftMap(drafts)
  }

  async discardMany(articleIds: string[]) {
    if (articleIds.length === 0) {
      return
    }

    const drafts = await this.getDraftMap()
    articleIds.forEach((articleId) => {
      delete drafts[articleId]
    })
    await this.setDraftMap(drafts)
  }

  async reconcileWithSnapshot(
    articles: KnowledgeArticle[],
    snapshotMeta: SnapshotMeta,
  ): Promise<DraftReconcileReport> {
    const drafts = await this.getDraftMap()
    const articleIds = new Set(articles.map((article) => article.id))
    let active = 0
    let orphaned = 0

    Object.entries(drafts).forEach(([articleId, draft]) => {
      if (articleIds.has(articleId)) {
        drafts[articleId] = {
          ...draft,
          status: 'active',
          issue: undefined,
          baseSnapshotVersion: snapshotMeta.version,
          baseSnapshotChecksum: snapshotMeta.checksum,
        }
        active += 1
        return
      }

      drafts[articleId] = {
        ...draft,
        status: 'orphaned',
        issue: `Статья отсутствует в snapshot ${snapshotMeta.version}.`,
        baseSnapshotVersion: snapshotMeta.version,
        baseSnapshotChecksum: snapshotMeta.checksum,
      }
      orphaned += 1
    })

    await this.setDraftMap(drafts)

    return { active, orphaned }
  }
}
