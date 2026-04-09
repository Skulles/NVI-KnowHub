import { mergeAttributes, Node } from '@tiptap/core'

/** Блок `<video>` с локальным `src` (обычно data URL из файла). */
export const LocalVideo = Node.create({
  name: 'video',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'article-body-video',
      },
    }
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'video[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(
        { controls: 'true', playsInline: 'true' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
    ]
  },
})
