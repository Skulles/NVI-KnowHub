import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { XMarkIcon } from '../../components/Icons'
import type { MonitoringPingResult, MonitoringPingStatus, MonitoringPingTarget } from '@shared/api'
import {
  MONITORING_REFRESH_INTERVAL_MS,
  buildMonitoringObject,
  joinIPv4Octets,
  loadMonitoringSnapshot,
  normalizePastedIPv4,
  objectDigits,
  parseIPv4Octets,
  parseMonitoringObject,
  sanitizeMonitoringDigits,
  sanitizeIPv4OctetInput,
  saveMonitoringSnapshot,
  type IPv4Octets,
  type MonitoringObject
} from './monitoringStorage'

type ResultMap = Record<string, MonitoringPingResult>
type LatencyHistoryMap = Record<string, number[]>
type EditorState = { mode: 'add' | 'edit'; objectId?: string } | null

const LINK_LATENCY_HISTORY_LIMIT = 10

function targetId(objectId: string, kind: 'link' | 'server'): string {
  return `${objectId}:${kind}`
}

function averageLatency(history: number[] | undefined): number | null {
  if (!history?.length) return null
  return history.reduce((sum, value) => sum + value, 0) / history.length
}

function formatLatency(latencyMs: number): string {
  return `~${Math.round(latencyMs)} мс`
}

function latencyTextClasses(latencyMs: number | null): string {
  if (latencyMs === null) return 'text-label-tertiary'
  if (latencyMs <= 100) return 'text-emerald-400'
  if (latencyMs <= 300) return 'text-amber-300'
  return 'text-red-400'
}

function statusText(status: MonitoringPingStatus | 'unknown', checking: boolean): string {
  if (checking) return 'Проверка'
  switch (status) {
    case 'online':
      return 'Онлайн'
    case 'offline':
      return 'Офлайн'
    case 'error':
      return 'Ошибка'
    default:
      return 'Нет данных'
  }
}

function linkConnectionText(status: MonitoringPingStatus | 'unknown', checking: boolean): string {
  if (checking || status === 'unknown') return 'Проверка соединения…'
  switch (status) {
    case 'online':
      return 'Соединение установлено'
    case 'offline':
      return 'Нет ответа'
    case 'error':
      return 'Ошибка соединения'
    default:
      return 'Проверка соединения…'
  }
}

function statusClasses(status: MonitoringPingStatus | 'unknown', checking: boolean): string {
  if (checking && status === 'unknown') return 'text-tint-blue'
  switch (status) {
    case 'online':
      return 'text-emerald-400'
    case 'offline':
      return 'text-red-400'
    case 'error':
      return 'text-amber-400'
    default:
      return 'text-label-tertiary/50'
  }
}

function endpointLabelClasses(status: MonitoringPingStatus | 'unknown'): string {
  return status === 'offline' || status === 'error' ? 'text-red-400' : 'text-label-primary'
}

function Card({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="group rounded-2xl border border-surface-border bg-surface-card shadow-sheet overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <h2 className="m-0 text-[12px] uppercase tracking-[0.1em] text-tint-blue">{title}</h2>
        {action}
      </header>
      <div className="px-5 pb-5 pt-0">{children}</div>
    </section>
  )
}

function ObjectCodeTitle({ code }: { code: string }) {
  const normalized = code.replace(/\/$/, '')
  const match = normalized.match(/^(owl)(.*)$/i)
  if (!match) {
    return <span className="font-semibold [font-variation-settings:'wght'_600]">{normalized}</span>
  }

  return (
    <>
      <span className="font-normal [font-variation-settings:'wght'_430]">{match[1]}</span>
      <span className="font-bold [font-variation-settings:'wght'_700]">{match[2]}</span>
    </>
  )
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.606 7.606 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 0 1 0-7.5 3.75 3.75 0 0 1 0 7.5Z"
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

const ipv4OctetClass =
  'min-w-0 w-[2.75rem] flex-1 bg-transparent py-0 text-center text-[14px] text-label-primary focus:outline-none'

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
  const octetRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const octets = parseIPv4Octets(value)

  const focusOctet = (index: number): void => {
    octetRefs[index]?.current?.focus()
    octetRefs[index]?.current?.select()
  }

  const updateOctets = useCallback(
    (nextOctets: IPv4Octets, focusIndex?: number): void => {
      onChange(joinIPv4Octets(nextOctets))
      if (focusIndex !== undefined) {
        window.requestAnimationFrame(() => focusOctet(focusIndex))
      }
    },
    [onChange]
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

function ObjectEditorModal({
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
  const [linkHost, setLinkHost] = useState('')
  const [serverHost, setServerHost] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) return

    if (isEdit && object) {
      setDigits(objectDigits(object))
      setLinkHost(object.linkHost)
      setServerHost(object.serverHost)
    } else {
      setDigits('')
      setLinkHost('')
      setServerHost('')
    }
    setError(null)
  }, [editor, isEdit, object])

  useEffect(() => {
    if (editor?.mode !== 'add' || digits.length !== 4) return
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
      next = buildMonitoringObject(objectDigits(object), linkHost, serverHost)
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

      next = buildMonitoringObject(digits, linkHost, serverHost)
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
      <div
        className="absolute inset-0 bg-[#0b0e16]/75 backdrop-blur-[6px]"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="monitoring-object-modal-title"
        className="relative z-[1] w-full max-w-[32rem] overflow-hidden rounded-[1.25rem] border border-surface-border/90 bg-surface-card shadow-sheet"
      >
        <header className="flex items-center justify-between gap-3 border-b border-surface-border/80 px-5 py-4">
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
            <label className="flex shrink-0 flex-col gap-2">
              <span className="text-[13px] font-medium text-label-secondary">ID объекта</span>
              <div
                className={`flex h-[42px] items-center gap-2 rounded-xl border border-surface-border/90 bg-surface-input/80 px-2 shadow-chromeTop transition-[box-shadow,border-color] ${
                  isEdit
                    ? 'opacity-70'
                    : 'focus-within:border-transparent focus-within:ring-2 focus-within:ring-tint-blue/50'
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
                  className="w-[3.5rem] shrink-0 bg-transparent py-0 font-mono text-[16px] tracking-[0.12em] text-label-primary placeholder:text-label-tertiary/40 focus:outline-none read-only:cursor-default"
                />
              </div>
            </label>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-end gap-3">
                <span
                  className="flex h-[42px] w-10 shrink-0 items-center justify-center text-label-tertiary"
                  aria-hidden
                >
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
                <span
                  className="flex h-[42px] w-10 shrink-0 items-center justify-center text-label-tertiary"
                  aria-hidden
                >
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
            </div>
          </div>

          {error && <p className="mt-4 m-0 text-[13px] text-red-300">{error}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-surface-border/80 px-5 py-4">
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

function EndpointStatus({
  label,
  host,
  result,
  checking,
  kind,
  averageLatencyMs,
  muted = false
}: {
  label: string
  host: string
  result: MonitoringPingResult | undefined
  checking: boolean
  kind: 'link' | 'server'
  averageLatencyMs?: number | null
  muted?: boolean
}) {
  const status = result?.status ?? 'unknown'
  const hasLatency =
    !muted && kind === 'link' && status === 'online' && averageLatencyMs !== null && averageLatencyMs !== undefined
  const detail =
    kind === 'link' ? (hasLatency ? formatLatency(averageLatencyMs) : linkConnectionText(status, checking)) : host
  const detailClass = muted
    ? 'text-label-tertiary'
    : kind === 'link'
      ? hasLatency
        ? latencyTextClasses(averageLatencyMs)
        : checking || status === 'unknown' || status === 'offline'
          ? 'text-label-tertiary'
          : statusClasses(status, checking)
      : 'text-label-tertiary'

  return (
    <div className="min-h-[2.5rem]">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center ${muted ? 'text-label-tertiary' : statusClasses(status, checking)}`}
          title={muted ? 'Связь недоступна' : statusText(status, checking)}
        >
          <EndpointIcon kind={kind} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className={`m-0 text-[14px] leading-5 font-medium ${muted ? 'text-label-tertiary' : endpointLabelClasses(status)}`}>{label}</p>
          <p
            className={`mt-0.5 min-h-[1.125rem] text-[13px] leading-[1.125rem] ${hasLatency ? 'font-mono' : ''} ${detailClass}`}
            title={host}
          >
            {detail}
          </p>
        </div>
      </div>
      {result?.error && !muted && <p className="mt-2 pl-[3.25rem] text-[12px] leading-relaxed text-amber-300">{result.error}</p>}
    </div>
  )
}

function MonitoringObjectCard({
  object,
  results,
  latencyHistory,
  checking,
  onEdit
}: {
  object: MonitoringObject
  results: ResultMap
  latencyHistory: LatencyHistoryMap
  checking: boolean
  onEdit: (id: string) => void
}) {
  const linkResult = results[targetId(object.id, 'link')]
  const serverResult = results[targetId(object.id, 'server')]
  const linkAverageLatencyMs = averageLatency(latencyHistory[targetId(object.id, 'link')])
  const linkOnline = (linkResult?.status ?? 'unknown') === 'online'

  return (
    <Card
      title={<ObjectCodeTitle code={object.code} />}
      action={
        <button
          type="button"
          onClick={() => onEdit(object.id)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-label-tertiary opacity-0 transition-[opacity,color] duration-150 hover:bg-white/[0.05] hover:text-label-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
          aria-label="Настройки объекта"
        >
          <CogIcon />
        </button>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-3">
          <EndpointStatus
            label="Связь"
            host={object.linkHost}
            result={linkResult}
            checking={checking}
            kind="link"
            averageLatencyMs={linkAverageLatencyMs}
          />
          <EndpointStatus
            label="Сервер"
            host={object.serverHost}
            result={serverResult}
            checking={checking}
            kind="server"
            muted={!linkOnline}
          />
        </div>
      </div>
    </Card>
  )
}

export function Monitoring() {
  const [snapshot, setSnapshot] = useState(() => loadMonitoringSnapshot())
  const [editor, setEditor] = useState<EditorState>(null)
  const [results, setResults] = useState<ResultMap>({})
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistoryMap>({})
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)

  const editingObject = useMemo(
    () => (editor?.mode === 'edit' && editor.objectId ? snapshot.objects.find((object) => object.id === editor.objectId) ?? null : null),
    [editor, snapshot.objects]
  )

  useEffect(() => {
    saveMonitoringSnapshot(snapshot)
  }, [snapshot])

  const targets = useMemo<MonitoringPingTarget[]>(
    () =>
      snapshot.objects.flatMap((object) => [
        { id: targetId(object.id, 'link'), label: `${object.code} связь`, host: object.linkHost },
        { id: targetId(object.id, 'server'), label: `${object.code} сервер`, host: object.serverHost }
      ]),
    [snapshot.objects]
  )

  const refresh = useCallback(async () => {
    if (!targets.length || refreshingRef.current) return

    refreshingRef.current = true
    setRefreshing(true)

    try {
      const nextResults = window.api ? await window.api.monitoringPing(targets) : []
      setResults((prev) => {
        const next = { ...prev }
        nextResults.forEach((result) => {
          next[result.id] = result
        })
        return next
      })
      setLatencyHistory((prev) => {
        let next = prev

        nextResults.forEach((result) => {
          if (!result.id.endsWith(':link') || result.status !== 'online' || result.latencyMs === null) return

          if (next === prev) next = { ...prev }
          next[result.id] = [...(next[result.id] ?? []), result.latencyMs].slice(-LINK_LATENCY_HISTORY_LIMIT)
        })

        return next
      })
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [targets])

  useEffect(() => {
    if (!targets.length) return

    let cancelled = false
    let timer: number | undefined

    const run = async (): Promise<void> => {
      await refresh()
      if (cancelled) return
      timer = window.setTimeout(run, MONITORING_REFRESH_INTERVAL_MS)
    }

    void run()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refresh, targets.length])

  const clearObjectResults = useCallback((id: string) => {
    setResults((prev) => {
      const next = { ...prev }
      delete next[targetId(id, 'link')]
      delete next[targetId(id, 'server')]
      return next
    })
    setLatencyHistory((prev) => {
      const next = { ...prev }
      delete next[targetId(id, 'link')]
      return next
    })
  }, [])

  const saveObject = useCallback(
    (next: MonitoringObject, originalId?: string): boolean => {
      const prev = snapshot
      let nextObjects: MonitoringObject[] | null = null

      if (originalId) {
        nextObjects = prev.objects.map((object) => (object.id === originalId ? { ...next, id: originalId, code: object.code } : object))
      } else if (prev.objects.some((object) => object.id === next.id)) {
        return false
      } else {
        nextObjects = [...prev.objects, next]
      }

      setSnapshot({ objects: nextObjects })

      clearObjectResults(originalId ?? next.id)

      return true
    },
    [clearObjectResults, snapshot]
  )

  const deleteObject = useCallback(
    (objectId: string) => {
      setSnapshot((prev) => ({ objects: prev.objects.filter((object) => object.id !== objectId) }))
      clearObjectResults(objectId)
      setEditor((prev) => (prev?.mode === 'edit' && prev.objectId === objectId ? null : prev))
    },
    [clearObjectResults]
  )

  const openAddEditor = useCallback(() => {
    setEditor({ mode: 'add' })
  }, [])

  const openEditEditor = useCallback((objectId: string) => {
    setEditor({ mode: 'edit', objectId })
  }, [])

  const closeEditor = useCallback(() => {
    setEditor(null)
  }, [])

  return (
    <article className="max-w-[64rem] pb-12">
      <header className="mb-6">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h1 className="m-0 text-[1.625rem] font-semibold tracking-tighter text-label-primary">Мониторинг</h1>
          </div>
          <button
            type="button"
            onClick={openAddEditor}
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-tint-blue px-2.5 py-1.5 text-[12px] font-semibold tracking-tight text-white shadow-sm transition-colors duration-200 hover:bg-tint-blue-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-window"
          >
            Добавить объект
          </button>
        </div>
        <p className="text-[14px] leading-relaxed text-label-secondary">
          Для работы инструмента необходимо подключиться к VPN.
        </p>
      </header>

      <ObjectEditorModal
        editor={editor}
        object={editingObject}
        onClose={closeEditor}
        onSave={saveObject}
        onDelete={deleteObject}
      />

      {snapshot.objects.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {snapshot.objects.map((object) => (
            <MonitoringObjectCard
              key={object.id}
              object={object}
              results={results}
              latencyHistory={latencyHistory}
              checking={refreshing}
              onEdit={openEditEditor}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[min(420px,calc(100vh-18rem))] items-center justify-center">
          <p className="text-center text-[15px] font-medium text-label-tertiary">
            Нет объектов для отслеживания
          </p>
        </div>
      )}
    </article>
  )
}
