import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRightIcon, XMarkIcon } from '../../../components/Icons'
import {
  DEFAULT_OBJECT_KIND,
  DEFAULT_SERVER_LOGIN,
  buildMonitoringObject,
  joinIPv4Octets,
  normalizeMonitoringObjectKind,
  normalizePastedIPv4,
  objectDigits,
  parseIPv4Octets,
  parseMonitoringObject,
  sanitizeMonitoringDigits,
  sanitizeIPv4OctetInput,
  type IPv4Octets,
  type MonitoringObject,
  type MonitoringObjectKind
} from '../monitoringStorage'
import { MONITORING_OBJECT_KIND_EDITOR_LABELS } from '../monitoringObjectKind'
import type { EditorState } from '../monitoringTypes'

const OBJECT_KIND_OPTIONS: MonitoringObjectKind[] = ['auto', 'drilling', 'tkrs']

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />
    </svg>
  )
}

function EyeSlashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 2.25 12s3.75 6.75 9.75 6.75c1.77 0 3.4-.37 4.82-.98M6.228 6.228A10.45 10.45 0 0 1 12 5.25c6 0 9.75 6.75 9.75 6.75a10.477 10.477 0 0 1-1.728 2.772M6.228 6.228 3 3m3.228 3.228 13.544 13.544M21 21l-2.772-2.772" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.704 5.29a.75.75 0 0 1 .006 1.06l-7.25 7.375a.75.75 0 0 1-1.074-.008L3.29 8.54a.75.75 0 1 1 1.072-1.05l4.32 4.406 6.714-6.83a.75.75 0 0 1 1.06-.006Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function EndpointIcon({ kind }: { kind: 'link' | 'server' }) {
  if (kind === 'server') {
    return (
      <svg viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor" aria-hidden>
        <path d="M6.75 3A2.75 2.75 0 0 0 4 5.75v3A2.75 2.75 0 0 0 6.75 11h10.5A2.75 2.75 0 0 0 20 8.25v-2.5A2.75 2.75 0 0 0 17.25 3H6.75Zm1.75 5.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM6.75 13A2.75 2.75 0 0 0 4 15.75v2.5A2.75 2.75 0 0 0 6.75 21h10.5A2.75 2.75 0 0 0 20 18.25v-2.5A2.75 2.75 0 0 0 17.25 13H6.75Zm1.75 5.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor" aria-hidden>
      <path d="M12 17.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z" />
      <path d="M7.05 13.27a7.1 7.1 0 0 1 9.9 0 1 1 0 0 1-1.4 1.43 5.1 5.1 0 0 0-7.1 0 1 1 0 0 1-1.4-1.43Z" />
      <path d="M3.95 9.95a11.56 11.56 0 0 1 16.1 0 1 1 0 1 1-1.4 1.43 9.56 9.56 0 0 0-13.3 0 1 1 0 0 1-1.4-1.43Z" />
    </svg>
  )
}

const ipv4FieldClass =
  'flex h-[42px] w-full items-center rounded-xl border border-surface-border/90 bg-surface-input/80 px-2 font-mono text-[14px] text-label-primary shadow-chromeTop transition-[box-shadow,border-color] focus-within:border-transparent focus-within:ring-2 focus-within:ring-tint-blue/50'

const textFieldClass =
  'h-[42px] w-full rounded-xl border border-surface-border/90 bg-surface-input/80 px-3 text-[14px] text-label-primary shadow-chromeTop transition-[box-shadow,border-color] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-tint-blue/50'

const ipv4OctetClass =
  'min-w-0 w-[2.75rem] flex-1 bg-transparent py-0 text-center text-[14px] text-label-primary focus:outline-none'

function KindSelect({
  value,
  onChange
}: {
  value: MonitoringObjectKind
  onChange: (value: MonitoringObjectKind) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, OBJECT_KIND_OPTIONS.indexOf(value))
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const activeIndexRef = useRef(activeIndex)
  const listId = 'monitoring-object-kind-list'
  activeIndexRef.current = activeIndex

  const close = useCallback((): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  const selectKind = useCallback(
    (kind: MonitoringObjectKind): void => {
      onChange(kind)
      setOpen(false)
      buttonRef.current?.focus()
    },
    [onChange]
  )

  useEffect(() => {
    if (!open) return
    setActiveIndex(Math.max(0, OBJECT_KIND_OPTIONS.indexOf(value)))

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
        const nextIndex =
          (activeIndexRef.current + delta + OBJECT_KIND_OPTIONS.length) % OBJECT_KIND_OPTIONS.length
        activeIndexRef.current = nextIndex
        setActiveIndex(nextIndex)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const next = OBJECT_KIND_OPTIONS[activeIndexRef.current]
        if (next) selectKind(next)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [close, open, selectKind, value])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Тип объекта"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className={`${textFieldClass} flex cursor-pointer items-center justify-between gap-2 px-3 text-left ${
          open ? 'border-transparent ring-2 ring-tint-blue/50' : ''
        }`}
      >
        <span className="min-w-0 truncate">{MONITORING_OBJECT_KIND_EDITOR_LABELS[value]}</span>
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-label-tertiary transition-transform duration-200 ${
            open ? '-rotate-90' : 'rotate-90'
          }`}
        />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Тип объекта"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 m-0 list-none rounded-xl border border-surface-border/80 bg-surface-raised p-1 shadow-sheet"
        >
          {OBJECT_KIND_OPTIONS.map((kind, index) => {
            const selected = kind === value
            const active = index === activeIndex
            return (
              <li key={kind} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectKind(kind)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] tracking-tight transition-colors focus-visible:outline-none ${
                    selected
                      ? 'bg-tint-blue/15 text-label-primary'
                      : active
                        ? 'bg-white/[0.05] text-label-primary'
                        : 'text-label-secondary hover:bg-white/[0.05] hover:text-label-primary'
                  }`}
                >
                  <span>{MONITORING_OBJECT_KIND_EDITOR_LABELS[kind]}</span>
                  {selected ? (
                    <span className="text-tint-blue">
                      <CheckIcon />
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function IPv4Field({
  value,
  onChange,
  autoFocus,
  onEnter,
  'aria-label': ariaLabel
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  onEnter?: () => void
  'aria-label'?: string
}) {
  const firstOctetRef = useRef<HTMLInputElement>(null)
  const secondOctetRef = useRef<HTMLInputElement>(null)
  const thirdOctetRef = useRef<HTMLInputElement>(null)
  const fourthOctetRef = useRef<HTMLInputElement>(null)
  const octetRefs = useMemo(
    () => [firstOctetRef, secondOctetRef, thirdOctetRef, fourthOctetRef],
    []
  )
  const octets = parseIPv4Octets(value)

  const focusOctet = useCallback((index: number): void => {
    octetRefs[index]?.current?.focus()
    octetRefs[index]?.current?.select()
  }, [octetRefs])

  const updateOctets = useCallback(
    (nextOctets: IPv4Octets, focusIndex?: number): void => {
      onChange(joinIPv4Octets(nextOctets))
      if (focusIndex !== undefined) {
        window.requestAnimationFrame(() => focusOctet(focusIndex))
      }
    },
    [focusOctet, onChange]
  )

  const handleOctetChange = (index: number, raw: string): void => {
    const next = [...octets] as IPv4Octets
    next[index] = sanitizeIPv4OctetInput(raw, octets[index])
    updateOctets(next, raw.replace(/\D/g, '').length === 3 && index < 3 ? index + 1 : undefined)
  }

  const handleOctetBlur = (index: number): void => {
    const current = octets[index]
    if (!current) return

    const next = [...octets] as IPv4Octets
    next[index] = String(Math.min(255, Number(current)))
    if (next[index] !== current) updateOctets(next)
  }

  const handleOctetKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === '.') {
      event.preventDefault()
      if (index < 3) focusOctet(index + 1)
      return
    }

    if (event.key === 'Backspace' && !octets[index] && index > 0) {
      event.preventDefault()
      focusOctet(index - 1)
      return
    }

    if (event.key === 'ArrowRight' && event.currentTarget.selectionStart === event.currentTarget.value.length && index < 3) {
      event.preventDefault()
      focusOctet(index + 1)
      return
    }

    if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart === 0 && index > 0) {
      event.preventDefault()
      focusOctet(index - 1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      onEnter?.()
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    const normalized = normalizePastedIPv4(event.clipboardData.getData('text'))
    if (!normalized) return

    event.preventDefault()
    onChange(normalized)
    window.requestAnimationFrame(() => focusOctet(3))
  }

  return (
    <div className={ipv4FieldClass} role="group" aria-label={ariaLabel}>
      {octets.map((octet, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="shrink-0 select-none text-label-tertiary" aria-hidden>.</span>}
          <input
            ref={octetRefs[index]}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={autoFocus && index === 0}
            aria-label={`${ariaLabel ?? 'IP-адрес'}, октет ${index + 1}`}
            maxLength={3}
            value={octet}
            onChange={(event) => handleOctetChange(index, event.target.value)}
            onBlur={() => handleOctetBlur(index)}
            onKeyDown={(event) => handleOctetKeyDown(index, event)}
            onPaste={handlePaste}
            className={ipv4OctetClass}
          />
        </Fragment>
      ))}
    </div>
  )
}

export function ObjectEditorModal({
  editor,
  object,
  onClose,
  onSave,
  onDelete
}: {
  editor: EditorState
  object: MonitoringObject | null
  onClose: () => void
  onSave: (next: MonitoringObject, originalId?: string) => boolean
  onDelete: (id: string) => void
}) {
  const isEdit = editor?.mode === 'edit'
  const [digits, setDigits] = useState('')
  const [objectKind, setObjectKind] = useState<MonitoringObjectKind>(DEFAULT_OBJECT_KIND)
  const [linkHost, setLinkHost] = useState('')
  const [serverHost, setServerHost] = useState('')
  const [serverLogin, setServerLogin] = useState(DEFAULT_SERVER_LOGIN)
  const [serverPassword, setServerPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) {
      setDigits('')
      setObjectKind(DEFAULT_OBJECT_KIND)
      setLinkHost('')
      setServerHost('')
      setServerLogin(DEFAULT_SERVER_LOGIN)
      setServerPassword('')
      setShowPassword(false)
      setError(null)
      return
    }

    if (isEdit && object) {
      setDigits(objectDigits(object))
      setObjectKind(normalizeMonitoringObjectKind(object.objectKind))
      setLinkHost(object.linkHost)
      setServerHost(object.serverHost)
      setServerLogin(object.serverLogin || DEFAULT_SERVER_LOGIN)
      setServerPassword(object.serverPassword)
    } else {
      setDigits('')
      setObjectKind(DEFAULT_OBJECT_KIND)
      setLinkHost('')
      setServerHost('')
      setServerLogin(DEFAULT_SERVER_LOGIN)
      setServerPassword('')
    }
    setShowPassword(false)
    setError(null)
  }, [editor, isEdit, object])

  useEffect(() => {
    if (editor?.mode !== 'add') return
    if (digits.length !== 4) {
      setLinkHost('')
      setServerHost('')
      return
    }
    const defaults = parseMonitoringObject(digits)
    if (!defaults) return
    setLinkHost(defaults.linkHost)
    setServerHost(defaults.serverHost)
  }, [digits, editor?.mode])

  useEffect(() => {
    if (!editor) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor, onClose])

  if (!editor) return null

  const handleSave = (): void => {
    let next: MonitoringObject | null = null
    if (isEdit && object) {
      next = buildMonitoringObject(
        objectDigits(object),
        linkHost,
        serverHost,
        serverLogin,
        serverPassword,
        objectKind
      )
      if (!next) {
        setError('Проверьте IP-адреса')
        return
      }
      next = { ...next, id: object.id, code: object.code }
    } else {
      if (digits.length !== 4) {
        setError('Введите 4 цифры ID объекта')
        return
      }
      next = buildMonitoringObject(digits, linkHost, serverHost, serverLogin, serverPassword, objectKind)
      if (!next) {
        setError('Проверьте ID и IP-адреса')
        return
      }
    }

    const saved = onSave(next, isEdit ? editor.objectId : undefined)
    if (!saved) {
      setError(isEdit ? 'Не удалось сохранить объект' : 'Этот объект уже добавлен')
      return
    }
    onClose()
  }

  return createPortal(
    <div className="tool-view fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-[#0b0e16]/75 backdrop-blur-[6px]" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="monitoring-object-modal-title"
        className="relative z-[1] w-full max-w-[32rem] overflow-visible rounded-[1.25rem] border border-surface-border/90 bg-surface-card shadow-sheet"
      >
        <header className="flex items-center justify-between gap-3 rounded-t-[1.25rem] border-b border-surface-border/80 px-5 py-4">
          <h3 id="monitoring-object-modal-title" className="m-0 text-[17px] font-semibold tracking-tight text-label-primary">
            {isEdit ? 'Настройки объекта' : 'Добавить объект'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-transparent p-2 text-label-tertiary transition-colors hover:border-surface-border/80 hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
            aria-label="Закрыть"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="relative z-10 flex w-[8.75rem] shrink-0 flex-col gap-3">
              <label className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-label-secondary">ID объекта</span>
                <div
                  className={`flex h-[42px] items-center gap-2 rounded-xl border border-surface-border/90 bg-surface-input/80 px-2 shadow-chromeTop transition-[box-shadow,border-color] ${
                    isEdit ? 'opacity-70' : 'focus-within:border-transparent focus-within:ring-2 focus-within:ring-tint-blue/50'
                  }`}
                >
                  <span className="shrink-0 font-mono text-[14px] font-semibold text-tint-blue select-none">owl</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus={!isEdit}
                    readOnly={isEdit}
                    aria-readonly={isEdit}
                    maxLength={4}
                    value={digits}
                    onChange={(event) => {
                      if (isEdit) return
                      setDigits(sanitizeMonitoringDigits(event.target.value))
                      setError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleSave()
                    }}
                    placeholder="0000"
                    className="min-w-0 flex-1 bg-transparent py-0 font-mono text-[16px] tracking-[0.12em] text-label-primary placeholder:text-label-tertiary/40 focus:outline-none read-only:cursor-default"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-2">
                <span className="whitespace-nowrap text-[13px] font-medium text-label-secondary">
                  {`Тип: [БУ\u2009/\u2009ТКРС]`}
                </span>
                <KindSelect
                  value={objectKind}
                  onChange={(next) => {
                    setObjectKind(next)
                    setError(null)
                  }}
                />
              </label>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-end gap-3">
                <span className="flex h-[42px] w-10 shrink-0 items-center justify-center text-label-tertiary" aria-hidden>
                  <EndpointIcon kind="link" />
                </span>
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">IP роутера</span>
                  <IPv4Field
                    value={linkHost}
                    onChange={(next) => {
                      setLinkHost(next)
                      setError(null)
                    }}
                    autoFocus={isEdit}
                    onEnter={handleSave}
                    aria-label="IP роутера"
                  />
                </label>
              </div>

              <div className="flex items-end gap-3">
                <span className="flex h-[42px] w-10 shrink-0 items-center justify-center text-label-tertiary" aria-hidden>
                  <EndpointIcon kind="server" />
                </span>
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">IP сервера</span>
                  <IPv4Field
                    value={serverHost}
                    onChange={(next) => {
                      setServerHost(next)
                      setError(null)
                    }}
                    onEnter={handleSave}
                    aria-label="IP сервера"
                  />
                </label>
              </div>

              <div className="flex gap-2 pl-[3.25rem]">
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">Логин OWL.Guard</span>
                  <input
                    type="text"
                    autoComplete="off"
                    value={serverLogin}
                    onChange={(event) => {
                      setServerLogin(event.target.value)
                      setError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleSave()
                    }}
                    className={textFieldClass}
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">Пароль</span>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={serverPassword}
                      onChange={(event) => {
                        setServerPassword(event.target.value)
                        setError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleSave()
                      }}
                      className={`${textFieldClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-label-tertiary transition-colors hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    >
                      {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </label>
              </div>
            </div>
          </div>
          {error && <p className="mt-4 m-0 text-[13px] text-red-300">{error}</p>}
        </div>

        <footer className="flex justify-end gap-2 rounded-b-[1.25rem] border-t border-surface-border/80 px-5 py-4">
          {isEdit && editor.objectId && (
            <button
              type="button"
              onClick={() => onDelete(editor.objectId!)}
              className="mr-auto h-[42px] rounded-xl border border-transparent px-4 text-[14px] font-medium text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
            >
              Удалить
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-[42px] rounded-xl border border-surface-border bg-transparent px-4 text-[14px] font-medium text-label-secondary transition-colors hover:bg-white/[0.05] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={digits.length !== 4}
            className="h-[42px] rounded-xl bg-tint-blue px-4 text-[14px] font-semibold text-white transition-colors hover:bg-tint-blue-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
          >
            {isEdit ? 'Сохранить' : 'Добавить'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
