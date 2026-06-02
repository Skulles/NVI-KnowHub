import React from 'react'
import type { DefaultReactSuggestionItem, SuggestionMenuProps } from '@blocknote/react'

export function AdminSlashMenu<T extends DefaultReactSuggestionItem>(
  props: SuggestionMenuProps<T>
): React.ReactElement {
  const { items, loadingState, selectedIndex, onItemClick } = props

  if (loadingState === 'loading-initial' || loadingState === 'loading') {
    return (
      <div id="bn-suggestion-menu" className="bn-suggestion-menu admin-slash-menu">
        <p className="admin-slash-menu-loading">Загрузка…</p>
      </div>
    )
  }

  let currentGroup: string | undefined
  const nodes: React.ReactNode[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.group && item.group !== currentGroup) {
      currentGroup = item.group
      nodes.push(
        <div key={`group-${currentGroup}`} className="admin-slash-menu-label">
          {currentGroup}
        </div>
      )
    }

    const selected = i === selectedIndex
    nodes.push(
      <button
        key={`item-${i}-${item.title}`}
        type="button"
        id={`bn-suggestion-menu-item-${i}`}
        role="option"
        aria-selected={selected || undefined}
        className={`bn-suggestion-menu-item admin-slash-menu-item${selected ? ' is-selected' : ''}`}
        onClick={() => onItemClick?.(item)}
      >
        {item.title}
      </button>
    )
  }

  return (
    <div id="bn-suggestion-menu" className="bn-suggestion-menu admin-slash-menu" role="listbox">
      {nodes}
      {nodes.length === 0 && (
        <p className="admin-slash-menu-empty px-3 py-2 text-[12px] text-label-tertiary">Ничего не найдено</p>
      )}
    </div>
  )
}
