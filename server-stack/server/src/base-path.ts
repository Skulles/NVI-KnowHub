/** URL prefix when KnowHub is served under a subpath (e.g. /nvi/kh). No trailing slash. */
export function basePath(): string {
  const raw = process.env.BASE_PATH?.trim()
  if (!raw) return ''
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.replace(/\/+$/, '')
}

export function withBase(path: string): string {
  const prefix = basePath()
  const normalized = path.startsWith('/') ? path : `/${path}`
  return prefix ? `${prefix}${normalized}` : normalized
}
