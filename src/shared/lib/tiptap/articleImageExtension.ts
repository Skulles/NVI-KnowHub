import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'

/**
 * Картинка в теле статьи с опциональной подписью (`figure` + `figcaption` в HTML).
 */
export const ArticleImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null as string | null,
        parseHTML: (element) => {
          const fig = element.closest('figure')
          if (fig) {
            const fc = fig.querySelector('figcaption')
            const t = fc?.textContent?.trim()
            return t || null
          }
          return element.getAttribute('data-caption') || null
        },
      },
    }
  },

  parseHTML() {
    const imgTag = this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])'
    return [
      {
        tag: 'figure.article-body-figure',
        getAttrs: (el: HTMLElement) => {
          const im = el.querySelector(':scope > img[src]')
          if (!im) {
            return false
          }
          const caption =
            el.querySelector(':scope > figcaption')?.textContent?.trim() || null
          return {
            src: im.getAttribute('src'),
            alt: im.getAttribute('alt'),
            title: im.getAttribute('title'),
            width: im.getAttribute('width'),
            height: im.getAttribute('height'),
            caption,
          }
        },
      },
      {
        tag: imgTag,
        getAttrs: (el: HTMLElement) => ({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
          title: el.getAttribute('title'),
          width: el.getAttribute('width'),
          height: el.getAttribute('height'),
          caption: el.getAttribute('data-caption'),
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const capRaw = node.attrs.caption
    const caption =
      typeof capRaw === 'string' && capRaw.trim() !== '' ? capRaw.trim() : ''
    const { caption: _c, ...rest } = HTMLAttributes as Record<string, unknown>
    const img: [string, Record<string, unknown>] = [
      'img',
      mergeAttributes(this.options.HTMLAttributes, rest),
    ]
    if (!caption) {
      return img
    }
    return [
      'figure',
      { class: 'article-body-figure' },
      img,
      ['figcaption', { class: 'article-body-media-caption' }, caption],
    ]
  },
})
