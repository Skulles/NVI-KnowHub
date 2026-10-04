import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronRightIcon } from '../../../components/Icons'
import type { OeLocationFilterOption } from '../monitoringLocationFilter'

export function MonitoringLocationFilterSelect({
  options,
  totalCount,
  value,
  onChange
}: {
  options: OeLocationFilterOption[]
  totalCount: number
  value: string | null
  onChange: (value: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex

  const entries = useMemo(
    (): Array<{ label: string; count: number; value: string | null }> => [
      { label: 'Все локации', count: totalCount, value: null },
      ...options.map((option) => ({ label: option.label, count: option.count, value: option.label }))
    ],
    [options, totalCount]
  )

  const selectedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.value === value)
  )
  const selectedEntry = entries[selectedIndex] ?? entries[0]

  const close = useCallback((): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  const selectEntry = useCallback(
    (nextValue: string | null): void => {
      onChange(nextValue)
      setOpen(false)
      buttonRef.current?.focus()
    },
    [onChange]
  )

  useEffect(() => {
    if (!open) return
    setActiveIndex(selectedIndex)

    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = (activeIndexRef.current + delta + entries.length) % entries.length
        activeIndexRef.current = nextIndex
        setActiveIndex(nextIndex)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const entry = entries[activeIndexRef.current]
        if (entry) selectEntry(entry.value)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [close, entries, open, selectEntry, selectedIndex])

  if (options.length === 0) return null

  return (
    <div ref={rootRef} className="relative w-max max-w-[min(22rem,calc(100vw-2rem))] shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-transparent py-0.5 pl-1 pr-0.5 text-left text-[12px] font-medium text-label-secondary transition-colors hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 ${
          open ? 'bg-white/[0.04] text-label-primary' : ''
        }`}
      >
        <span className="whitespace-nowrap">
          {selectedEntry.label}
          <span className="text-label-tertiary"> · </span>
          <span className="tabular-nums text-tint-blue">{selectedEntry.count}</span>
        </span>
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-label-tertiary transition-transform duration-200 ${
            open ? '-rotate-90' : 'rotate-90'
          }`}
        />
      </button>
      {open ? (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-full w-max max-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-surface-border/80 bg-surface-raised p-1 shadow-sheet"
        >
          <ul
            id={listId}
            role="listbox"
            aria-label="Фильтр по локации"
            className="m-0 max-h-[min(16rem,50vh)] list-none overflow-y-auto"
          >
          {entries.map((entry, index) => {
            const isSelected = entry.value === value
            const isActive = index === activeIndex
            return (
              <li key={entry.value ?? '__all__'} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectEntry(entry.value)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] tracking-tight transition-colors focus-visible:outline-none ${
                    isSelected
                      ? 'bg-tint-blue/15 text-label-primary'
                      : isActive
                        ? 'bg-white/[0.05] text-label-primary'
                        : 'text-label-secondary hover:bg-white/[0.05] hover:text-label-primary'
                  }`}
                >
                  <span className="min-w-0 truncate">{entry.label}</span>
                  {isSelected ? (
                    <span className="shrink-0 text-tint-blue">
                      <CheckIcon className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="shrink-0 tabular-nums text-label-tertiary">{entry.count}</span>
                  )}
                </button>
              </li>
            )
          })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
