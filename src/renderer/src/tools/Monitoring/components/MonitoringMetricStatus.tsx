import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { MonitoringGuardDevice } from '@shared/api'
import { ArrowPathIcon } from '../../../components/Icons'

const RESOURCE_METRIC_FLIP_MS = 5000
const RESOURCE_METRIC_FADE_MS = 700
const GUARD_DEVICE_TYPE_LABELS: Record<string, string> = {
  ive50: 'ИВЭ-50',
  del150: 'ДЭЛ-150',
  wits: 'WITS',
  witsml: 'WITSML',
  redis: 'Ригинтел'
}
export function formatGuardDeviceTypeLabel(type: string): string {
  const trimmed = type.trim()
  if (!trimmed || trimmed === '—') return '—'
  const mapped = GUARD_DEVICE_TYPE_LABELS[trimmed.toLowerCase()]
  if (mapped) return mapped
  if (/[а-яё]/i.test(trimmed)) return trimmed
  return trimmed.toUpperCase()
}

export type SensorIndicatorStatus = 'ok' | 'warning' | 'error' | 'unknown' | 'muted'

export function sensorStatusClass(status: SensorIndicatorStatus): string {
  switch (status) {
    case 'ok':
      return 'text-emerald-400'
    case 'warning':
      return 'text-amber-300'
    case 'error':
      return 'text-red-400'
    default:
      return 'text-label-tertiary'
  }
}

/** Green / yellow / red / gray for the Датчики indicator. */
export function resolveSensorsIndicatorStatus(
  guardDevices: MonitoringGuardDevice[] | undefined,
  devicesOnline: number | undefined,
  linkOnline: boolean,
  serverOnline: boolean
): SensorIndicatorStatus {
  if (!linkOnline || !serverOnline) return 'muted'
  // List not loaded yet, or probe still in flight / no response.
  if (guardDevices === undefined || (guardDevices.length > 0 && devicesOnline === undefined)) {
    return 'unknown'
  }
  // No sources, or none connected.
  if (guardDevices.length === 0 || devicesOnline === 0) return 'error'
  if (devicesOnline === guardDevices.length) return 'ok'
  return 'warning'
}

export function ratioStatusClass(online: number, total: number): string {
  if (total <= 0) return 'text-label-tertiary/50'
  if (online <= 0) return 'text-red-400'
  if (online < total) return 'text-amber-300'
  return 'text-emerald-400'
}
export function MetricCountSpinner() {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-label-tertiary/25 border-t-label-secondary"
      aria-hidden
    />
  )
}
export type SensorDeviceLabel = {
  id: string
  label: string
  status: SensorIndicatorStatus
}

/** Per-device labels for the sensors row (cycled when several; color = that device). */
export function listSensorsDeviceLabels(
  devices: MonitoringGuardDevice[] | undefined,
  onlineIds: number[] | null | undefined,
  linkOnline: boolean,
  serverOnline: boolean
): SensorDeviceLabel[] {
  // List not fetched yet — keep gray "Датчики", same as the icon.
  if (devices === undefined) {
    return [
      {
        id: 'pending',
        label: 'Датчики',
        status: !linkOnline || !serverOnline ? 'muted' : 'unknown'
      }
    ]
  }

  // Loaded empty — no sources.
  if (devices.length === 0) {
    return [
      {
        id: 'empty',
        label: 'Датчики',
        status: !linkOnline || !serverOnline ? 'muted' : 'error'
      }
    ]
  }

  const onlineSet = onlineIds ? new Set(onlineIds) : null
  return devices.map((device) => {
    const label = formatGuardDeviceTypeLabel(device.type)
    let status: SensorIndicatorStatus = 'unknown'
    if (!linkOnline || !serverOnline) status = 'muted'
    else if (onlineSet) status = onlineSet.has(device.id) ? 'ok' : 'error'
    return { id: String(device.id), label, status }
  })
}

export function FlippingSensorLabels({ entries, now }: { entries: SensorDeviceLabel[]; now: number }) {
  if (entries.length <= 1) {
    const entry = entries[0] ?? { id: 'empty', label: 'Датчики', status: 'unknown' as const }
    const statusClass = sensorStatusClass(entry.status)
    return (
      <span
        className={`w-full truncate text-center transition-colors ease-in-out ${statusClass}`}
        style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}
      >
        {entry.label}
      </span>
    )
  }

  const index = Math.floor(now / RESOURCE_METRIC_FLIP_MS) % entries.length
  return (
    <span className="relative inline-grid w-full max-w-full place-items-center text-center">
      {entries.map((entry, entryIndex) => {
        const statusClass = sensorStatusClass(entry.status)
        return (
          <span
            key={entry.id}
            className={`col-start-1 row-start-1 max-w-full truncate text-center transition-[opacity,color] ease-in-out ${statusClass} ${
              entryIndex === index ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}
            aria-hidden={entryIndex !== index}
          >
            {entry.label}
          </span>
        )
      })}
    </span>
  )
}



type MetricTooltipPlacement = {
  left: number
  top: number
  maxHeight: number | undefined
  side: 'above' | 'below'
  arrowLeft: number
}

export function MetricHoverTooltip({
  children,
  anchorEl,
  onMouseEnter,
  onMouseLeave,
  onRefresh,
  refreshing = false
}: {
  children: ReactNode
  anchorEl: HTMLElement | null
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<MetricTooltipPlacement | null>(null)

  useLayoutEffect(() => {
    if (!anchorEl) return

    const update = (): void => {
      const tip = tooltipRef.current
      const content = contentRef.current
      if (!tip || !content) return

      const gap = 8
      const padding = 8
      const arrowInset = 12
      const anchor = anchorEl.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const spaceAbove = Math.max(0, anchor.top - padding - gap)
      const spaceBelow = Math.max(0, vh - anchor.bottom - padding - gap)
      const available = Math.max(spaceAbove, spaceBelow)
      const maxCap = Math.min(vh - padding * 2, available)

      // Measure natural size without a height cap (columns keep the list short).
      content.style.maxHeight = 'none'
      content.style.overflowY = 'visible'
      const naturalHeight = tip.offsetHeight
      const tipWidth = tip.offsetWidth

      let side: 'above' | 'below' = spaceAbove >= spaceBelow ? 'above' : 'below'
      const spaceForSide = side === 'above' ? spaceAbove : spaceBelow
      const needsScroll = naturalHeight > spaceForSide + 1
      // Prefer the side with more room if we would otherwise need to scroll.
      if (needsScroll && (side === 'above' ? spaceBelow : spaceAbove) > spaceForSide) {
        side = side === 'above' ? 'below' : 'above'
      }

      const finalSpace = side === 'above' ? spaceAbove : spaceBelow
      const maxHeight = naturalHeight > finalSpace + 1 ? Math.max(96, Math.min(maxCap, finalSpace)) : undefined
      content.style.maxHeight = maxHeight !== undefined ? `${maxHeight}px` : 'none'
      content.style.overflowY = maxHeight !== undefined ? 'auto' : 'visible'

      const tipHeight = tip.offsetHeight
      let left = anchor.left + anchor.width / 2 - tipWidth / 2
      left = Math.max(padding, Math.min(left, vw - tipWidth - padding))

      let top = side === 'above' ? anchor.top - gap - tipHeight : anchor.bottom + gap
      top = Math.max(padding, Math.min(top, vh - tipHeight - padding))

      const anchorCenterX = anchor.left + anchor.width / 2
      const arrowLeft = Math.max(arrowInset, Math.min(anchorCenterX - left, tip.offsetWidth - arrowInset))

      setPlacement({ left, top, maxHeight, side, arrowLeft })
    }

    update()
    const frame = window.requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorEl, children])

  if (!anchorEl) return null

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        zIndex: 9999,
        visibility: placement ? 'visible' : 'hidden'
      }}
      className="relative w-max max-w-[min(48rem,calc(100vw-1rem))] cursor-default select-none rounded-lg border border-surface-border/80 bg-surface-raised shadow-sheet"
    >
      {onRefresh ? (
        <button
          type="button"
          className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md text-label-secondary transition-colors hover:bg-white/[0.06] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45 disabled:cursor-default disabled:opacity-60"
          title="Обновить"
          aria-label="Обновить данные"
          aria-busy={refreshing}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      ) : null}
      <div
        ref={contentRef}
        className={`overscroll-contain py-2.5 pl-3 ${onRefresh ? 'pr-11' : 'pr-3'}`}
        style={{
          maxHeight: placement?.maxHeight,
          overflowY: placement?.maxHeight !== undefined ? 'auto' : 'visible'
        }}
      >
        {children}
      </div>
      {placement ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute h-2 w-2 rotate-45 border-surface-border/80 bg-surface-raised ${
            placement.side === 'above'
              ? '-bottom-[5px] border-b border-r'
              : '-top-[5px] border-l border-t'
          }`}
          style={{ left: placement.arrowLeft, transform: 'translateX(-50%) rotate(45deg)' }}
        />
      ) : null}
    </div>,
    document.body
  )
}

export function MonitoringMetricStatus({
  label,
  online,
  total,
  icon,
  muted = false,
  onlineUnknown = false,
  loading = false,
  failed = false,
  hoverTooltip = null,
  onRefresh,
  refreshing = false
}: {
  label: string
  /** `null` — сервер ещё не ответил числом online. */
  online: number | null
  total: number
  icon: ReactNode
  muted?: boolean
  /** When true, show "?" instead of the online count (e.g. no link). */
  onlineUnknown?: boolean
  /** Probe in flight — spinner instead of the online count. */
  loading?: boolean
  /** Last probe failed — keep ?/N without an endless spinner. */
  failed?: boolean
  /** Rich hover tip (e.g. camera list). When set, replaces the native title. */
  hoverTooltip?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const [hovered, setHovered] = useState(false)
  const hasOnlineValue = online !== null && !onlineUnknown && !loading && !failed
  const statusClass =
    muted || onlineUnknown || loading || failed || online === null
      ? failed && !muted
        ? 'text-amber-300'
        : 'text-label-tertiary'
      : ratioStatusClass(online, total)
  const onlineLabel = onlineUnknown || online === null || failed ? '?' : String(online)
  const openTooltip = (): void => {
    if (!hoverTooltip) return
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = undefined
    }
    setHovered(true)
  }

  const scheduleCloseTooltip = (): void => {
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      setHovered(false)
      hideTimerRef.current = undefined
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className={`-mx-1 grid grid-cols-[1.5rem_auto] items-center gap-x-2 rounded-lg px-1 py-0.5 transition-colors duration-150 ${
        hovered && hoverTooltip ? 'bg-white/[0.035]' : 'bg-transparent'
      }`}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleCloseTooltip}
      aria-label={`${label}: ${onlineLabel}/${total}`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${statusClass}`}>{icon}</span>
      <p
        className={`m-0 flex h-5 min-w-0 items-center font-mono text-[15px] font-semibold leading-5 tracking-tight tabular-nums ${
          muted || onlineUnknown || loading || failed || !hasOnlineValue
            ? failed && !muted
              ? 'text-amber-300'
              : 'text-label-tertiary'
            : 'text-label-primary'
        }`}
      >
        <span className="inline-flex h-5 w-[2ch] shrink-0 items-center justify-end">
          {loading ? <MetricCountSpinner /> : onlineLabel}
        </span>
        <span className="shrink-0">/</span>
        <span className="inline-flex h-5 min-w-[2ch] items-center">{total}</span>
      </p>
      {hovered && hoverTooltip ? (
        <MetricHoverTooltip
          anchorEl={rootRef.current}
          onMouseEnter={openTooltip}
          onMouseLeave={scheduleCloseTooltip}
          onRefresh={onRefresh}
          refreshing={refreshing}
        >
          {hoverTooltip}
        </MetricHoverTooltip>
      ) : null}
    </div>
  )
}

export function MonitoringIndicatorStatus({
  entries,
  status,
  icon,
  now,
  loading = false,
  hoverTooltip = null,
  onRefresh,
  refreshing = false
}: {
  entries: SensorDeviceLabel[]
  status: SensorIndicatorStatus
  icon: ReactNode
  now: number
  loading?: boolean
  hoverTooltip?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const [hovered, setHovered] = useState(false)
  const iconStatusClass = loading ? 'text-label-tertiary' : sensorStatusClass(status)
  const activeIndex =
    entries.length > 0 ? Math.floor(now / RESOURCE_METRIC_FLIP_MS) % entries.length : 0
  const activeEntry = entries[activeIndex]
  const ariaLabel = loading ? 'Датчики: загрузка' : activeEntry?.label || 'Датчики'

  const openTooltip = (): void => {
    if (!hoverTooltip) return
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = undefined
    }
    setHovered(true)
  }

  const scheduleCloseTooltip = (): void => {
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      setHovered(false)
      hideTimerRef.current = undefined
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className={`-mx-1 grid grid-cols-[1.5rem_auto] items-center gap-x-2 rounded-lg px-1 py-0.5 transition-colors duration-150 ${
        hovered && hoverTooltip ? 'bg-white/[0.035]' : 'bg-transparent'
      }`}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleCloseTooltip}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center ${iconStatusClass}`}
        aria-label={ariaLabel}
      >
        {icon}
      </span>
      <span className="m-0 flex h-5 min-w-0 items-center justify-center font-mono text-[12px] font-semibold leading-5 tracking-tight">
        {loading ? <MetricCountSpinner /> : <FlippingSensorLabels entries={entries} now={now} />}
      </span>
      {hovered && hoverTooltip ? (
        <MetricHoverTooltip
          anchorEl={rootRef.current}
          onMouseEnter={openTooltip}
          onMouseLeave={scheduleCloseTooltip}
          onRefresh={onRefresh}
          refreshing={refreshing}
        >
          {hoverTooltip}
        </MetricHoverTooltip>
      ) : null}
    </div>
  )
}
