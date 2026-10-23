import React from 'react'

function isWindowsApp(): boolean {
  return navigator.userAgent.includes('Windows')
}

/** Пустая полоса под системные кнопки Windows: за неё окно перетаскивается. */
export function WindowTitleBar(): React.ReactElement | null {
  if (!isWindowsApp()) return null

  return <header className="window-titlebar drag-region shrink-0 bg-surface-window" aria-hidden />
}
