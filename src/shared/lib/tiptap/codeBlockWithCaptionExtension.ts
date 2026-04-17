import { mergeAttributes } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'

const FIGURE_SELECTOR = 'figure[data-code-block-caption]'

function languageFromPre(
  pre: Element | null | undefined,
  languageClassPrefix: string,
): string | null {
  if (!pre || !languageClassPrefix) {
    return null
  }
  const code = pre.querySelector('code')
  if (!code) {
    return null
  }
  const classNames = [...code.classList]
  const languages = classNames
    .filter((className) => className.startsWith(languageClassPrefix))
    .map((className) => className.replace(languageClassPrefix, ''))
  return languages[0] ?? null
}

/** Блок кода с опциональной подписью (`figure` + `figcaption` в HTML). */
export const CodeBlockWithCaption = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null as string | null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: FIGURE_SELECTOR,
        preserveWhitespace: 'full',
        contentElement: 'pre',
        getAttrs: (el: HTMLElement) => {
          const pre = el.querySelector(':scope > pre')
          if (!pre) {
            return false
          }
          const caption =
            el.querySelector(':scope > figcaption')?.textContent?.trim() || null
          const language = languageFromPre(
            pre,
            this.options.languageClassPrefix ?? 'language-',
          )
          return { caption, language }
        },
      },
      {
        tag: 'pre',
        preserveWhitespace: 'full',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const capRaw = node.attrs.caption
    const caption =
      typeof capRaw === 'string' && capRaw.trim() !== '' ? capRaw.trim() : ''
    const language: string | null = node.attrs.language ?? null
    const { caption: _drop, ...rest } = HTMLAttributes as Record<string, unknown>
    const preNode: [string, Record<string, unknown>, [string, Record<string, unknown>, 0]] =
      [
        'pre',
        mergeAttributes(this.options.HTMLAttributes, rest),
        [
          'code',
          {
            class: language
              ? this.options.languageClassPrefix + language
              : null,
          },
          0,
        ],
      ]
    if (!caption) {
      return preNode
    }
    return [
      'figure',
      {
        'data-code-block-caption': '',
        class: 'article-body-figure article-body-code-figure',
      },
      ['figcaption', { class: 'article-body-media-caption' }, caption],
      preNode,
    ]
  },
})
