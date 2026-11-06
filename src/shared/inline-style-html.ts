/**
 * Map BlockNote text/background color styles to HTML data attributes / wrappers.
 */
export type InlineStyleMap = Record<string, string | boolean>

export function wrapBlockNoteColorStyles(text: string, styles: InlineStyleMap): string {
  const textColor =
    typeof styles.textColor === 'string' && styles.textColor !== 'default' ? styles.textColor : null
  const backgroundColor =
    typeof styles.backgroundColor === 'string' && styles.backgroundColor !== 'default'
      ? styles.backgroundColor
      : null

  if (!textColor && !backgroundColor) return text

  const attrs: string[] = []
  if (textColor) attrs.push(`data-text-color="${textColor}"`)
  if (backgroundColor) attrs.push(`data-background-color="${backgroundColor}"`)
  return `<span ${attrs.join(' ')}>${text}</span>`
}

export function blockNoteColorAttrs(props: Record<string, unknown>): string {
  const attrs: string[] = []
  const textColor = props.textColor
  const backgroundColor = props.backgroundColor
  if (typeof textColor === 'string' && textColor !== 'default') {
    attrs.push(`data-text-color="${textColor}"`)
  }
  if (typeof backgroundColor === 'string' && backgroundColor !== 'default') {
    attrs.push(`data-background-color="${backgroundColor}"`)
  }
  return attrs.length ? ` ${attrs.join(' ')}` : ''
}

export interface BNInlineContentLike {
  type: string
  text?: string
  styles?: InlineStyleMap
}

export function normalizeInlineContent(content: unknown): BNInlineContentLike[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content, styles: {} }]
  }
  if (Array.isArray(content)) return content as BNInlineContentLike[]
  return []
}
