import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import type { ReactNode } from 'react'

function TIcon({ children }: { children: ReactNode }) {
  return (
    <span className="block-table-bubble__ico" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  )
}

export function BlockTableBubbleToolbar({ editor }: { editor: Editor }) {
  const caps = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      addRowBefore: ed.can().addRowBefore(),
      addRowAfter: ed.can().addRowAfter(),
      deleteRow: ed.can().deleteRow(),
      addColumnBefore: ed.can().addColumnBefore(),
      addColumnAfter: ed.can().addColumnAfter(),
      deleteColumn: ed.can().deleteColumn(),
      mergeCells: ed.can().mergeCells(),
      splitCell: ed.can().splitCell(),
      deleteTable: ed.can().deleteTable(),
    }),
  })

  return (
    <div className="block-table-bubble" role="toolbar" aria-label="Таблица">
      <button
        className="block-table-bubble__btn"
        disabled={!caps.addRowBefore}
        title="Вставить строку выше"
        type="button"
        onClick={() => editor.chain().focus().addRowBefore().run()}
      >
        <TIcon>
          <path d="M12 4v4M9 6l3-3 3 3" />
          <rect x="4" y="11" width="16" height="9" rx="1" />
        </TIcon>
      </button>
      <button
        className="block-table-bubble__btn"
        disabled={!caps.addRowAfter}
        title="Вставить строку ниже"
        type="button"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        <TIcon>
          <rect x="4" y="4" width="16" height="9" rx="1" />
          <path d="M12 17v4M9 19l3 3 3-3" />
        </TIcon>
      </button>
      <button
        className="block-table-bubble__btn"
        disabled={!caps.deleteRow}
        title="Удалить строку"
        type="button"
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        <TIcon>
          <rect x="4" y="7" width="16" height="10" rx="1" />
          <path d="M9 12h6" strokeWidth="2.25" />
        </TIcon>
      </button>

      <div className="block-table-bubble__sep" role="separator" aria-hidden />

      <button
        className="block-table-bubble__btn"
        disabled={!caps.addColumnBefore}
        title="Вставить столбец слева"
        type="button"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      >
        <TIcon>
          <path d="M7 12H3M5 9l-3 3 3 3" />
          <rect x="9" y="5" width="12" height="14" rx="1" />
        </TIcon>
      </button>
      <button
        className="block-table-bubble__btn"
        disabled={!caps.addColumnAfter}
        title="Вставить столбец справа"
        type="button"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <TIcon>
          <rect x="3" y="5" width="12" height="14" rx="1" />
          <path d="M17 12h4M19 9l3 3-3 3" />
        </TIcon>
      </button>
      <button
        className="block-table-bubble__btn"
        disabled={!caps.deleteColumn}
        title="Удалить столбец"
        type="button"
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        <TIcon>
          <rect x="7" y="5" width="10" height="14" rx="1" />
          <path d="M12 9v6" strokeWidth="2.25" />
        </TIcon>
      </button>

      <div className="block-table-bubble__sep" role="separator" aria-hidden />

      <button
        className="block-table-bubble__btn"
        disabled={!caps.mergeCells}
        title="Объединить ячейки"
        type="button"
        onClick={() => editor.chain().focus().mergeCells().run()}
      >
        <TIcon>
          <rect x="4" y="7" width="7" height="10" rx="1" />
          <rect x="13" y="7" width="7" height="10" rx="1" />
        </TIcon>
      </button>
      <button
        className="block-table-bubble__btn"
        disabled={!caps.splitCell}
        title="Разделить ячейку"
        type="button"
        onClick={() => editor.chain().focus().splitCell().run()}
      >
        <TIcon>
          <rect x="5" y="7" width="14" height="10" rx="1" />
          <path d="M12 7.5v9" />
        </TIcon>
      </button>

      <div className="block-table-bubble__sep" role="separator" aria-hidden />

      <button
        className="block-table-bubble__btn block-table-bubble__btn--danger"
        disabled={!caps.deleteTable}
        title="Удалить таблицу"
        type="button"
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <TIcon>
          <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
        </TIcon>
      </button>
    </div>
  )
}
