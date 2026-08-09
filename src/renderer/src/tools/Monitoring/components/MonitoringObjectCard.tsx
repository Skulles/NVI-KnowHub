import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  MonitoringCameraStream,
  MonitoringGuardDevice,
  MonitoringLocation,
  MonitoringMegaphone,
  MonitoringPingResult,
  MonitoringPingStatus
} from '@shared/api'
import cameraIconUrl from '../../../assets/monitoring/camera-icon.png'
import hornIconUrl from '../../../assets/monitoring/horn-icon.png'
import {
  DEFAULT_SERVER_LOGIN,
  isValidIPv4,
  resolvePrimaryLocationName,
  type MonitoringObject
} from '../monitoringStorage'
import type {
  LatencyHistoryMap,
  MonitoringMetricKind,
  ResultMap,
  ServerResourceStubs
} from '../monitoringTypes'
import {
  MetricCountSpinner,
  MonitoringIndicatorStatus,
  MonitoringMetricStatus,
  listSensorsDeviceLabels,
  resolveSensorsIndicatorStatus
} from './MonitoringMetricStatus'

const OWL_GUARD_UNREACHABLE = 'не удалось подключиться к OWL.Guard'
const METRICS_UNAVAILABLE = 'не удалось получить данные'
const LINK_UNSTABLE = '[соединение нестабильно]'

function targetId(objectId: string, kind: 'link' | 'server'): string {
  return `${objectId}:${kind}`
}

function isOnline(result: MonitoringPingResult | undefined): boolean {
  return (result?.status ?? 'unknown') === 'online'
}
function averageLatency(history: number[] | undefined): number | null {
  if (!history?.length) return null
  return history.reduce((sum, value) => sum + value, 0) / history.length
}
function formatServerVersionLabel(version: string): string {
  const trimmed = version.trim()
  if (!trimmed) return ''
  const label = /^версия\b/i.test(trimmed) ? trimmed : `Версия ${trimmed}`
  return `[${label}]`
}
function formatLatency(latencyMs: number): string {
  return `~${Math.round(latencyMs)}\u2009мс`
}
function latencyTextClasses(latencyMs: number | null): string {
  if (latencyMs === null) return 'text-label-tertiary'
  if (latencyMs <= 100) return 'text-emerald-400'
  if (latencyMs <= 300) return 'text-amber-300'
  return 'text-red-400'
}
function linkConnectionText(status: MonitoringPingStatus | 'unknown', checking: boolean): string {
  if (checking || status === 'unknown') return 'Проверка соединения…'
  if (status === 'online') return 'Соединение установлено'
  if (status === 'offline') return 'Нет ответа'
  if (status === 'error') return 'Ошибка соединения'
  return 'Проверка соединения…'
}
function statusClasses(status: MonitoringPingStatus | 'unknown', checking: boolean, degraded = false): string {
  if (checking && status === 'unknown') return 'text-tint-blue'
  if (degraded && status === 'online') return 'text-amber-300'
  if (status === 'online') return 'text-emerald-400'
  if (status === 'offline') return 'text-red-400'
  if (status === 'error') return 'text-amber-400'
  return 'text-label-tertiary/50'
}

function Card({
  title,
  children,
  action,
  compact = false
}: {
  title: ReactNode
  children: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <section
      className="group overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sheet"
    >
      <header
        className={`flex items-start justify-between gap-4 px-5 py-4 ${
          compact ? 'pb-1 pt-2' : ''
        }`}
      >
        <h2 className="m-0 min-w-0 flex-1 text-[12px] font-semibold uppercase tracking-[0.09em] text-tint-blue">
          {title}
        </h2>
        {action}
      </header>
      <div className={`px-5 pt-0 ${compact ? 'pb-3' : 'pb-5'}`}>
        {children}
      </div>
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
    <span className="inline-flex items-baseline">
      <span className="font-normal tracking-[0.09em] [font-variation-settings:'wght'_430]">{match[1]}</span>
      <span className="ml-[0.16em] font-bold tracking-[0.12em] [font-variation-settings:'wght'_700]">
        {match[2]}
      </span>
    </span>
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

function OpenExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5M15 3h6m0 0v6m0-6L10.5 13.5"
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

function CamerasIcon() {
  return (
    <span
      className="inline-block h-5 w-5 bg-current"
      style={{
        WebkitMaskImage: `url(${cameraIconUrl})`,
        maskImage: `url(${cameraIconUrl})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center'
      }}
      aria-hidden
    />
  )
}

function HornsIcon() {
  return (
    <span
      className="inline-block h-5 w-5 bg-current"
      style={{
        WebkitMaskImage: `url(${hornIconUrl})`,
        maskImage: `url(${hornIconUrl})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center'
      }}
      aria-hidden
    />
  )
}

function SensorsIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M8.075 7.997a1 1 0 0 1-1.05-1.216L5.604 5.14l.534-.534L7.78 6.024a1 1 0 0 1 1.216 1.05L10.068 8 9 9.068l-.925-1.07Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 12.659a6 6 0 1 0-4 0V13H4v2h8v-2h-2v-.341ZM12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
      />
    </svg>
  )
}



const RESOURCE_METRIC_FLIP_MS = 5000
const RESOURCE_METRIC_FADE_MS = 700
const RESOURCE_UNAVAILABLE = 'Н/Д'
const SIGNIFICANT_PACKET_LOSS_PERCENT = 25

function formatResourceLoad(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? RESOURCE_UNAVAILABLE
    : `${Math.round(value)}\u2009%`
}

function formatResourceTemp(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? RESOURCE_UNAVAILABLE : `${Math.round(value)}°C`
}

function resourceLoadTextClass(loadPercent: number | null | undefined): string {
  if (loadPercent === null || loadPercent === undefined || !Number.isFinite(loadPercent)) return 'text-label-tertiary'
  return loadPercent > 85 ? 'text-red-400' : 'text-label-tertiary'
}

function resourceTempTextClass(tempC: number | null | undefined): string {
  if (tempC === null || tempC === undefined || !Number.isFinite(tempC)) return 'text-label-tertiary'
  return tempC > 85 ? 'text-red-400' : 'text-label-tertiary'
}

function FlippingMetricValue({
  loadLabel,
  tempLabel,
  showTemp,
  loadClass,
  tempClass
}: {
  loadLabel: string
  tempLabel: string
  showTemp: boolean
  loadClass: string
  tempClass: string
}) {
  // Fixed slot for up to 3 digits + unit (`100%` / `100°C` / `Н/Д`), centered so flips don't shift.
  return (
    <span className="relative inline-grid w-[5ch] place-items-center text-center tabular-nums">
      <span
        className={`col-start-1 row-start-1 transition-[opacity,color] ease-in-out ${loadClass} ${
          showTemp ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}
      >
        {loadLabel}
      </span>
      <span
        className={`col-start-1 row-start-1 transition-[opacity,color] ease-in-out ${tempClass} ${
          showTemp ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}
      >
        {tempLabel}
      </span>
    </span>
  )
}

function ResourceMetricValue({
  load,
  temp,
  showTemp,
  loading = false
}: {
  load: number | null
  temp?: number | null
  showTemp: boolean
  loading?: boolean
}) {
  if (loading) {
    return (
      <span className="inline-grid w-[5ch] place-items-center">
        <MetricCountSpinner />
      </span>
    )
  }

  const hasTemp = temp !== undefined
  const loadLabel = formatResourceLoad(load)
  const tempLabel = hasTemp ? formatResourceTemp(temp) : loadLabel
  const loadClass = resourceLoadTextClass(load)
  const tempClass = hasTemp ? resourceTempTextClass(temp) : loadClass

  if (!hasTemp || temp === null) {
    return <span className={`inline-grid w-[5ch] place-items-center text-center tabular-nums ${loadClass}`}>{loadLabel}</span>
  }

  return (
    <FlippingMetricValue
      loadLabel={loadLabel}
      tempLabel={tempLabel}
      showTemp={showTemp}
      loadClass={loadClass}
      tempClass={tempClass}
    />
  )
}

function ServerResourcesCaption({
  resources,
  now,
  compact = false
}: {
  resources: ServerResourceStubs
  now: number
  compact?: boolean
}) {
  const showTemp = Math.floor(now / RESOURCE_METRIC_FLIP_MS) % 2 === 1
  const cpuClass = showTemp
    ? resourceTempTextClass(resources.cpuTempC)
    : resourceLoadTextClass(resources.cpuLoad)
  const gpuClass = showTemp
    ? resourceTempTextClass(resources.gpuTempC)
    : resourceLoadTextClass(resources.gpuLoad)
  const ramClass = resourceLoadTextClass(resources.ramLoad)

  return (
    <span className={`inline-flex max-w-full items-center overflow-hidden font-mono text-[12px] leading-4 tracking-tight text-label-tertiary ${compact ? 'whitespace-nowrap' : ''}`}>
      <span className={`inline-flex shrink-0 items-center gap-x-0.5 transition-colors ease-in-out ${cpuClass}`} style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}>
        <span>CPU</span>
        <ResourceMetricValue
          load={resources.cpuLoad}
          temp={resources.cpuTempC}
          showTemp={showTemp}
          loading={resources.loading}
        />
      </span>
      <span className="ml-[3px] mr-1.5 inline-flex shrink-0 items-center justify-center leading-none text-label-tertiary/70" aria-hidden>
        ·
      </span>
      <span className={`inline-flex shrink-0 items-center gap-x-0.5 transition-colors ease-in-out ${gpuClass}`} style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}>
        <span>GPU</span>
        <ResourceMetricValue
          load={resources.gpuLoad}
          temp={resources.gpuTempC}
          showTemp={showTemp}
          loading={resources.loading}
        />
      </span>
      <span className="ml-[3px] mr-1.5 inline-flex shrink-0 items-center justify-center leading-none text-label-tertiary/70" aria-hidden>
        ·
      </span>
      <span className={`inline-flex min-w-0 shrink items-center gap-x-1 ${ramClass}`}>
        <span>RAM</span>
        <ResourceMetricValue
          load={resources.ramLoad}
          showTemp={false}
          loading={resources.loading}
        />
      </span>
    </span>
  )
}



function extractIpFromStreamUrl(url: string | null | undefined): string | null {
  if (!url) return null

  try {
    const host = new URL(url).hostname
    if (isValidIPv4(host)) return host
  } catch {
    // Some RTSP forms are not URL-parseable — fall through to regex.
  }

  const match = url.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  if (!match) return null
  return isValidIPv4(match[0]) ? match[0] : null
}

function buildLocationNameMap(locations?: MonitoringLocation[] | null): Map<number, string> | null {
  if (!locations?.length) return null
  return new Map(locations.map((location) => [location.id, location.localizedName]))
}

function ScrollingLine({
  text,
  className = ''
}: {
  text: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [shiftPx, setShiftPx] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const el = textRef.current
    if (!container || !el) return

    const update = (): void => {
      setShiftPx(Math.max(0, el.scrollWidth - container.clientWidth))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  const durationSec = Math.max(6, Math.round(shiftPx / 18) + 4)

  return (
    <div ref={containerRef} className={`min-h-[1.125rem] overflow-hidden ${className}`}>
      <span
        ref={textRef}
        className="inline-block max-w-none whitespace-nowrap will-change-transform"
        style={
          shiftPx > 0
            ? {
                ['--marquee-shift' as string]: `-${shiftPx}px`,
                animation: `monitoring-marquee ${durationSec}s ease-in-out infinite alternate`
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  )
}

function TruncatedLocationLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = (): void => {
      setTruncated(el.scrollWidth > el.clientWidth)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  return (
    <>
      <span
        ref={ref}
        className="min-w-0 truncate"
        onMouseEnter={() => {
          if (!truncated || !ref.current) return
          const rect = ref.current.getBoundingClientRect()
          setTooltipPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 392)),
            top: rect.bottom + 4
          })
        }}
        onMouseLeave={() => setTooltipPosition(null)}
      >
        {text}
      </span>
      {tooltipPosition
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[10000] max-w-[min(24rem,calc(100vw-1rem))] whitespace-normal rounded-md border border-surface-border/80 bg-surface-raised px-2.5 py-1.5 text-[12px] font-medium leading-snug text-label-primary shadow-sheet"
              style={tooltipPosition}
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </>
  )
}

function formatCameraStreamsTooltip(
  streams: MonitoringCameraStream[],
  onlineIds?: number[] | null,
  locations?: MonitoringLocation[] | null
): ReactNode {
  const sorted = [...streams].sort((a, b) => {
    const aLocationId = a.stream?.locationId
    const bLocationId = b.stream?.locationId
    const aHasLocation = typeof aLocationId === 'number'
    const bHasLocation = typeof bLocationId === 'number'
    if (aHasLocation && bHasLocation && aLocationId !== bLocationId) {
      return aLocationId - bLocationId
    }
    if (aHasLocation !== bHasLocation) return aHasLocation ? -1 : 1
    return a.id - b.id
  })

  const items = sorted.map((stream) => ({
    id: stream.id,
    locationId: typeof stream.stream?.locationId === 'number' ? stream.stream.locationId : null,
    ip: extractIpFromStreamUrl(stream.stream?.url)
  }))

  return formatDeviceStatusesTooltip('Статусы камер', items, onlineIds, locations, true)
}

function formatMegaphoneLocationId(megaphone: MonitoringMegaphone): number | null {
  const locationId = megaphone.locationIds.find((id) => Number.isFinite(id))
  return locationId !== undefined ? locationId : null
}

/** Friendly labels for known guard device types (`config.type`). */
const GUARD_DEVICE_TYPE_LABELS: Record<string, string> = {
  ive50: 'ИВЭ-50',
  del150: 'ДЭЛ-150',
  wits: 'WITS',
  witsml: 'WITSML',
  redis: 'Ригинтел'
}

function formatGuardDeviceTypeLabel(type: string): string {
  const trimmed = type.trim()
  if (!trimmed || trimmed === '—') return '—'
  const mapped = GUARD_DEVICE_TYPE_LABELS[trimmed.toLowerCase()]
  if (mapped) return mapped
  // Keep mixed Cyrillic/digits (ИВЭ-50) as-is; uppercase plain latin tokens.
  if (/[а-яё]/i.test(trimmed)) return trimmed
  return trimmed.toUpperCase()
}



function formatGuardDevicesTooltip(
  devices: MonitoringGuardDevice[],
  onlineIds?: number[] | null
): ReactNode {
  if (devices.length === 0) {
    return (
      <div className="flex cursor-default select-none flex-col gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tint-blue">
          Датчики
        </div>
        <div className="text-[13px] font-medium leading-snug text-label-secondary">
          Источники не найдены
        </div>
      </div>
    )
  }

  const columnCount = devices.length <= 6 ? 1 : devices.length <= 14 ? 2 : 3
  const onlineSet = onlineIds ? new Set(onlineIds) : null
  const sorted = [...devices].sort((a, b) => {
    const typeCmp = formatGuardDeviceTypeLabel(a.type).localeCompare(
      formatGuardDeviceTypeLabel(b.type),
      'ru'
    )
    if (typeCmp !== 0) return typeCmp
    return (a.address ?? '').localeCompare(b.address ?? '', 'ru')
  })

  return (
    <div className="flex cursor-default select-none flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tint-blue">
        Источники датчиков
      </div>
      <ul
        className="m-0 list-none p-0"
        style={{
          columnCount,
          columnGap: '1.25rem'
        }}
      >
        {sorted.map((device) => {
          const isOnline = onlineSet?.has(device.id)
          return (
            <li
              key={device.id}
              className="mb-2 flex min-w-[11rem] max-w-[16rem] break-inside-avoid items-center gap-2 last:mb-0"
            >
              {onlineSet ? (
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    isOnline ? 'bg-emerald-400' : 'bg-red-400'
                  }`}
                  aria-label={isOnline ? 'онлайн' : 'офлайн'}
                />
              ) : null}
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium leading-snug text-label-primary">
                <span className="min-w-0 truncate">{formatGuardDeviceTypeLabel(device.type)}</span>
                <span className="shrink-0 font-normal tabular-nums text-label-tertiary">
                  [{device.address || '—'}]
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatMegaphonesTooltip(
  megaphones: MonitoringMegaphone[],
  onlineIds?: number[] | null,
  locations?: MonitoringLocation[] | null
): ReactNode {
  const sorted = [...megaphones].sort((a, b) => {
    const aLocationId = formatMegaphoneLocationId(a)
    const bLocationId = formatMegaphoneLocationId(b)
    const aHasLocation = aLocationId !== null
    const bHasLocation = bLocationId !== null
    if (aHasLocation && bHasLocation && aLocationId !== bLocationId) {
      return aLocationId - bLocationId
    }
    if (aHasLocation !== bHasLocation) return aHasLocation ? -1 : 1
    return a.id - b.id
  })

  const items = sorted.map((megaphone) => ({
    id: megaphone.id,
    locationId: formatMegaphoneLocationId(megaphone),
    ip: megaphone.address && isValidIPv4(megaphone.address) ? megaphone.address : megaphone.address || null
  }))

  return formatDeviceStatusesTooltip('Статусы рупоров', items, onlineIds, locations, false)
}

function formatDeviceStatusesTooltip(
  title: string,
  items: Array<{ id: number; locationId: number | null; ip: string | null }>,
  onlineIds?: number[] | null,
  locations?: MonitoringLocation[] | null,
  linkIp = false
): ReactNode {
  const columnCount = items.length <= 6 ? 1 : items.length <= 14 ? 2 : 3
  const onlineSet = onlineIds ? new Set(onlineIds) : null
  const locationNames = buildLocationNameMap(locations)
  const locationOccurrence = new Map<string, number>()

  return (
    <div className="flex cursor-default select-none flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tint-blue">{title}</div>
      <ul
        className="m-0 list-none p-0"
        style={{
          columnCount,
          columnGap: '1.25rem'
        }}
      >
        {items.map((item) => {
          const baseLocation =
            item.locationId !== null
              ? locationNames?.get(item.locationId) || String(item.locationId)
              : '—'
          const occurrence = (locationOccurrence.get(baseLocation) ?? 0) + 1
          locationOccurrence.set(baseLocation, occurrence)
          const locationLabel = occurrence === 1 ? baseLocation : `${baseLocation} ${occurrence}`
          const isOnline = onlineSet?.has(item.id)
          const ip = item.ip

          return (
            <li
              key={item.id}
              className="mb-2 flex min-w-[11rem] max-w-[16rem] break-inside-avoid items-center gap-2 last:mb-0"
            >
              {onlineSet ? (
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    isOnline ? 'bg-emerald-400' : 'bg-red-400'
                  }`}
                  aria-label={isOnline ? 'онлайн' : 'офлайн'}
                />
              ) : null}
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium leading-snug text-label-primary">
                <TruncatedLocationLabel text={locationLabel} />
                <span className="shrink-0 font-normal tabular-nums text-label-tertiary">
                  [
                  {ip && linkIp ? (
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 font-inherit tabular-nums text-label-tertiary transition-colors hover:text-label-secondary hover:underline"
                      title={`Открыть http://${ip}`}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void window.api?.openExternal(`http://${ip}`)
                      }}
                    >
                      {ip}
                    </button>
                  ) : (
                    ip || '—'
                  )}
                  ]
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
function EndpointStatus({
  label,
  host,
  result,
  checking,
  kind,
  averageLatencyMs,
  muted = false,
  degraded = false,
  unstable = false,
  serverResources = null,
  serverResourcesNow = 0,
  serverVersion = null,
  serverVersionError = null,
  metricsErrorDetail = null,
  rollingPacketLossPercent,
  compact = false
}: {
  label: string
  host: string
  result: MonitoringPingResult | undefined
  checking: boolean
  kind: 'link' | 'server'
  averageLatencyMs?: number | null
  muted?: boolean
  /** Server reachable but metrics/auth partially unavailable. */
  degraded?: boolean
  /** Link recently flapped online↔offline. */
  unstable?: boolean
  /** Stub/live CPU/GPU/RAM metrics under «Сервер». */
  serverResources?: ServerResourceStubs | null
  serverResourcesNow?: number
  /** OWL.Guard version shown next to «Сервер». */
  serverVersion?: string | null
  serverVersionError?: string | null
  metricsErrorDetail?: string | null
  rollingPacketLossPercent?: number | null
  compact?: boolean
}) {
  const status = result?.status ?? 'unknown'
  const linkLatencyMs =
    kind === 'link' && !muted && status === 'online'
      ? (averageLatencyMs ?? result?.latencyMs ?? null)
      : null
  const showPing = linkLatencyMs !== null && linkLatencyMs !== undefined
  const latestPacketLossPercent =
    kind === 'link' && result?.sentCount && result.sentCount > 0 && result.replyCount !== undefined
      ? Math.round((Math.max(0, result.sentCount - result.replyCount) / result.sentCount) * 100)
      : null
  const packetLossPercent =
    rollingPacketLossPercent === undefined ? latestPacketLossPercent : rollingPacketLossPercent
  const showUnstable =
    kind === 'link' &&
    (result?.replyCount ?? 0) > 0 &&
    (unstable ||
      (packetLossPercent !== null && packetLossPercent >= SIGNIFICANT_PACKET_LOSS_PERCENT))
  const packetLossLabel =
    packetLossPercent !== null && packetLossPercent > 0 ? `${packetLossPercent}\u2009% потерь` : null
  const serverNoReply = kind === 'server' && !muted && status === 'offline'
  const owlGuardFailed = kind === 'server' && !muted && status === 'error'
  const authOrVersionFailed = kind === 'server' && !muted && !!serverVersionError
  // Unstable is styled only on its own subtitle fragment — icon/title/ping keep normal colors.
  const colorWarning =
    owlGuardFailed || authOrVersionFailed || (degraded && status === 'online')
  // Errors go under «Сервер» (same slot as load/temps); only a healthy version stays beside the title.
  const serverErrorDetail =
    kind === 'server' && !muted
      ? serverNoReply
        ? 'нет ответа'
        : owlGuardFailed
          ? OWL_GUARD_UNREACHABLE
          : serverVersionError
            ? serverVersionError
            : degraded
              ? metricsErrorDetail || METRICS_UNAVAILABLE
              : null
      : null
  const versionLabel =
    kind === 'server' && !muted && status === 'online' && serverVersion && !serverErrorDetail
      ? formatServerVersionLabel(serverVersion)
      : null
  const showResources =
    kind === 'server' && !muted && status === 'online' && !!serverResources && !serverErrorDetail
  // Visible line: ping / connection text, with sticky flapping note when relevant.
  const linkDetailBase = showPing
    ? `${formatLatency(linkLatencyMs)}${packetLossLabel ? ` · ${packetLossLabel}` : ''}`
    : linkConnectionText(status, checking)
  const detail =
    kind === 'link'
      ? linkDetailBase
      : serverErrorDetail
        ? serverErrorDetail
        : showResources
          ? null
          : host
  const statusClass = muted
    ? 'text-label-tertiary'
    : colorWarning || serverNoReply
      ? serverNoReply
        ? statusClasses('offline', checking)
        : 'text-amber-300'
      : statusClasses(status, checking, degraded)
  const detailClass = muted
    ? 'text-label-tertiary'
    : kind === 'link' && showPing
      ? latencyTextClasses(linkLatencyMs)
      : kind === 'link'
        ? checking || status === 'unknown' || status === 'offline'
          ? 'text-label-tertiary'
          : colorWarning
            ? 'text-amber-300'
            : statusClass
        : serverErrorDetail || serverNoReply
          ? serverNoReply
            ? statusClass
            : 'text-amber-300'
          : 'text-label-tertiary'
  return (
    <div className="min-h-[2.5rem] min-w-0 overflow-hidden">
      <div className={`flex min-w-0 gap-3 ${compact ? 'items-center' : 'items-start'}`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center ${statusClass}`}>
          <EndpointIcon kind={kind} />
        </span>
        <div className={`min-w-0 flex-1 overflow-hidden ${compact ? '' : 'pt-0.5'}`}>
          <div className={`m-0 flex min-w-0 items-baseline gap-1.5 text-[14px] leading-5 font-medium ${statusClass}`}>
            <span className="truncate">{label}</span>
            {showUnstable && (
              <ScrollingLine
                text={LINK_UNSTABLE}
                className="min-w-0 flex-1 text-[11px] font-normal leading-[1.125rem] text-amber-300"
              />
            )}
            {versionLabel && (
              <ScrollingLine
                text={versionLabel}
                className="min-w-0 flex-1 text-[11px] font-normal leading-[1.125rem] text-label-tertiary"
              />
            )}
          </div>
          {showResources && serverResources ? (
            <div className="mt-0.5 min-h-4">
              <ServerResourcesCaption resources={serverResources} now={serverResourcesNow} compact={compact} />
            </div>
          ) : detail ? (
            <ScrollingLine
              text={detail}
              className={`mt-0.5 text-[13px] leading-[1.125rem] ${
                showPing ? `font-mono ${detailClass}` : detailClass
              }`}
            />
          ) : (
            <div className="mt-0.5 min-h-4" />
          )}
        </div>
      </div>
    </div>
  )
}

export function MonitoringObjectCard({
  object,
  results,
  latencyHistory,
  linkPacketLossPercent,
  linkUnstable = false,
  checkingLink,
  checkingServer,
  serverVersion,
  serverVersionError,
  serverResources = null,
  camerasPreviewLoading,
  megaphonesStatusLoading,
  camerasMetricFailed,
  megaphonesMetricFailed,
  sensorsRefreshLoading = false,
  now,
  onEdit,
  onRefreshMetric,
  compact = false,
  debug = false
}: {
  object: MonitoringObject
  results: ResultMap
  latencyHistory: LatencyHistoryMap
  linkPacketLossPercent?: number | null
  /** Sticky flapping flag — shown for both online and offline until recovery. */
  linkUnstable?: boolean
  checkingLink: boolean
  checkingServer: boolean
  serverVersion: string | null
  serverVersionError: string | null
  serverResources?: ServerResourceStubs | null
  camerasPreviewLoading: boolean
  megaphonesStatusLoading: boolean
  camerasMetricFailed: boolean
  megaphonesMetricFailed: boolean
  sensorsRefreshLoading?: boolean
  now: number
  onEdit?: (id: string) => void
  onRefreshMetric?: (object: MonitoringObject, kind: MonitoringMetricKind) => void
  compact?: boolean
  debug?: boolean
}) {
  const linkResult = results[targetId(object.id, 'link')]
  const serverResult = results[targetId(object.id, 'server')]
  const linkAverageLatencyMs = averageLatency(latencyHistory[targetId(object.id, 'link')])
  const linkOnline = isOnline(linkResult)
  const serverOnline = linkOnline && isOnline(serverResult)
  const camerasTotal = object.camerasTotal ?? object.cameraStreams?.length ?? 0
  const hasCameraOnline = object.camerasOnline !== undefined
  const awaitingFirstCameraPreview =
    linkOnline && serverOnline && camerasTotal > 0 && !hasCameraOnline && camerasPreviewLoading
  const camerasFailed =
    linkOnline &&
    serverOnline &&
    camerasTotal > 0 &&
    !hasCameraOnline &&
    !camerasPreviewLoading &&
    camerasMetricFailed
  const megaphonesTotal = object.megaphonesTotal ?? object.megaphones?.length ?? 0
  const hasMegaphoneOnline = object.megaphonesOnline !== undefined
  const awaitingFirstMegaphoneStatus =
    linkOnline && serverOnline && megaphonesTotal > 0 && !hasMegaphoneOnline && megaphonesStatusLoading
  const megaphonesFailed =
    linkOnline &&
    serverOnline &&
    megaphonesTotal > 0 &&
    !hasMegaphoneOnline &&
    !megaphonesStatusLoading &&
    megaphonesMetricFailed
  const metricsDegraded =
    serverOnline && (camerasFailed || megaphonesFailed || Boolean(serverVersionError))
  const metricsErrorDetail =
    camerasFailed && megaphonesFailed
      ? 'не удалось получить данные камер и рупоров'
      : camerasFailed
        ? 'не удалось получить данные камер'
        : megaphonesFailed
          ? 'не удалось получить данные рупоров'
          : null
  const cameraStreams = object.cameraStreams
  const camerasOnlineIdsForTooltip =
    object.camerasOnlineIds !== undefined &&
    object.camerasOnline !== undefined &&
    object.camerasOnlineIds.length === object.camerasOnline
      ? object.camerasOnlineIds
      : null
  const camerasHoverTooltip =
    serverOnline && camerasTotal > 0 && cameraStreams && cameraStreams.length > 0
      ? formatCameraStreamsTooltip(cameraStreams, camerasOnlineIdsForTooltip, object.locations)
      : null
  const megaphonesList = object.megaphones
  const megaphonesOnlineIdsForTooltip =
    object.megaphonesOnlineIds !== undefined &&
    object.megaphonesOnline !== undefined &&
    object.megaphonesOnlineIds.length === object.megaphonesOnline
      ? object.megaphonesOnlineIds
      : null
  const megaphonesHoverTooltip =
    serverOnline && megaphonesTotal > 0 && megaphonesList && megaphonesList.length > 0
      ? formatMegaphonesTooltip(megaphonesList, megaphonesOnlineIdsForTooltip, object.locations)
      : null
  const guardDevices = object.guardDevices
  const devicesOnlineIdsForTooltip =
    object.devicesOnlineIds !== undefined &&
    object.devicesOnline !== undefined &&
    object.devicesOnlineIds.length === object.devicesOnline
      ? object.devicesOnlineIds
      : null
  const sensorsHoverTooltip =
    serverOnline && guardDevices !== undefined
      ? formatGuardDevicesTooltip(guardDevices, devicesOnlineIdsForTooltip)
      : null
  const resolvedSensorsStatus = resolveSensorsIndicatorStatus(
    guardDevices,
    object.devicesOnline,
    linkOnline,
    serverOnline
  )
  const sensorsDeviceLabels = listSensorsDeviceLabels(
    guardDevices,
    devicesOnlineIdsForTooltip,
    linkOnline,
    serverOnline
  )
  const primaryLocationName =
    object.primaryLocationName?.trim() || resolvePrimaryLocationName(object.locations) || null

  return (
    <Card
      compact={compact}
      title={
        <span className={`flex min-w-0 ${compact ? 'items-center gap-2' : 'flex-col gap-0.5'}`}>
          <span className="flex min-w-0 items-center gap-2">
            <ObjectCodeTitle code={object.code} />
            {debug && (
              <span className="rounded-md bg-amber-300/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-amber-300">
                debug
              </span>
            )}
          </span>
          <ScrollingLine
            text={primaryLocationName || '\u00A0'}
            className={`max-w-full text-[12px] font-medium leading-[1.125rem] normal-case tracking-normal text-label-tertiary ${
              compact ? 'min-w-0 flex-1' : ''
            }`}
          />
        </span>
      }
      action={
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              void window.api?.openExternal(`http://${object.serverHost}`)
            }}
            className={`flex shrink-0 items-center justify-center rounded-lg text-label-tertiary opacity-0 transition-[opacity,color] duration-150 hover:bg-white/[0.05] hover:text-label-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45 ${
              compact ? 'h-6 w-6' : 'h-8 w-8'
            }`}
            aria-label="Открыть сервер в браузере"
          >
            <OpenExternalIcon />
          </button>
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(object.id)}
              className={`flex shrink-0 items-center justify-center rounded-lg text-label-tertiary opacity-0 transition-[opacity,color] duration-150 hover:bg-white/[0.05] hover:text-label-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45 ${
                compact ? 'h-6 w-6' : 'h-8 w-8'
              }`}
              aria-label="Настройки объекта"
            >
              <CogIcon />
            </button>
          ) : null}
        </div>
      }
    >
      <div
        className={`grid gap-4 ${
          compact
            ? 'lg:grid-cols-[15rem_minmax(0,1fr)_18.625rem] lg:items-center'
            : 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch sm:gap-5'
        }`}
      >
        <div className={`grid min-w-0 gap-3 overflow-hidden ${compact ? 'lg:contents' : ''}`}>
          <EndpointStatus
            label="Связь"
            host={object.linkHost}
            result={linkResult}
            checking={checkingLink}
            kind="link"
            averageLatencyMs={linkAverageLatencyMs}
            rollingPacketLossPercent={linkPacketLossPercent}
            unstable={linkUnstable}
          />
          <EndpointStatus
            label="Сервер"
            host={object.serverHost}
            result={serverResult}
            checking={checkingServer}
            kind="server"
            muted={!linkOnline}
            degraded={metricsDegraded}
            serverResources={serverOnline ? serverResources : null}
            serverResourcesNow={now}
            serverVersion={serverOnline ? serverVersion : null}
            serverVersionError={linkOnline ? serverVersionError : null}
            metricsErrorDetail={metricsErrorDetail}
            compact={compact}
          />
        </div>

        <div
          className={`flex h-full shrink-0 flex-col border-surface-border/70 ${
            compact
              ? 'border-t pt-3 lg:min-w-[7rem] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0'
              : 'border-t pt-3 sm:min-w-[7rem] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0'
          }`}
        >
          <div
            className={
              compact
                ? 'mx-auto flex h-full min-h-0 w-fit flex-col gap-y-1 lg:mx-0 lg:grid lg:w-full lg:grid-cols-3 lg:items-center lg:gap-x-2'
                : 'mx-auto flex h-full min-h-0 w-fit flex-col justify-between gap-y-1 sm:mx-0'
            }
          >
            <MonitoringMetricStatus
              label="Камеры"
              online={hasCameraOnline ? object.camerasOnline! : null}
              total={camerasTotal}
              icon={<CamerasIcon />}
              muted={!serverOnline && !awaitingFirstCameraPreview}
              onlineUnknown={!serverOnline || (!hasCameraOnline && !awaitingFirstCameraPreview && !camerasFailed)}
              loading={awaitingFirstCameraPreview}
              failed={camerasFailed}
              hoverTooltip={camerasHoverTooltip}
              onRefresh={onRefreshMetric ? () => onRefreshMetric(object, 'cameras') : undefined}
              refreshing={camerasPreviewLoading}
            />
            <MonitoringMetricStatus
              label="Рупора"
              online={hasMegaphoneOnline ? object.megaphonesOnline! : null}
              total={megaphonesTotal}
              icon={<HornsIcon />}
              muted={!serverOnline && !awaitingFirstMegaphoneStatus}
              onlineUnknown={
                !serverOnline || (!hasMegaphoneOnline && !awaitingFirstMegaphoneStatus && !megaphonesFailed)
              }
              loading={awaitingFirstMegaphoneStatus}
              failed={megaphonesFailed}
              hoverTooltip={megaphonesHoverTooltip}
              onRefresh={onRefreshMetric ? () => onRefreshMetric(object, 'megaphones') : undefined}
              refreshing={megaphonesStatusLoading}
            />
            <MonitoringIndicatorStatus
              entries={sensorsDeviceLabels}
              status={resolvedSensorsStatus}
              icon={<SensorsIcon />}
              now={now}
              hoverTooltip={sensorsHoverTooltip}
              onRefresh={onRefreshMetric ? () => onRefreshMetric(object, 'sensors') : undefined}
              refreshing={sensorsRefreshLoading}
            />
          </div>
        </div>
      </div>
    </Card>
  )
}

function mockGuardDevice(id: number, type: string, address: string): MonitoringGuardDevice {
  return {
    id,
    type,
    address,
    logicalAddress: 0,
    useRtuOverTcp: false,
    startRegister: 0,
    numRegisters: 64,
    login: '',
    password: '',
    wellUid: '',
    wellBoreUid: ''
  }
}

function mockPingResult(
  id: string,
  host: string,
  status: MonitoringPingStatus,
  latencyMs: number | null = null
): MonitoringPingResult {
  return {
    id,
    host,
    label: 'debug',
    status,
    latencyMs,
    checkedAt: Date.now()
  }
}

/** Temporary sample card for the new layout — remove after QA. */
export function MonitoringDebugObjectCard({ now, compact = false }: { now: number; compact?: boolean }) {
  const object: MonitoringObject = {
    id: 'debug-preview',
    code: 'owl9999',
    linkHost: '10.12.34.1',
    serverHost: '10.12.34.252',
    serverLogin: DEFAULT_SERVER_LOGIN,
    serverPassword: '',
    serverVersion: '2.14.3',
    camerasTotal: 3,
    camerasOnline: 2,
    camerasOnlineIds: [10, 12],
    locations: [
      { id: 100, localizedName: 'Объект Север', parentId: null },
      { id: 102, localizedName: 'Лебёдка', parentId: 100 },
      { id: 103, localizedName: 'Кран', parentId: 100 }
    ],
    primaryLocationName: 'Объект Север',
    megaphonesTotal: 2,
    megaphonesOnline: 1,
    megaphonesOnlineIds: [11],
    megaphones: [
      { id: 11, address: '10.67.64.45', locationIds: [102] },
      { id: 12, address: '10.67.64.46', locationIds: [103] }
    ],
    guardDevices: [
      mockGuardDevice(0, 'ive50', '192.168.1.10:502'),
      mockGuardDevice(1, 'del150', '192.168.1.11:502'),
      mockGuardDevice(2, 'wits', '192.168.1.2:12000'),
      mockGuardDevice(3, 'witsml', '192.168.1.3:80'),
      mockGuardDevice(4, 'redis', '192.168.1.4:6379')
    ],
    devicesOnline: 3,
    devicesOnlineIds: [0, 2, 4],
    cameraStreams: [
      {
        id: 10,
        expectedImageSize: { width: 1920, height: 1080 },
        stream: { url: 'rtsp://admin:admin@10.67.64.10/live/main', locationId: 102 }
      },
      {
        id: 11,
        expectedImageSize: { width: 1280, height: 720 },
        stream: { url: 'rtsp://10.67.64.11:554/stream1', locationId: 103 }
      },
      {
        id: 12,
        expectedImageSize: { width: 1920, height: 1080 },
        stream: { url: 'rtsps://user:pass@10.67.64.12/live', locationId: null }
      }
    ]
  }
  const linkId = targetId(object.id, 'link')
  const serverId = targetId(object.id, 'server')
  const results: ResultMap = {
    [linkId]: {
      ...mockPingResult(linkId, object.linkHost, 'online', 28),
      replyCount: 3,
      sentCount: 4
    },
    [serverId]: mockPingResult(serverId, object.serverHost, 'online', 41)
  }
  const latencyHistory: LatencyHistoryMap = {
    [linkId]: [24, 28, 31, 27, 29]
  }
  const serverResources: ServerResourceStubs = {
    cpuLoad: 48,
    cpuTempC: 62,
    gpuLoad: 91,
    gpuTempC: 88,
    ramLoad: 42,
    uptimeDays: 3
  }

  return (
    <MonitoringObjectCard
      object={object}
      results={results}
      latencyHistory={latencyHistory}
      linkPacketLossPercent={25}
      linkUnstable
      checkingLink={false}
      checkingServer={false}
      serverVersion={object.serverVersion ?? null}
      serverVersionError={null}
      serverResources={serverResources}
      camerasPreviewLoading={false}
      megaphonesStatusLoading={false}
      camerasMetricFailed={false}
      megaphonesMetricFailed={false}
      now={now}
      compact={compact}
      debug
    />
  )
}
