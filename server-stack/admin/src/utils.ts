const RU: Record<string, string> = {
  а: 'a',  б: 'b',  в: 'v',  г: 'g',  д: 'd',  е: 'e',  ё: 'yo',
  ж: 'zh', з: 'z',  и: 'i',  й: 'y',  к: 'k',  л: 'l',  м: 'm',
  н: 'n',  о: 'o',  п: 'p',  р: 'r',  с: 's',  т: 't',  у: 'u',
  ф: 'f',  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '',   ы: 'y',  ь: '',   э: 'e',  ю: 'yu', я: 'ya'
}

export function toSlug(s: string, fallback = 'item'): string {
  const slug = s
    .trim()
    .toLowerCase()
    .split('')
    .map((c) => RU[c] ?? c)
    .join('')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return slug || fallback
}

/** Stable HTML filename from article title (transliterates Cyrillic). */
export function titleToHtmlFile(title: string, articleId: string): string {
  return `${toSlug(title, articleId)}.html`
}

export function hasUnpublishedChanges(
  published: boolean,
  updatedAt: string,
  publishedAt: string | null | undefined
): boolean {
  if (!published || !publishedAt) return false
  return new Date(updatedAt).getTime() > new Date(publishedAt).getTime()
}

export type ArticlePublishStatus = 'draft' | 'published' | 'modified'

export function getArticlePublishStatus(
  published: boolean,
  updatedAt: string,
  publishedAt: string | null | undefined
): ArticlePublishStatus {
  if (!published) return 'draft'
  if (hasUnpublishedChanges(published, updatedAt, publishedAt)) return 'modified'
  return 'published'
}

export const PUBLISH_STATUS_LABEL: Record<ArticlePublishStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликовано',
  modified: 'Есть неопубликованные изменения'
}
