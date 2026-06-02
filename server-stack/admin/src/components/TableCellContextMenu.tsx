import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  getCellPosFromDom,
  getCellTextAlign,
  setCellTextAlign,
  type TableCellTextAlign,
} from '../lib/table-cell-alignment'

type EditorLike = { _tiptapEditor: import('@tiptap/core').Editor }

interface MenuState {
  x: number
  y: number
  cellPos: number
  current: TableCellTextAlign
}

const OPTIONS: { id: TableCellTextAlign; label: string }[] = [
  { id: 'left', label: 'По левому краю' },
  { id: 'center', label: 'По центру' },
  { id: 'right', label: 'По правому краю' },
  { id: 'justify', label: 'По ширине' },
]

interface Props {
  editor: EditorLike
  containerRef: React.RefObject<HTMLElement | null>
}

export function TableCellContextMenu({ editor, containerRef }: Props): React.ReactElement | null {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setMenu(null), [])

  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    const onContextMenu = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      const cell = target.closest('td, th')
      if (!cell || !root.contains(cell)) return

      e.preventDefault()
      const cellPos = getCellPosFromDom(editor, cell as HTMLTableCellElement)
      if (cellPos == null) return

      setMenu({
        x: e.clientX,
        y: e.clientY,
        cellPos,
        current: getCellTextAlign(editor, cellPos),
      })
    }

    root.addEventListener('contextmenu', onContextMenu)
    return () => root.removeEventListener('contextmenu', onContextMenu)
  }, [editor, containerRef])

  useEffect(() => {
    if (!menu) return

    const onPointerDown = (e: MouseEvent): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu, close])

  if (!menu) return null

  return (
    <div
      ref={menuRef}
      className="admin-table-cell-menu"
      style={{ top: menu.y, left: menu.x }}
      role="menu"
    >
      <p className="admin-table-cell-menu__title">Выравнивание текста</p>
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="menuitemradio"
          aria-checked={menu.current === opt.id}
          className={
            menu.current === opt.id
              ? 'admin-table-cell-menu__item admin-table-cell-menu__item--active'
              : 'admin-table-cell-menu__item'
          }
          onClick={() => {
            setCellTextAlign(editor, menu.cellPos, opt.id)
            close()
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
