import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import type { Slice } from '@tiptap/pm/model'
import { NodeSelection, Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

function findCodeBlockDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'codeBlock') return depth
  }
  return null
}

function isInCodeBlock(view: EditorView, event?: ClipboardEvent): boolean {
  if (findCodeBlockDepth(view.state.selection.$head) !== null) return true

  if (!event) return false
  const target = event.target instanceof Element ? event.target : null
  return !!target?.closest('.bn-block-content[data-content-type="codeBlock"]')
}

function getCodeBlockInsertRange(
  view: EditorView,
  event?: ClipboardEvent
): { from: number; to: number } | null {
  const { selection } = view.state
  const headDepth = findCodeBlockDepth(selection.$head)
  if (headDepth !== null) {
    return { from: selection.from, to: selection.to }
  }

  if (selection instanceof NodeSelection) {
    if (selection.node.type.name === 'codeBlock') {
      const from = selection.from + 1
      return { from, to: from + selection.node.content.size }
    }

    if (selection.node.type.name === 'blockContainer') {
      const codeBlock = selection.node.firstChild
      if (codeBlock?.type.name === 'codeBlock') {
        const from = selection.from + 2
        return { from, to: from + codeBlock.content.size }
      }
    }
  }

  if (!event) return null

  const target = event.target instanceof Element ? event.target : null
  const codeBlockEl = target?.closest('.bn-block-content[data-content-type="codeBlock"]')
  if (!codeBlockEl) return null

  const editable = codeBlockEl.querySelector<HTMLElement>(
    '.bn-inline-content[data-editable], .editor-code-block__content'
  )
  if (!editable) return null

  try {
    const pos = view.posAtDOM(editable, editable.childNodes.length)
    const $pos = view.state.doc.resolve(pos)
    const depth = findCodeBlockDepth($pos)
    if (depth === null) return null

    const contentStart = $pos.start(depth)
    const contentEnd = $pos.end(depth)
    const insertAt = Math.min(Math.max(pos, contentStart), contentEnd)
    return { from: insertAt, to: insertAt }
  } catch {
    return null
  }
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

function getPastePlainText(event: ClipboardEvent, slice?: Slice): string {
  const plain = event.clipboardData?.getData('text/plain')
  if (plain != null && plain !== '') return plain
  if (slice) return slice.content.textBetween(0, slice.content.size, '\n', '\n')
  return plain ?? ''
}

function insertPlainTextWithNewlines(
  view: EditorView,
  text: string,
  from: number,
  to: number
): boolean {
  const nodes = plainTextToInlineNodes(text, view)
  if (nodes.length === 0) return true

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

function handleCodeBlockPaste(view: EditorView, event: ClipboardEvent, slice?: Slice): boolean {
  const range = getCodeBlockInsertRange(view, event)
  if (!range) return false

  const text = getPastePlainText(event, slice)
  if (text === '') return true

  return insertPlainTextWithNewlines(view, text, range.from, range.to)
}

/** Paste into code blocks as plain text, preserving blank lines and line breaks. */
export const CodeBlockPasteExtension = Extension.create({
  name: 'adminCodeBlockPaste',
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            paste: (view, event) => {
              if (isInHeading(view, event)) {
                const text = event.clipboardData?.getData('text/plain')
                if (text == null) return false
                event.preventDefault()
                return insertHeadingPlainText(view, text)
              }

              if (!isInCodeBlock(view, event)) return false

              event.preventDefault()
              return handleCodeBlockPaste(view, event)
            }
          },
          handlePaste: (view, event, slice) => {
            if (isInHeading(view, event)) return false
            if (!isInCodeBlock(view, event)) return false
            return handleCodeBlockPaste(view, event, slice)
          }
        }
      })
    ]
  }
})
