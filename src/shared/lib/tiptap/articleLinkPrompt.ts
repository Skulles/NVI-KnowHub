import type { Editor } from '@tiptap/core'

export function normalizeArticleLinkHref(trimmed: string): string {
  let href = trimmed
  if (
    !/^https?:\/\//i.test(href) &&
    !/^mailto:/i.test(href) &&
    !/^tel:/i.test(href) &&
    !href.startsWith('#') &&
    !href.startsWith('/')
  ) {
    href = `https://${href}`
  }
  return href
}

/** Применить URL к выделению или к текущей ссылке. Пустая строка — снять ссылку. */
export function applyArticleLinkToEditor(editor: Editor, rawInput: string) {
  const trimmed = rawInput.trim()
  if (trimmed === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  const href = normalizeArticleLinkHref(trimmed)
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}
