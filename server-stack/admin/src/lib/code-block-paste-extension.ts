import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

function isInCodeBlock(view: EditorView): boolean {
  return view.state.selection.$head.parent.type.name === 'codeBlock'
}

function isInHeading(view: EditorView, event: ClipboardEvent): boolean {
  if (view.state.selection.$head.parent.type.name === 'heading') return true
  const target = event.target instanceof Element ? event.target : null
  return !!target?.closest('.bn-block-content[data-content-type="heading"]')
}

function plainTextToInlineNodes(text: string, view: EditorView): PMNode[] {
  const { schema } = view.state
  const hardBreak = schema.nodes.hardBreak
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const nodes: PMNode[] = []

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) nodes.push(hardBreak.create())
    if (lines[i].length > 0) nodes.push(schema.text(lines[i]))
  }

  return nodes
}

function insertPlainTextWithNewlines(view: EditorView, text: string): boolean {
  const nodes = plainTextToInlineNodes(text, view)
  if (nodes.length === 0) return true

  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.replaceWith(from, to, nodes))
  return true
}

function normalizeHeadingPasteText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[ \t]+/g, ' ')
}

function insertHeadingPlainText(view: EditorView, text: string): boolean {
  const normalized = normalizeHeadingPasteText(text)
  if (!normalized) return true

  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText(normalized, from, to))
  return true
}

/** Paste into code blocks as plain text, preserving blank lines and line breaks. */
export const CodeBlockPasteExtension = Extension.create({
  name: 'adminCodeBlockPaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            paste: (view, event) => {
              const text = event.clipboardData?.getData('text/plain')
              if (text == null) return false

              if (isInHeading(view, event)) {
                event.preventDefault()
                return insertHeadingPlainText(view, text)
              }

              if (!isInCodeBlock(view)) return false

              event.preventDefault()
              return insertPlainTextWithNewlines(view, text)
            }
          }
        }
      })
    ]
  }
})
