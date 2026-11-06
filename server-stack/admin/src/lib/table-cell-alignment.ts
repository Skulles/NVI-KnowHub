import { TableMap } from 'prosemirror-tables'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from 'prosemirror-model'
import type { TableCellTextAlign } from './table-cell-alignment-extension'

export type { TableCellTextAlign }

export interface TableCellAlignMap {
  blockId: string
  rows: (TableCellTextAlign | null)[][]
}

type TableRowLike = { cells: unknown[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isTableBlock(block: unknown): block is { id: string; type: string; content: unknown } {
  return isRecord(block) && block.type === 'table'
}

export function getTableRowsFromContent(content: unknown): TableRowLike[] {
  if (!content) return []
  if (Array.isArray(content)) return content as TableRowLike[]
  const wrapped = content as { rows?: TableRowLike[] }
  return Array.isArray(wrapped.rows) ? wrapped.rows : []
}

export function getCellContent(cell: unknown): unknown {
  if (isRecord(cell) && 'content' in cell) return cell.content
  return cell
}

export function getCellAlign(cell: unknown): TableCellTextAlign | null {
  if (!isRecord(cell) || !('textAlign' in cell)) return null
  const align = cell.textAlign
  if (align === 'left' || align === 'center' || align === 'right' || align === 'justify') {
    return align === 'left' ? null : align
  }
  return null
}

export function extractTableAlignmentsFromBlocks(blocks: unknown[]): TableCellAlignMap[] {
  const result: TableCellAlignMap[] = []
  for (const block of blocks) {
    if (!isTableBlock(block)) continue
    const rows = getTableRowsFromContent(block.content)
    result.push({
      blockId: block.id,
      rows: rows.map((row) => row.cells.map((cell) => getCellAlign(cell))),
    })
  }
  return result
}

export function normalizeTableBlocksForEditor(blocks: unknown[]): unknown[] {
  return blocks.map((block) => {
    if (!isTableBlock(block)) return block
    const rows = getTableRowsFromContent(block.content)
    return {
      ...block,
      content: {
        type: 'tableContent',
        rows: rows.map((row) => ({
          cells: row.cells.map((cell) => getCellContent(cell)),
        })),
      },
    }
  })
}

function blockIdAtPos(doc: PMNode, pos: number): string | null {
  const $pos = doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'blockContainer') {
      return ($pos.node(d).attrs.id as string) ?? null
    }
  }
  return null
}

export function readTableAlignmentsFromEditor(editor: {
  _tiptapEditor: Editor
}): Map<string, (TableCellTextAlign | null)[][]> {
  const map = new Map<string, (TableCellTextAlign | null)[][]>()
  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return false

    const blockId = blockIdAtPos(editor._tiptapEditor.state.doc, pos)
    if (!blockId) return false

    const tableMap = TableMap.get(node)
    const rows: (TableCellTextAlign | null)[][] = []
    for (let row = 0; row < tableMap.height; row++) {
      const cells: (TableCellTextAlign | null)[] = []
      for (let col = 0; col < tableMap.width; col++) {
        const cell = node.nodeAt(tableMap.map[col + row * tableMap.width])
        const align = cell?.attrs.textAlign as TableCellTextAlign | null | undefined
        cells.push(align && align !== 'left' ? align : null)
      }
      rows.push(cells)
    }
    map.set(blockId, rows)
    return false
  })
  return map
}

export function mergeTableAlignmentsIntoBlocks(
  blocks: unknown[],
  editor: { _tiptapEditor: Editor }
): unknown[] {
  const pmAligns = readTableAlignmentsFromEditor(editor)
  return blocks.map((block) => {
    if (!isTableBlock(block)) return block
    const rows = getTableRowsFromContent(block.content)
    const pm = pmAligns.get(block.id)
    if (!pm) return block

    return {
      ...block,
      content: {
        type: 'tableContent',
        rows: rows.map((row, ri) => ({
          cells: row.cells.map((cell, ci) => {
            const content = getCellContent(cell)
            const align = pm[ri]?.[ci]
            if (!align) return content
            return { content, textAlign: align }
          }),
        })),
      },
    }
  })
}

export function applyTableCellAlignments(
  editor: { _tiptapEditor: Editor },
  alignMaps: TableCellAlignMap[]
): void {
  const byId = new Map(alignMaps.map((m) => [m.blockId, m.rows]))
  const updates: Array<{ pos: number; attrs: PMNode['attrs'] }> = []

  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return false

    const blockId = blockIdAtPos(editor._tiptapEditor.state.doc, pos)
    if (!blockId) return false
    const rows = byId.get(blockId)
    if (!rows) return false

    const tableMap = TableMap.get(node)
    const tableStart = pos + 1
    for (let row = 0; row < tableMap.height; row++) {
      for (let col = 0; col < tableMap.width; col++) {
        const align = rows[row]?.[col]
        if (!align) continue
        const cellOffset = tableMap.map[col + row * tableMap.width]
        const cell = node.nodeAt(cellOffset)
        if (!cell) continue
        updates.push({
          pos: tableStart + cellOffset,
          attrs: { ...cell.attrs, textAlign: align },
        })
      }
    }
    return false
  })

  if (updates.length === 0) return

  updates.sort((a, b) => b.pos - a.pos)
  let tr = editor._tiptapEditor.state.tr
  for (const { pos, attrs } of updates) {
    tr = tr.setNodeMarkup(pos, undefined, attrs)
  }
  if (tr.docChanged) editor._tiptapEditor.view.dispatch(tr)
}

export function setCellTextAlign(
  editor: { _tiptapEditor: Editor },
  cellPos: number,
  align: TableCellTextAlign
): void {
  const pm = editor._tiptapEditor
  const cell = pm.state.doc.nodeAt(cellPos)
  if (!cell) return
  const attrs = { ...cell.attrs, textAlign: align === 'left' ? null : align }
  pm.view.dispatch(pm.state.tr.setNodeMarkup(cellPos, undefined, attrs))
}

export function getCellPosFromDom(
  editor: { _tiptapEditor: Editor },
  cellEl: HTMLTableCellElement
): number | null {
  const pm = editor._tiptapEditor
  const pos = pm.view.posAtDOM(cellEl, 0)
  if (pos < 0) return null

  const $pos = pm.state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      return $pos.before(d)
    }
  }
  return null
}

export function getCellTextAlign(
  editor: { _tiptapEditor: Editor },
  cellPos: number
): TableCellTextAlign {
  const cell = editor._tiptapEditor.state.doc.nodeAt(cellPos)
  const align = cell?.attrs.textAlign as TableCellTextAlign | null | undefined
  return align ?? 'left'
}
