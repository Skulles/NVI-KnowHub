import Link from '@tiptap/extension-link'

/** Ссылки в теле статьи: редактор, HTML для просмотра и generateHTML. */
export const articleLinkExtension = Link.configure({
  openOnClick: false,
  autolink: true,
  defaultProtocol: 'https',
  HTMLAttributes: {
    class: 'article-inline-link',
  },
})
