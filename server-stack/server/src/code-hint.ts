export const CODE_HINT_CLASS = 'code-with-hint'
export const CODE_HINT_ATTR = 'data-hint'

export function encodeCodeHintHtml(html: string): string {
  const trimmed = html.trim()
  if (!trimmed) return ''
  return Buffer.from(trimmed, 'utf8').toString('base64')
}

export function decodeCodeHintHtml(encoded: string): string {
  try {
    return Buffer.from(encoded, 'base64').toString('utf8')
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
