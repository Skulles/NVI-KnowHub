/** Путь к статье с безопасным кодированием slug (в т.ч. для не-ASCII из старых данных). */
export function articlePath(slug: string): string {
  return `/article/${encodeURIComponent(slug)}`
}

/** Параметр :slug из react-router после перехода по articlePath. */
export function decodeArticleSlugParam(param: string): string {
  try {
    return decodeURIComponent(param)
  } catch {
    return param
  }
}
