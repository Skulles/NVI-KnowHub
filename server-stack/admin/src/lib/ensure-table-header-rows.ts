import { TableMap } from 'prosemirror-tables'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from 'prosemirror-model'

/** BlockNote always serializes table rows as tableCell (td); restore th for row 1 in the editor. */
export function ensureTableHeaderRows(editor: { _tiptapEditor: Editor }): void {
  const pm = editor._tiptapEditor
  const headerType = pm.schema.nodes.tableHeader
  const cellType = pm.schema.nodes.tableCell
  if (!headerType || !cellType) return

  const updates: Array<{ pos: number; attrs: PMNode['attrs'] }> = []

  pm.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true

    const firstCell = node.child(0)?.child(0)
    if (!firstCell || firstCell.type.name !== 'tableCell') return false

    const map = TableMap.get(node)
    const tableStart = pos + 1
    for (let col = 0; col < map.width; col++) {
      const cellOffset = map.map[col]
      const cell = node.nodeAt(cellOffset)
      if (cell?.type.name === 'tableCell') {
        updates.push({ pos: tableStart + cellOffset, attrs: cell.attrs })
      }
    }
    return false
  })

  if (updates.length === 0) return

  updates.sort((a, b) => b.pos - a.pos)
  let tr = pm.state.tr
  for (const { pos, attrs } of updates) {
    tr = tr.setNodeMarkup(pos, headerType, attrs)
  }

  if (tr.docChanged) {
    pm.view.dispatch(tr)
  }
}
