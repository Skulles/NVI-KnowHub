import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Callout } from './calloutExtension'
import { LocalVideo } from './localVideoExtension'

/** Общие узлы для тела статьи: редактор блоков и `generateHTML` в knowledge. */
export function articleBodyNodeExtensions() {
  return [
    Image.configure({
      allowBase64: true,
      HTMLAttributes: { class: 'article-body-img' },
    }),
    TableKit.configure({
      table: {
        resizable: true,
        handleWidth: 10,
        cellMinWidth: 48,
        HTMLAttributes: { class: 'article-body-table-inner' },
      },
    }),
    Callout,
    LocalVideo,
  ]
}
