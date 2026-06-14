export const CODE_HINT_CLASS = 'code-with-hint'
export const CODE_HINT_ATTR = 'data-hint'

export function encodeCodeHintHtml(html: string): string {
  const trimmed = html.trim()
  if (!trimmed) return ''
  return btoa(unescape(encodeURIComponent(trimmed)))
}

export function decodeCodeHintHtml(encoded: string): string {
  try {
    return decodeURIComponent(escape(atob(encoded)))
  } catch {
    return ''
  }
}

export function renderCodeInlineHtml(escapedText: string, hintHtml?: string): string {
  const trimmed = hintHtml?.trim()
  if (!trimmed) return `<code>${escapedText}</code>`
  const encoded = encodeCodeHintHtml(trimmed)
  return `<code class="${CODE_HINT_CLASS}" ${CODE_HINT_ATTR}="${encoded}">${escapedText}</code>`
}
