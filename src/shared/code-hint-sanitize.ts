const ALLOWED_HINT_TAGS = new Set(['P', 'IMG', 'BR', 'STRONG', 'EM', 'B', 'I', 'U', 'SPAN'])

export function sanitizeCodeHintHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html.trim()

  const walk = (node: Node): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove()
        continue
      }
      const el = child as HTMLElement
      if (!ALLOWED_HINT_TAGS.has(el.tagName)) {
        el.replaceWith(...el.childNodes)
        walk(node)
        continue
      }
      for (const attr of [...el.attributes]) {
        if (el.tagName === 'IMG') {
          if (attr.name !== 'src' && attr.name !== 'alt') el.removeAttribute(attr.name)
          continue
        }
        el.removeAttribute(attr.name)
      }
      if (el.tagName === 'IMG') {
        const src = el.getAttribute('src') ?? ''
        if (!src.startsWith('data:image/') && !src.startsWith('https://') && !src.startsWith('http://')) {
          el.remove()
          continue
        }
      }
      walk(el)
    }
  }

  walk(template.content)
  return template.innerHTML.trim()
}
