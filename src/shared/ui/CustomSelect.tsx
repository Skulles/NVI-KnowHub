import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const ITEM_APPROX_PX = 34
const MAX_LIST_HEIGHT_PX = 240
const GAP_PX = 6

export type CustomSelectOption<T extends string = string> = {
  value: T
  label: string
}

export type CustomSelectProps<T extends string> = {
  value: T
  options: CustomSelectOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  /** id элемента подписи поля (например span в label) */
  ariaLabelledBy?: string
  id?: string
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className={`custom-select__chevron${open ? ' custom-select__chevron--open' : ''}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 9l6 6 6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export function CustomSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  ariaLabelledBy,
  id,
}: CustomSelectProps<T>) {
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [coords, setCoords] = useState<{
    top: number
    left: number
    width: number
    maxHeight: number
  } | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value],
  )

  const displayLabel = options.find((o) => o.value === value)?.label ?? '—'

  const updatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) {
      return
    }
    const rect = el.getBoundingClientRect()
    const n = options.length
    const naturalH = Math.min(
      MAX_LIST_HEIGHT_PX,
      Math.max(n * ITEM_APPROX_PX, ITEM_APPROX_PX),
    )
    const spaceBelow = window.innerHeight - rect.bottom - GAP_PX
    const spaceAbove = rect.top - GAP_PX
    const openUp = spaceBelow < 72 && spaceAbove > spaceBelow
    const maxHeight = openUp
      ? Math.min(naturalH, Math.max(spaceAbove - 4, 48))
      : Math.min(naturalH, Math.max(spaceBelow - 4, 48))
    let top: number
    if (openUp) {
      top = rect.top - GAP_PX - maxHeight
    } else {
      top = rect.bottom + GAP_PX
    }
    top = Math.max(4, Math.min(top, window.innerHeight - maxHeight - 4))
    setCoords({
      left: rect.left,
      width: rect.width,
      top,
      maxHeight,
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    updatePosition()
    const idRaf = requestAnimationFrame(() => updatePosition())
    return () => cancelAnimationFrame(idRaf)
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }
    const onScrollOrResize = () => updatePosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) {
        return
      }
      if (listRef.current?.contains(t)) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const activeOptionId = `${baseId}-opt-${highlight}`

  const selectIndex = useCallback(
    (i: number) => {
      const opt = options[i]
      if (opt) {
        onChange(opt.value)
      }
      setOpen(false)
    },
    [onChange, options],
  )

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return
    }

    if (!open) {
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === ' '
      ) {
        e.preventDefault()
        setOpen(true)
        setHighlight(selectedIndex >= 0 ? selectedIndex : 0)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlight((h) => Math.min(h + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlight((h) => Math.max(h - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setHighlight(0)
        break
      case 'End':
        e.preventDefault()
        setHighlight(Math.max(0, options.length - 1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        selectIndex(highlight)
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  const dropdown =
    open && coords
      ? createPortal(
          <div
            ref={listRef}
            className="custom-select__list"
            id={listboxId}
            role="listbox"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
              zIndex: 20000,
            }}
          >
            {options.map((opt, i) => (
              <div
                key={opt.value}
                className={`custom-select__option${
                  i === highlight ? ' custom-select__option--highlight' : ''
                }${opt.value === value ? ' custom-select__option--selected' : ''}`}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={opt.value === value}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => selectIndex(i)}
              >
                {opt.label}
              </div>
            ))}
          </div>,
          document.body,
        )
      : null

  return (
    <div className={`custom-select${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={ariaLabelledBy}
        className="custom-select__trigger"
        disabled={disabled}
        id={id}
        role="combobox"
        type="button"
        onClick={() => {
          if (disabled) {
            return
          }
          setOpen((wasOpen) => {
            if (wasOpen) {
              return false
            }
            setHighlight(selectedIndex >= 0 ? selectedIndex : 0)
            return true
          })
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="custom-select__value">{displayLabel}</span>
        <ChevronIcon open={open} />
      </button>
      {dropdown}
    </div>
  )
}
