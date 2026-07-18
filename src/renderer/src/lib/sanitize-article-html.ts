import DOMPurify from 'dompurify'

const ARTICLE_ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'div', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'li', 'ol', 'p', 'path', 'pre', 'section', 'small', 'span',
  'strong', 'sub', 'sup', 'svg', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul', 'video', 'source'
]

const ARTICLE_ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel', 'class', 'id', 'src', 'alt', 'width', 'height',
  'loading', 'controls', 'muted', 'loop', 'autoplay', 'playsinline', 'poster',
  'type', 'colspan', 'rowspan', 'scope', 'style',
  // BlockNote colors + inline code hints
  'data-text-color', 'data-background-color', 'data-hint',
  // Inline SVG for article-callout icons (warning / important)
  'xmlns', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'd', 'aria-hidden'
]

/** data-* must also be in ADD_ATTR when ALLOW_DATA_ATTR is false */
const ARTICLE_ADD_ATTR = [
  'data-text-color',
  'data-background-color',
  'data-hint'
]

export function sanitizeArticleHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ARTICLE_ALLOWED_TAGS,
    ALLOWED_ATTR: ARTICLE_ALLOWED_ATTR,
    ADD_ATTR: ARTICLE_ADD_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'base', 'link', 'meta']
  })
}
