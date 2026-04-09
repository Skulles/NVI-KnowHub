import { del, get, set } from 'idb-keyval'

export type StoredMediaAsset = {
  id: string
  articleId: string
  kind: 'image' | 'video'
  mimeType: string
  dataUrl: string
  sizeBytes: number | null
  createdAt: string
}

const DRAFT_MEDIA_INDEX_KEY = 'knowhub-draft-media-index'
const DRAFT_MEDIA_PREFIX = 'knowhub-draft-media:'

function assetKey(assetId: string) {
  return `${DRAFT_MEDIA_PREFIX}${assetId}`
}

export class MediaAssetStore {
  private async getIndex() {
    return (await get<Record<string, string[]>>(DRAFT_MEDIA_INDEX_KEY)) ?? {}
  }

  private async setIndex(index: Record<string, string[]>) {
    await set(DRAFT_MEDIA_INDEX_KEY, index)
  }

  async saveDraftAssets(articleId: string, assets: StoredMediaAsset[]) {
    const index = await this.getIndex()
    const previousIds = new Set(index[articleId] ?? [])
    const nextIds = assets.map((asset) => asset.id)

    await Promise.all(
      assets.map((asset) => set(assetKey(asset.id), { ...asset, articleId })),
    )

    index[articleId] = nextIds
    await this.setIndex(index)

    await Promise.all(
      [...previousIds]
        .filter((assetId) => !nextIds.includes(assetId))
        .map((assetId) => del(assetKey(assetId))),
    )
  }

  async getDraftAssets(assetIds: string[]) {
    const entries = await Promise.all(
      assetIds.map(async (assetId) => {
        const asset = await get<StoredMediaAsset>(assetKey(assetId))
        return asset ? [assetId, asset] : null
      }),
    )

    return Object.fromEntries(
      entries.filter((entry): entry is [string, StoredMediaAsset] => entry !== null),
    )
  }

  async discardDraftAssets(articleId: string) {
    const index = await this.getIndex()
    const assetIds = index[articleId] ?? []

    delete index[articleId]
    await this.setIndex(index)
    await Promise.all(assetIds.map((assetId) => del(assetKey(assetId))))
  }

  async discardDraftAssetsMany(articleIds: string[]) {
    await Promise.all(articleIds.map((articleId) => this.discardDraftAssets(articleId)))
  }
}
