import { isAbsolute, relative, resolve, sep } from 'path'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/** Allow only safe schemes for shell.openExternal / window.open. */
export function isAllowedExternalUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const parsed = new URL(url)
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Resolve a content-relative path and ensure it stays inside `contentRoot`.
 * Rejects absolute paths, null bytes, `..` escapes, and non-.html names.
 */
export function resolveContentHtmlPath(contentRoot: string, htmlFile: string): string | null {
  if (typeof htmlFile !== 'string' || !htmlFile.trim()) return null
  if (htmlFile.includes('\0')) return null
  if (isAbsolute(htmlFile)) return null

  const normalized = htmlFile.replace(/\\/g, '/')
  if (normalized.split('/').some((part) => part === '..')) return null
  if (!/\.html$/i.test(normalized)) return null
  if (!/^[a-zA-Z0-9._/-]+\.html$/i.test(normalized)) return null

  const root = resolve(contentRoot)
  const full = resolve(root, normalized)
  const rel = relative(root, full)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  if (!(full === root || full.startsWith(root + sep))) return null

  return full
}

/** True if navigation stays on the packaged renderer or the Vite dev URL. */
export function isAllowedAppNavigation(url: string, rendererDevUrl: string | undefined): boolean {
  if (typeof url !== 'string' || !url) return false

  try {
    if (rendererDevUrl) {
      const allowed = new URL(rendererDevUrl)
      const target = new URL(url)
      if (target.origin === allowed.origin) return true
    }
  } catch {
    // ignore invalid renderer URL
  }

  try {
    const target = new URL(url)
    return target.protocol === 'file:'
  } catch {
    return false
  }
}
