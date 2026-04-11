import { mergeAttributes, Node } from '@tiptap/core'

export type CalloutVariant = 'yellow' | 'red'

const CALLOUT_HEADING: Record<CalloutVariant, string> = {
  yellow: 'Внимание',
  red: 'Важно',
}

/** Сноска с маркером-треугольником (жёлтый / красный). */
export const Callout = Node.create({
  name: 'callout',

  group: 'block',

  content: 'paragraph+',

  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'yellow',
        parseHTML: (el) =>
          el.getAttribute('data-variant') === 'red' ? 'red' : 'yellow',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'aside[data-callout]',
        getAttrs: (el) => ({
          variant: el.getAttribute('data-variant') === 'red' ? 'red' : 'yellow',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const variant: CalloutVariant =
      node.attrs.variant === 'red' ? 'red' : 'yellow'
    return [
      'aside',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        'data-variant': variant,
        'data-callout-heading': CALLOUT_HEADING[variant],
        class: `article-callout article-callout--${variant}`,
      }),
      0,
    ]
  },
})
