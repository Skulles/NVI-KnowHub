// Converts BlockNote JSON block array to custom HTML used by KnowHub.
import { renderCodeInlineHtml } from '@knowhub-shared/code-hint'
import { renderAlertCalloutHtml, type AlertCalloutVariant } from './callout-html'
// BlockNote schema: https://www.blocknotejs.org/docs/editor-basics/document-structure

export interface BNInlineContent {
  type: 'text' | 'link'
  text?: string
  href?: string
  content?: BNInlineContent[]
  styles?: Record<string, string | boolean>
}

export interface BNBlock {
  id: string
  type: string
  props: Record<string, unknown>
  content: BNInlineContent[] | BNBlock[]
  children: BNBlock[]
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function uniqueHeadingId(text: string, index: number, usedIds: Set<string>): string {
  const base = slugify(text) || `section-${index + 1}`
  if (!usedIds.has(base)) {
    usedIds.add(base)
    return base
  }
  let suffix = 2
  while (usedIds.has(`${base}-${suffix}`)) suffix++
  const id = `${base}-${suffix}`
  usedIds.add(id)
  return id
}

function inlineToHtml(content: BNInlineContent[]): string {
  return content
    .map((node) => {
      if (node.type === 'link') {
        const inner = inlineToHtml(node.content ?? [])
        return `<a href="${escHtml(node.href ?? '')}">${inner}</a>`
      }
      let text = escHtml(node.text ?? '')
      const s = node.styles ?? {}
      if (s.bold) text = `<strong>${text}</strong>`
      if (s.italic) text = `<em>${text}</em>`
      if (s.underline) text = `<u>${text}</u>`
      if (s.strikethrough) text = `<s>${text}</s>`
      if (s.code) {
        const hint = typeof s.codeHint === 'string' ? s.codeHint : ''
        text = renderCodeInlineHtml(text, hint)
      }
      return text
    })
    .join('')
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

type TableRow = { cells: unknown[] }

function parseTableCell(cell: unknown): { content: BNInlineContent[]; align?: string } {
  let raw: unknown = cell
  let align: string | undefined

  if (cell && typeof cell === 'object' && !Array.isArray(cell) && 'content' in cell) {
    const wrapped = cell as { content: unknown; textAlign?: string }
    raw = wrapped.content
    align = wrapped.textAlign
  }

  if (typeof raw === 'string') {
    return { content: [{ type: 'text', text: raw, styles: {} }], align }
  }
  if (Array.isArray(raw)) {
    return { content: raw as BNInlineContent[], align }
  }
  return { content: [], align }
}

function renderTableCell(tag: 'th' | 'td', cell: unknown, scope?: string): string {
  const { content, align } = parseTableCell(cell)
  const alignAttr =
    align && align !== 'left' ? ` style="text-align: ${escHtml(align)}"` : ''
  const scopeAttr = scope ? ` scope="${scope}"` : ''
  return `<${tag}${scopeAttr}${alignAttr}>${inlineToHtml(content)}</${tag}>`
}

/** BlockNote v0.15+ stores tables as `{ type: "tableContent", rows }`, not a bare array. */
function getTableRows(content: unknown): TableRow[] {
  if (!content) return []
  if (Array.isArray(content)) return content as TableRow[]
  const wrapped = content as { rows?: TableRow[] }
  return Array.isArray(wrapped.rows) ? wrapped.rows : []
}

type ListType = 'bullet' | 'numbered' | 'check'

interface ListGroup {
  type: ListType
  items: BNBlock[]
}

function groupListBlocks(blocks: BNBlock[]): (BNBlock | ListGroup)[] {
  const result: (BNBlock | ListGroup)[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    const lt = getListType(b.type)
    if (lt) {
      const group: ListGroup = { type: lt, items: [b] }
      while (i + 1 < blocks.length && getListType(blocks[i + 1].type) === lt) {
        i++
        group.items.push(blocks[i])
      }
      result.push(group)
    } else {
      result.push(b)
    }
    i++
  }
  return result
}

function getListType(type: string): ListType | null {
  if (type === 'bulletListItem') return 'bullet'
  if (type === 'numberedListItem') return 'numbered'
  if (type === 'checkListItem') return 'check'
  return null
}

function renderBlock(block: BNBlock, usedHeadingIds?: Set<string>, headingIndex?: { value: number }): string {
  const content = block.content as BNInlineContent[]

  switch (block.type) {
    case 'paragraph':
      return `<p>${inlineToHtml(content)}</p>`

    case 'heading': {
      const level = (block.props.level as number) ?? 2
      const text = inlineToHtml(content)
      const plain = content.map((c) => c.text ?? '').join('')
      const index = headingIndex?.value ?? 0
      if (headingIndex) headingIndex.value++
      const id = usedHeadingIds
        ? uniqueHeadingId(plain, index, usedHeadingIds)
        : slugify(plain)
      return `<h${level} id="${id}">${text}</h${level}>`
    }

    case 'codeBlock': {
      const lang = escHtml((block.props.language as string) ?? '')
      const text = escHtml(content.map((c) => (c as BNInlineContent).text ?? '').join(''))
      return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${text}</code></pre>`
    }

    case 'image': {
      const src = escHtml((block.props.url as string) ?? '')
      const alt = escHtml((block.props.caption as string) ?? '')
      const caption = (block.props.caption as string) ?? ''
      const img = `<img src="${src}" alt="${alt}" />`
      if (caption) {
        return `<figure class="article-image-wrap">${img}<figcaption>${escHtml(caption)}</figcaption></figure>`
      }
      return `<div class="article-image-wrap">${img}</div>`
    }

    case 'video': {
      const src = escHtml((block.props.url as string) ?? '')
      const caption = (block.props.caption as string) ?? ''
      const video = `<video autoplay muted loop playsinline preload="auto"><source src="${src}" type="video/mp4" /></video>`
      if (caption) {
        return `<figure class="article-video-wrap">${video}<figcaption>${escHtml(caption)}</figcaption></figure>`
      }
      return `<div class="article-video-wrap">${video}</div>`
    }

    case 'table': {
      const rows = getTableRows(block.content)
      const [head, ...body] = rows
      const thRow =
        head?.cells.map((c) => renderTableCell('th', c, 'col')).join('') ?? ''
      const bodyRows = body
        .map((r) => `<tr>${r.cells.map((c) => renderTableCell('td', c)).join('')}</tr>`)
        .join('')
      return `<div class="article-table-wrap"><table><thead><tr>${thRow}</tr></thead><tbody>${bodyRows}</tbody></table></div>`
    }

    case 'callout': {
      const variant = (block.props.variant as string) ?? 'info'
      const inlineContent = block.content as BNInlineContent[]
      const text = inlineContent?.length
        ? inlineToHtml(inlineContent)
        : escHtml((block.props.text as string) ?? '')
      if (variant === 'warning' || variant === 'important') {
        return renderAlertCalloutHtml(variant as AlertCalloutVariant, text)
      }
      return `<blockquote class="article-callout">${text}</blockquote>`
    }

    default:
      return `<p>${inlineToHtml(content)}</p>`
  }
}

function renderListGroup(group: ListGroup): string {
  const cls =
    group.type === 'numbered' ? 'article-task-list article-task-list--numbered'
    : group.type === 'check' ? 'article-task-list article-task-list--checks'
    : 'article-task-list'
  const tag = group.type === 'numbered' ? 'ol' : 'ul'
  const items = group.items
    .map((b) => {
      const inner = inlineToHtml(b.content as BNInlineContent[])
      const checked = b.props.checked ? ' class="is-done"' : ''
      return `<li${checked}>${inner}</li>`
    })
    .join('')
  return `<${tag} class="${cls}">${items}</${tag}>`
}

export function renderBlocks(blocks: BNBlock[]): string {
  const grouped = groupListBlocks(blocks)
  const parts: string[] = []
  let cardOpen = false
  const usedHeadingIds = new Set<string>()
  const headingIndex = { value: 0 }

  for (const item of grouped) {
    if ('items' in item) {
      // list group — render inside current card or bare
      parts.push(renderListGroup(item))
      continue
    }

    const block = item as BNBlock

    if (block.type === 'heading' && (block.props.level as number) === 2) {
      if (cardOpen) parts.push('</section>')
      const headingHtml = renderBlock(block, usedHeadingIds, headingIndex)
      parts.push(`<section class="article-section-card">${headingHtml}`)
      cardOpen = true
      continue
    }

    if (block.type === 'heading' && (block.props.level as number) === 1) {
      // h1 is handled by ContentArea header — skip here
      continue
    }

    if (block.type === 'callout') {
      if (cardOpen) {
        parts.push('</section>')
        cardOpen = false
      }
      parts.push(renderBlock(block, usedHeadingIds, headingIndex))
      continue
    }

    parts.push(renderBlock(block, usedHeadingIds, headingIndex))
  }

  if (cardOpen) parts.push('</section>')
  return parts.join('\n')
}

export function blocksToArticleHtml(title: string, lead: string, blocks: BNBlock[]): string {
  const leadHtml = lead ? `<p class="lead">${escHtml(lead)}</p>\n` : ''
  const body = renderBlocks(blocks)
  return `<h1>${escHtml(title)}</h1>\n${leadHtml}${body}\n`
}
