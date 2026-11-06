import React from 'react'
import { createPortal } from 'react-dom'
import { XMarkIcon } from '../Icons'

const SUPPORT_EMAIL = 'aleksey.bogdanov@nvi-solutions.com'

function clearEmailSelection(event: React.MouseEvent): void {
  const target = event.target
  if (target instanceof Element && target.closest('[data-about-email]')) return
  window.getSelection()?.removeAllRanges()
}

export function AboutDialog({
  version,
  onClose
}: {
  version: string
  onClose: () => void
}): React.ReactElement {
  const selectionBeforeEmailClick = React.useRef('')

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
      onMouseDown={clearEmailSelection}
    >
      <div className="absolute inset-0 bg-[#0b0e16]/75 backdrop-blur-[6px]" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        className="relative z-[1] flex max-h-[min(90vh,40rem)] w-full max-w-[31rem] select-none flex-col overflow-hidden rounded-[1.25rem] border border-surface-border/90 bg-surface-card shadow-sheet"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-surface-border/80 px-5 py-4">
          <div className="min-w-0">
            <h2 id="about-dialog-title" className="m-0 text-[17px] font-semibold tracking-tight text-label-primary">
              О программе
            </h2>
            {version && (
              <p className="mt-1 mb-0 text-[13px] text-label-tertiary">KnowHub {version}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded-xl border border-transparent p-2 text-label-tertiary transition-colors hover:border-surface-border/80 hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
            aria-label="Закрыть"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-5 space-y-5 text-[14px] leading-relaxed text-label-secondary">
          <p className="m-0">Все данные хранятся локально и никуда не отправляются.</p>

          <p className="m-0">
            О проблемах, обнаруженных при использовании, можно сообщить по почте{' '}
            <span
              role="link"
              tabIndex={0}
              data-about-email=""
              className="select-text cursor-pointer text-tint-blue hover:text-tint-blue-hover hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45 rounded-sm"
              onMouseDown={() => {
                const selection = window.getSelection()
                selectionBeforeEmailClick.current =
                  selection && !selection.isCollapsed ? selection.toString() : ''
              }}
              onClick={() => {
                const selection = window.getSelection()
                const selectedText = selection && !selection.isCollapsed ? selection.toString() : ''
                if (selectedText && selectedText === selectionBeforeEmailClick.current) {
                  selection?.removeAllRanges()
                  return
                }
                if (selectedText) return
                void window.api?.openExternal(`mailto:${SUPPORT_EMAIL}`)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                void window.api?.openExternal(`mailto:${SUPPORT_EMAIL}`)
              }}
            >
              {SUPPORT_EMAIL}
            </span>{'.'}
          </p>

          <section>
            <h3 className="m-0 mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-label-tertiary">
              Права Windows при поиске устройств
            </h3>
            <p className="m-0 text-label-tertiary">
              При первом поиске устройств, права запрашивает PowerShell. Нужно,
              чтобы на время увидеть устройства в соседних сетях. Когда поиск заканчивается, сеть восстанавливается до прежнего состояния.
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
