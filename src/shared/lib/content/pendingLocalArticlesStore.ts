import { get, set } from 'idb-keyval'

const KEY = 'knowhub-pending-local-article-ids'

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

/** Статьи, созданные через createArticle и ещё не попавшие в опубликованный release (после публикации список очищается). */
export async function getPendingLocalArticleIds(): Promise<Set<string>> {
  if (!hasIndexedDb()) {
    return new Set()
  }
  const list = await get<string[]>(KEY)
  return new Set(list ?? [])
}

export async function addPendingLocalArticleId(articleId: string): Promise<void> {
  if (!hasIndexedDb()) {
    return
  }
  const list = (await get<string[]>(KEY)) ?? []
  if (!list.includes(articleId)) {
    await set(KEY, [...list, articleId])
  }
}

export async function clearPendingLocalArticleIds(): Promise<void> {
  if (!hasIndexedDb()) {
    return
  }
  await set(KEY, [])
}

export async function removePendingLocalArticleId(
  articleId: string,
): Promise<void> {
  if (!hasIndexedDb()) {
    return
  }
  const list = (await get<string[]>(KEY)) ?? []
  const next = list.filter((id) => id !== articleId)
  await set(KEY, next)
}
