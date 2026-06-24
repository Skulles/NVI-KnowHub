import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MonitoringPingResult, MonitoringPingStatus, MonitoringPingTarget } from '@shared/api'
import {
  MONITORING_INTERVALS,
  loadMonitoringSnapshot,
  parseMonitoringObject,
  sanitizeMonitoringDigits,
  saveMonitoringSnapshot,
  type MonitoringObject
} from './monitoringStorage'

type ResultMap = Record<string, MonitoringPingResult>
type MonitoringIntervalValue = (typeof MONITORING_INTERVALS)[number]['value']

function targetId(objectId: string, kind: 'link' | 'server'): string {
  return `${objectId}:${kind}`
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

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-surface-border bg-surface-card shadow-sheet overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-4 border-b border-surface-divider">
        <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-tint-blue">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function IntervalSelect({
  value,
  onChange
}: {
  value: number
  onChange: (value: MonitoringIntervalValue) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = MONITORING_INTERVALS.find((interval) => interval.value === value) ?? MONITORING_INTERVALS[1]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className="flex h-[42px] min-w-[8.5rem] items-center justify-between gap-3 rounded-xl border border-surface-border/90 bg-surface-input/80 px-3 text-left text-[15px] text-label-primary shadow-chromeTop transition-[box-shadow,border-color,background-color] hover:bg-surface-input focus:border-transparent focus:outline-none focus:ring-2 focus:ring-tint-blue/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected.label}</span>
        <span className={`text-label-tertiary transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-2 w-full overflow-hidden rounded-xl border border-surface-border bg-surface-card py-1 shadow-sheet ring-1 ring-surface-border/40"
        >
          {MONITORING_INTERVALS.map((interval) => {
            const active = interval.value === value
            return (
              <button
                key={interval.value}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(interval.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[14px] transition-colors ${
                  active
                    ? 'bg-tint-blue/15 text-label-primary'
                    : 'text-label-secondary hover:bg-white/[0.06] hover:text-label-primary'
                }`}
              >
                <span>{interval.label}</span>
                {active && <span className="text-tint-blue">●</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
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

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M9.45 5.25a1 1 0 0 0-.8.4L7.25 7.5H6A3 3 0 0 0 3 10.5V17a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6.5a3 3 0 0 0-3-3h-1.25l-1.4-1.85a1 1 0 0 0-.8-.4h-5.1ZM12 16.75a3.75 3.75 0 1 1 0-7.5 3.75 3.75 0 0 1 0 7.5Z" />
      <path d="M12 14.9a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z" />
    </svg>
  )
}

function MegaphoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M15.75 5.2a1 1 0 0 1 1.25.97v11.66a1 1 0 0 1-1.25.97L7.4 16.6H5.75A2.75 2.75 0 0 1 3 13.85v-3.7A2.75 2.75 0 0 1 5.75 7.4H7.4l8.35-2.2Z" />
      <path d="M8.2 17.35h2.15l.9 3.15a1 1 0 0 1-.96 1.27H9.18a1 1 0 0 1-.96-.72l-1-3.5c.34-.02.67-.09.98-.2ZM19.15 8.8a1 1 0 0 1 1.4.2 5.05 5.05 0 0 1 0 6 1 1 0 0 1-1.6-1.2 3.05 3.05 0 0 0 0-3.6 1 1 0 0 1 .2-1.4Z" />
    </svg>
  )
}

function CardCounter({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center justify-between gap-2 font-mono text-[13px] font-medium text-label-secondary">
      <span className="text-label-tertiary">{icon}</span>
      {label}
    </span>
  )
}

function EndpointStatus({
  label,
  host,
  result,
  checking,
  kind
}: {
  label: string
  host: string
  result: MonitoringPingResult | undefined
  checking: boolean
  kind: 'link' | 'server'
}) {
  const status = result?.status ?? 'unknown'

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center ${statusClasses(status, checking)}`} title={statusText(status, checking)}>
          <EndpointIcon kind={kind} />
        </span>
        <div className="min-w-0">
          <p className={`m-0 text-[14px] font-medium ${endpointLabelClasses(status)}`}>{label}</p>
          <p className="mt-0.5 font-mono text-[13px] text-label-tertiary">{host}</p>
        </div>
      </div>
      {result?.error && <p className="mt-2 pl-7 text-[12px] leading-relaxed text-amber-300">{result.error}</p>}
    </div>
  )
}

function MonitoringObjectCard({
  object,
  results,
  checking,
  onRemove
}: {
  object: MonitoringObject
  results: ResultMap
  checking: boolean
  onRemove: (id: string) => void
}) {
  const linkResult = results[targetId(object.id, 'link')]
  const serverResult = results[targetId(object.id, 'server')]
  const title = object.code.replace(/\/$/, '')

  return (
    <Card
      title={title}
      action={
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => onRemove(object.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-label-tertiary transition-colors hover:bg-white/[0.05] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
            aria-label="Удалить объект"
          >
            <span className="text-[18px] leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="grid gap-3">
          <EndpointStatus label="Связь" host={object.linkHost} result={linkResult} checking={checking} kind="link" />
          <EndpointStatus label="Сервер" host={object.serverHost} result={serverResult} checking={checking} kind="server" />
        </div>
        <div className="flex min-w-[5.25rem] flex-row gap-4 border-t border-surface-divider pt-3 sm:flex-col sm:gap-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <CardCounter icon={<CameraIcon />} label="0/0" />
          <CardCounter icon={<MegaphoneIcon />} label="0/0" />
        </div>
      </div>
    </Card>
  )
}

export function Monitoring() {
  const [snapshot, setSnapshot] = useState(() => loadMonitoringSnapshot())
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ResultMap>({})
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)

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
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [targets])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!targets.length) return

    const timer = window.setInterval(() => {
      void refresh()
    }, snapshot.intervalMs)

    return () => window.clearInterval(timer)
  }, [refresh, snapshot.intervalMs, targets.length])

  const addObject = useCallback(() => {
    const object = parseMonitoringObject(input)
    if (!object) {
      setError('Введите 4 цифры объекта')
      return
    }

    if (snapshot.objects.some((item) => item.id === object.id)) {
      setError('Этот объект уже добавлен')
      return
    }

    setError(null)
    setInput('')
    setAdding(false)
    setSnapshot((prev) => ({ ...prev, objects: [...prev.objects, object] }))
  }, [input, snapshot.objects])

  const removeObject = useCallback((id: string) => {
    setSnapshot((prev) => ({ ...prev, objects: prev.objects.filter((object) => object.id !== id) }))
    setResults((prev) => {
      const next = { ...prev }
      delete next[targetId(id, 'link')]
      delete next[targetId(id, 'server')]
      return next
    })
  }, [])

  const cancelAdding = useCallback(() => {
    setAdding(false)
    setInput('')
    setError(null)
  }, [])

  return (
    <article className="max-w-[64rem] pb-12">
      <header className="mb-6">
        <h1 className="text-[1.625rem] font-semibold tracking-tighter text-label-primary">Мониторинг</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-label-secondary">
          Для работы инструмента необходимо подключиться к VPN.
        </p>
      </header>

      <div className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-[42px] items-center gap-2 rounded-xl border border-surface-border/90 bg-surface-input/80 px-2 py-0 shadow-chromeTop transition-[box-shadow,border-color] focus-within:border-transparent focus-within:ring-2 focus-within:ring-tint-blue/50">
                <span className="shrink-0 font-mono text-[14px] font-semibold text-tint-blue select-none">owl</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  maxLength={4}
                  value={input}
                  onChange={(event) => {
                    setInput(sanitizeMonitoringDigits(event.target.value))
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addObject()
                    if (event.key === 'Escape') cancelAdding()
                  }}
                  placeholder="0000"
                  className="w-[3.5rem] shrink-0 bg-transparent py-0 font-mono text-[16px] tracking-[0.12em] text-label-primary placeholder:text-label-tertiary/40 focus:outline-none"
                  aria-label="Цифры объекта"
                />
              </div>
              <button
                type="button"
                onClick={addObject}
                disabled={input.length !== 4}
                className="h-[42px] rounded-xl bg-tint-blue px-4 text-[14px] font-semibold text-white transition-colors hover:bg-tint-blue-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
              >
                Добавить
              </button>
              <button
                type="button"
                onClick={cancelAdding}
                className="h-[42px] rounded-xl border border-surface-border bg-transparent px-3 text-[14px] font-medium text-label-secondary transition-colors hover:bg-white/[0.05] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
              >
                Отмена
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true)
                setError(null)
              }}
              className="h-[42px] rounded-xl bg-tint-blue px-4 text-[14px] font-semibold text-white transition-colors hover:bg-tint-blue-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
            >
              Добавить объект
            </button>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[13px] text-label-tertiary">Обновление</span>
            <IntervalSelect
              value={snapshot.intervalMs}
              onChange={(intervalMs) => setSnapshot((prev) => ({ ...prev, intervalMs }))}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-[13px] text-red-300">{error}</p>}
      </div>

      {snapshot.objects.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {snapshot.objects.map((object) => (
            <MonitoringObjectCard
              key={object.id}
              object={object}
              results={results}
              checking={refreshing}
              onRemove={removeObject}
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
