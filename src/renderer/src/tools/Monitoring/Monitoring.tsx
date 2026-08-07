import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { ArrowPathIcon, XMarkIcon } from '../../components/Icons'
import type {
  MonitoringCameraStream,
  MonitoringGuardDevice,
  MonitoringHttpTarget,
  MonitoringLocation,
  MonitoringMegaphone,
  MonitoringPingResult,
  MonitoringPingStatus,
  MonitoringPingTarget
} from '@shared/api'
import cameraIconUrl from '../../assets/monitoring/camera-icon.png'
import hornIconUrl from '../../assets/monitoring/horn-icon.png'
import {
  DEFAULT_SERVER_LOGIN,
  buildMonitoringObject,
  compareMonitoringObjectsByDigits,
  isValidIPv4,
  joinIPv4Octets,
  loadMonitoringSnapshot,
  normalizePastedIPv4,
  objectDigits,
  parseIPv4Octets,
  parseMonitoringObject,
  resolvePrimaryLocationName,
  sanitizeMonitoringDigits,
  sanitizeIPv4OctetInput,
  saveMonitoringSnapshot,
  type IPv4Octets,
  type MonitoringObject
} from './monitoringStorage'
import {
  MONITORING_PREVIEW_INTERVAL_MS,
  MONITORING_SERVER_INTERVAL_MS,
  MONITORING_STREAMS_REFRESH_MS,
  adaptiveIntervalMs,
  appendLinkStatusSample,
  createProbeSchedule,
  failureBackoffMs,
  linkBatchLimit,
  linkFailureBackoffMs,
  previewBatchLimit,
  resolveLinkUnstable,
  schedulerTickMs,
  serverBatchLimit,
  successDelayMs,
  updateSignalTier,
  type LinkStatusSample,
  type ObjectProbeSchedule
} from './monitoringSchedule'

type ResultMap = Record<string, MonitoringPingResult>
type LatencyHistoryMap = Record<string, number[]>
type LinkStatusHistoryMap = Record<string, LinkStatusSample[]>
type VersionErrorMap = Record<string, string>
type IdFlagMap = Record<string, boolean>
type EditorState = { mode: 'add' | 'edit'; objectId?: string } | null
type MonitoringMetricKind = 'cameras' | 'megaphones' | 'sensors'

const LINK_LATENCY_HISTORY_LIMIT = 10
const OWL_GUARD_UNREACHABLE = 'не удалось подключиться к OWL.Guard'
const METRICS_UNAVAILABLE = 'метрики недоступны'
const LINK_UNSTABLE = '[соединение нестабильно]'

function versionFetchKey(object: MonitoringObject): string {
  return `${object.id}|${object.serverHost}|${object.serverLogin}|${object.serverPassword}`
}

function formatServerVersionLabel(version: string): string {
  const trimmed = version.trim()
  if (!trimmed) return ''
  const label = /^версия\b/i.test(trimmed) ? trimmed : `Версия ${trimmed}`
  return `[${label}]`
}

function isCredentialAuthError(message: string | undefined): boolean {
  const lower = (message ?? '').toLowerCase()
  return (
    lower.includes('invalid user credentials') ||
    lower.includes('invalid_grant') ||
    lower.includes('unauthorized_client') ||
    lower.includes('unauthorized') ||
    /^http\s*401\b/i.test(message ?? '') ||
    lower.includes('account disabled') ||
    lower.includes('user disabled') ||
    lower.includes('account is not fully set up')
  )
}

function localizeMonitoringError(message: string | undefined): string {
  const raw = (message ?? '').trim()
  if (!raw) return 'Не удалось получить версию'

  const lower = raw.toLowerCase()

  if (lower.includes('invalid user credentials') || lower.includes('invalid_grant')) {
    return 'Неверный логин или пароль'
  }
  if (lower.includes('account is not fully set up')) {
    return 'Учётная запись не настроена'
  }
  if (lower.includes('account disabled') || lower.includes('user disabled')) {
    return 'Учётная запись отключена'
  }
  if (lower.includes('unauthorized_client')) {
    return 'Клиент не может использовать этот способ входа'
  }
  if (lower.includes('invalid version request')) {
    return 'Некорректные данные для авторизации'
  }
  if (lower.includes('invalid token response') || lower.includes('missing access_token')) {
    return 'Сервер вернул некорректный токен'
  }
  if (lower.includes('empty version response')) {
    return 'Пустой ответ версии'
  }
  if (lower.includes('api недоступен')) {
    return raw
  }
  if (lower.includes('укажите пароль')) {
    return raw
  }
  if (lower.includes('aborted') || lower.includes('timeout') || lower.includes('timed out')) {
    return 'Превышено время ожидания'
  }
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('econnrefused')) {
    return 'Нет связи с сервером авторизации'
  }
  if (/^http\s*401\b/i.test(raw) || lower.includes('unauthorized')) {
    return 'Нет доступа (ошибка авторизации)'
  }
  if (/^http\s*403\b/i.test(raw)) {
    return 'Доступ запрещён'
  }
  if (/^http\s*404\b/i.test(raw)) {
    return 'Эндпоинт версии не найден'
  }
  if (/^http\s*\d+/i.test(raw)) {
    return `Ошибка сервера (${raw.replace(/^http\s*/i, 'HTTP ')})`
  }

  return raw
}

function targetId(objectId: string, kind: 'link' | 'server'): string {
  return `${objectId}:${kind}`
}

function isOnline(result: MonitoringPingResult | undefined): boolean {
  return (result?.status ?? 'unknown') === 'online'
}

function clearCachedMetricCounts(object: MonitoringObject): MonitoringObject {
  const next = { ...object }
  delete next.camerasOnline
  delete next.camerasOnlineIds
  delete next.megaphonesOnline
  delete next.megaphonesOnlineIds
  return next
}

/** Objects that still need a first link and/or server result. */
function needsProbeCatchUp(objects: MonitoringObject[], results: ResultMap): boolean {
  for (const object of objects) {
    const link = results[targetId(object.id, 'link')]
    if (!link) return true
    if (isOnline(link) && !results[targetId(object.id, 'server')]) return true
  }
  return false
}

/** Objects online but still waiting for the first camera/megaphone/device metric. */
function needsMetricsCatchUp(objects: MonitoringObject[], results: ResultMap): boolean {
  for (const object of objects) {
    if (!isOnline(results[targetId(object.id, 'link')])) continue
    if (!isOnline(results[targetId(object.id, 'server')])) continue
    const camerasTotal = object.camerasTotal ?? object.cameraStreams?.length ?? 0
    if (camerasTotal > 0 && object.camerasOnline === undefined) return true
    if ((object.megaphonesTotal ?? object.megaphones?.length ?? 0) > 0 && object.megaphonesOnline === undefined)
      return true
    if ((object.guardDevices?.length ?? 0) > 0 && object.devicesOnline === undefined) return true
  }
  return false
}

function averageLatency(history: number[] | undefined): number | null {
  if (!history?.length) return null
  return history.reduce((sum, value) => sum + value, 0) / history.length
}

function clearIdFlag(prev: IdFlagMap, id: string): IdFlagMap {
  if (!(id in prev)) return prev
  const next = { ...prev }
  delete next[id]
  return next
}

function setIdFlags(ids: string[], value: boolean): IdFlagMap {
  const next: IdFlagMap = {}
  ids.forEach((id) => {
    next[id] = value
  })
  return next
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

function statusClasses(
  status: MonitoringPingStatus | 'unknown',
  checking: boolean,
  degraded = false
): string {
  if (checking && status === 'unknown') return 'text-tint-blue'
  if (degraded && status === 'online') return 'text-amber-300'
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

function Card({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="group rounded-2xl border border-surface-border bg-surface-card shadow-sheet overflow-hidden">
      <header className="flex items-start justify-between gap-4 px-5 py-4">
        <h2 className="m-0 min-w-0 text-[12px] font-semibold uppercase tracking-[0.09em] text-tint-blue">{title}</h2>
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

type SensorIndicatorStatus = 'ok' | 'warning' | 'error' | 'unknown' | 'muted'

function sensorStatusClass(status: SensorIndicatorStatus): string {
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
function resolveSensorsIndicatorStatus(
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

function ratioStatusClass(online: number, total: number): string {
  if (total <= 0) return 'text-label-tertiary/50'
  if (online <= 0) return 'text-red-400'
  if (online < total) return 'text-amber-300'
  return 'text-emerald-400'
}

/** Stub host metrics until OWL.Guard exposes real CPU/GPU/RAM/uptime. */
type ServerResourceStubs = {
  cpuLoad: number | null
  cpuTempC: number | null
  gpuLoad: number | null
  gpuTempC: number | null
  ramLoad: number | null
  /** Uptime in whole days. */
  uptimeDays: number | null
}

const EMPTY_SERVER_RESOURCES: ServerResourceStubs = {
  cpuLoad: null,
  cpuTempC: null,
  gpuLoad: null,
  gpuTempC: null,
  ramLoad: null,
  uptimeDays: null
}

const DEBUG_SERVER_RESOURCES: ServerResourceStubs = {
  cpuLoad: 48,
  cpuTempC: 62,
  gpuLoad: 91,
  gpuTempC: 88,
  ramLoad: 42,
  uptimeDays: 3
}

/** Alternate CPU/GPU load ↔ temperature in the server caption. */
const RESOURCE_METRIC_FLIP_MS = 5000
const RESOURCE_METRIC_FADE_MS = 700
const RESOURCE_UNAVAILABLE = 'Н/Д'

function formatResourceLoad(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? RESOURCE_UNAVAILABLE : `${Math.round(value)}%`
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
  showTemp
}: {
  load: number | null
  temp?: number | null
  showTemp: boolean
}) {
  const hasTemp = temp !== undefined
  const loadLabel = formatResourceLoad(load)
  const tempLabel = hasTemp ? formatResourceTemp(temp) : loadLabel
  const loadClass = resourceLoadTextClass(load)
  const tempClass = hasTemp ? resourceTempTextClass(temp) : loadClass

  if (!hasTemp || (load === null && temp === null)) {
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

function ServerResourcesCaption({ resources, now }: { resources: ServerResourceStubs; now: number }) {
  const showTemp = Math.floor(now / RESOURCE_METRIC_FLIP_MS) % 2 === 1
  const cpuClass = showTemp
    ? resourceTempTextClass(resources.cpuTempC)
    : resourceLoadTextClass(resources.cpuLoad)
  const gpuClass = showTemp
    ? resourceTempTextClass(resources.gpuTempC)
    : resourceLoadTextClass(resources.gpuLoad)
  const ramClass = resourceLoadTextClass(resources.ramLoad)

  return (
    <span className="inline-flex max-w-full items-center gap-x-1.5 overflow-hidden font-mono text-[12px] leading-4 tracking-tight text-label-tertiary">
      <span className={`inline-flex shrink-0 items-center gap-x-1 transition-colors ease-in-out ${cpuClass}`} style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}>
        <span>CPU</span>
        <ResourceMetricValue load={resources.cpuLoad} temp={resources.cpuTempC} showTemp={showTemp} />
      </span>
      <span className="inline-flex shrink-0 items-center justify-center leading-none text-label-tertiary/70" aria-hidden>
        ·
      </span>
      <span className={`inline-flex shrink-0 items-center gap-x-1 transition-colors ease-in-out ${gpuClass}`} style={{ transitionDuration: `${RESOURCE_METRIC_FADE_MS}ms` }}>
        <span>GPU</span>
        <ResourceMetricValue load={resources.gpuLoad} temp={resources.gpuTempC} showTemp={showTemp} />
      </span>
      <span className="inline-flex shrink-0 items-center justify-center leading-none text-label-tertiary/70" aria-hidden>
        ·
      </span>
      <span className={`inline-flex min-w-0 shrink items-center gap-x-1 ${ramClass}`}>
        <span>RAM</span>
        <ResourceMetricValue load={resources.ramLoad} showTemp={false} />
      </span>
    </span>
  )
}

function MetricCountSpinner() {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-label-tertiary/40 border-t-tint-blue"
      aria-hidden
    />
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

function sameNumberList(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  const left = [...a].sort((x, y) => x - y)
  const right = [...b].sort((x, y) => x - y)
  return left.every((value, index) => value === right[index])
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
                animation: `monitoring-marquee ${durationSec}s linear infinite`
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
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

type SensorDeviceLabel = {
  id: string
  label: string
  status: SensorIndicatorStatus
}

/** Per-device labels for the sensors row (cycled when several; color = that device). */
function listSensorsDeviceLabels(
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

function FlippingSensorLabels({ entries, now }: { entries: SensorDeviceLabel[]; now: number }) {
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
                <span className="min-w-0 truncate">{locationLabel}</span>
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

type MetricTooltipPlacement = {
  left: number
  top: number
  maxHeight: number | undefined
  side: 'above' | 'below'
  arrowLeft: number
}

function MetricHoverTooltip({
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

function ObjectMetricStatus({
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
        hovered && hoverTooltip
          ? 'bg-white/[0.035]'
          : 'bg-transparent'
      }`}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleCloseTooltip}
      aria-label={`${label}: ${onlineLabel}/${total}`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${statusClass}`}>
        {icon}
      </span>
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

function ObjectIndicatorStatus({
  entries,
  status,
  icon,
  now,
  hoverTooltip = null,
  onRefresh,
  refreshing = false
}: {
  entries: SensorDeviceLabel[]
  status: SensorIndicatorStatus
  icon: ReactNode
  now: number
  hoverTooltip?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const [hovered, setHovered] = useState(false)
  const iconStatusClass = sensorStatusClass(status)
  const activeIndex = entries.length > 0 ? Math.floor(now / RESOURCE_METRIC_FLIP_MS) % entries.length : 0
  const activeEntry = entries[activeIndex]
  const ariaLabel = activeEntry?.label || 'Датчики'

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
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${iconStatusClass}`} aria-label={ariaLabel}>
        {icon}
      </span>
      <span className="m-0 flex h-5 min-w-0 items-center justify-center font-mono text-[12px] font-semibold leading-5 tracking-tight">
        <FlippingSensorLabels entries={entries} now={now} />
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

const ipv4FieldClass =
  'flex h-[42px] w-full items-center rounded-xl border border-surface-border/90 bg-surface-input/80 px-2 font-mono text-[14px] text-label-primary shadow-chromeTop transition-[box-shadow,border-color] focus-within:border-transparent focus-within:ring-2 focus-within:ring-tint-blue/50'

const textFieldClass =
  'h-[42px] w-full rounded-xl border border-surface-border/90 bg-surface-input/80 px-3 text-[14px] text-label-primary shadow-chromeTop transition-[box-shadow,border-color] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-tint-blue/50'

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
  const [serverLogin, setServerLogin] = useState(DEFAULT_SERVER_LOGIN)
  const [serverPassword, setServerPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) {
      setDigits('')
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
      setLinkHost(object.linkHost)
      setServerHost(object.serverHost)
      setServerLogin(object.serverLogin || DEFAULT_SERVER_LOGIN)
      setServerPassword(object.serverPassword)
    } else {
      setDigits('')
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
      next = buildMonitoringObject(objectDigits(object), linkHost, serverHost, serverLogin, serverPassword)
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

      next = buildMonitoringObject(digits, linkHost, serverHost, serverLogin, serverPassword)
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
  muted = false,
  degraded = false,
  unstable = false,
  serverResources = null,
  serverResourcesNow = 0,
  serverVersion = null,
  serverVersionError = null
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
}) {
  const status = result?.status ?? 'unknown'
  const linkLatencyMs =
    kind === 'link' && !muted && status === 'online'
      ? (averageLatencyMs ?? result?.latencyMs ?? null)
      : null
  const showPing = linkLatencyMs !== null && linkLatencyMs !== undefined
  const showUnstable = kind === 'link' && unstable
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
              ? METRICS_UNAVAILABLE
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
    ? formatLatency(linkLatencyMs)
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
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center ${statusClass}`}>
          <EndpointIcon kind={kind} />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden pt-0.5">
          <div className={`m-0 flex min-w-0 items-baseline gap-1.5 text-[14px] leading-5 font-medium ${statusClass}`}>
            <span className="truncate">{label}</span>
            {showUnstable && (
              <span className="min-w-0 flex-1 truncate text-[11px] font-normal leading-[1.125rem] text-amber-300">
                {LINK_UNSTABLE}
              </span>
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
              <ServerResourcesCaption resources={serverResources} now={serverResourcesNow} />
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

function MonitoringObjectCard({
  object,
  results,
  latencyHistory,
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
  debug = false
}: {
  object: MonitoringObject
  results: ResultMap
  latencyHistory: LatencyHistoryMap
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
      title={
        <span className="flex min-w-0 flex-col gap-0.5">
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
            className="max-w-full text-[12px] font-medium leading-[1.125rem] normal-case tracking-normal text-label-tertiary"
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-label-tertiary opacity-0 transition-[opacity,color] duration-150 hover:bg-white/[0.05] hover:text-label-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
            aria-label="Открыть сервер в браузере"
          >
            <OpenExternalIcon />
          </button>
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(object.id)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-label-tertiary opacity-0 transition-[opacity,color] duration-150 hover:bg-white/[0.05] hover:text-label-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
              aria-label="Настройки объекта"
            >
              <CogIcon />
            </button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch sm:gap-5">
        <div className="grid min-w-0 gap-3 overflow-hidden">
          <EndpointStatus
            label="Связь"
            host={object.linkHost}
            result={linkResult}
            checking={checkingLink}
            kind="link"
            averageLatencyMs={linkAverageLatencyMs}
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
          />
        </div>

        <div className="flex h-full shrink-0 flex-col border-t border-surface-border/70 pt-3 sm:min-w-[7rem] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <div className="mx-auto flex h-full min-h-0 w-fit flex-col justify-between gap-y-1 sm:mx-0">
            <ObjectMetricStatus
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
            <ObjectMetricStatus
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
            <ObjectIndicatorStatus
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
function MonitoringDebugObjectCard({ now }: { now: number }) {
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
    [linkId]: mockPingResult(linkId, object.linkHost, 'online', 28),
    [serverId]: mockPingResult(serverId, object.serverHost, 'online', 41)
  }
  const latencyHistory: LatencyHistoryMap = {
    [linkId]: [24, 28, 31, 27, 29]
  }

  return (
    <MonitoringObjectCard
      object={object}
      results={results}
      latencyHistory={latencyHistory}
      checkingLink={false}
      checkingServer={false}
      serverVersion={object.serverVersion ?? null}
      serverVersionError={null}
      serverResources={DEBUG_SERVER_RESOURCES}
      camerasPreviewLoading={false}
      megaphonesStatusLoading={false}
      camerasMetricFailed={false}
      megaphonesMetricFailed={false}
      now={now}
      debug
    />
  )
}

export function Monitoring() {
  const [snapshot, setSnapshot] = useState(() => {
    const loaded = loadMonitoringSnapshot()
    return { objects: loaded.objects.map(clearCachedMetricCounts) }
  })
  const [editor, setEditor] = useState<EditorState>(null)
  const [results, setResults] = useState<ResultMap>({})
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistoryMap>({})
  const [linkStatusHistory, setLinkStatusHistory] = useState<LinkStatusHistoryMap>({})
  const [linkUnstableFlags, setLinkUnstableFlags] = useState<IdFlagMap>({})
  const [serverVersionErrors, setServerVersionErrors] = useState<VersionErrorMap>({})
  const [camerasPreviewLoading, setCamerasPreviewLoading] = useState<IdFlagMap>({})
  const [megaphonesStatusLoading, setMegaphonesStatusLoading] = useState<IdFlagMap>({})
  const [camerasMetricFailed, setCamerasMetricFailed] = useState<IdFlagMap>({})
  const [megaphonesMetricFailed, setMegaphonesMetricFailed] = useState<IdFlagMap>({})
  const [sensorsRefreshLoading, setSensorsRefreshLoading] = useState<IdFlagMap>({})
  const [linkChecking, setLinkChecking] = useState<IdFlagMap>({})
  const [serverChecking, setServerChecking] = useState<IdFlagMap>({})
  /** Forces card re-render so link-stability window updates even when no probes are due. */
  const [uiClock, setUiClock] = useState(() => Date.now())
  const refreshingRef = useRef(false)
  const bootstrapInFlightRef = useRef(new Set<string>())
  const previewInFlightRef = useRef(new Set<string>())
  const megaphoneStatusInFlightRef = useRef(new Set<string>())
  const deviceProbeInFlightRef = useRef(new Set<string>())
  const metricRefreshInFlightRef = useRef(new Set<string>())
  const scheduleRef = useRef<Record<string, ObjectProbeSchedule>>({})
  const credentialKeyRef = useRef<Record<string, string>>({})
  /** Bumped to ignore late IPC responses after link/server drop. */
  const probeEpochRef = useRef<Record<string, number>>({})
  const mountedRef = useRef(true)
  const snapshotRef = useRef(snapshot)
  const resultsRef = useRef(results)
  const linkStatusHistoryRef = useRef(linkStatusHistory)
  const linkUnstableFlagsRef = useRef(linkUnstableFlags)
  snapshotRef.current = snapshot
  resultsRef.current = results
  linkStatusHistoryRef.current = linkStatusHistory
  linkUnstableFlagsRef.current = linkUnstableFlags

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setUiClock(Date.now()), RESOURCE_METRIC_FLIP_MS)
    return () => window.clearInterval(timer)
  }, [])

  const getSchedule = useCallback((objectId: string): ObjectProbeSchedule => {
    const current = scheduleRef.current[objectId]
    if (current) return current
    const created = createProbeSchedule()
    scheduleRef.current[objectId] = created
    return created
  }, [])

  const bumpProbeEpoch = useCallback((objectId: string) => {
    probeEpochRef.current[objectId] = (probeEpochRef.current[objectId] ?? 0) + 1
    previewInFlightRef.current.delete(objectId)
    megaphoneStatusInFlightRef.current.delete(objectId)
    deviceProbeInFlightRef.current.delete(objectId)
    bootstrapInFlightRef.current.delete(objectId)
    setCamerasPreviewLoading((prev) => clearIdFlag(prev, objectId))
    setMegaphonesStatusLoading((prev) => clearIdFlag(prev, objectId))
  }, [])

  const editingObject = useMemo(
    () => (editor?.mode === 'edit' && editor.objectId ? snapshot.objects.find((object) => object.id === editor.objectId) ?? null : null),
    [editor, snapshot.objects]
  )

  const sortedObjects = useMemo(
    () => [...snapshot.objects].sort(compareMonitoringObjectsByDigits),
    [snapshot.objects]
  )

  useEffect(() => {
    saveMonitoringSnapshot(snapshot)
  }, [snapshot])

  const objectsKey = useMemo(
    () =>
      snapshot.objects
        .map(
          (object) =>
            `${object.id}|${object.linkHost}|${object.serverHost}|${object.serverLogin}|${object.serverPassword}`
        )
        .join(';'),
    [snapshot.objects]
  )

  const runBootstrap = useCallback(async (object: MonitoringObject, forceStreams = false): Promise<void> => {
    const fetchVersion = window.api?.monitoringFetchVersion
    const fetchStreams = window.api?.monitoringFetchStreams
    const fetchLocations = window.api?.monitoringFetchLocations
    const fetchMegaphones = window.api?.monitoringFetchMegaphones
    const fetchDevices = window.api?.monitoringFetchDevices
    if (
      typeof fetchVersion !== 'function' ||
      typeof fetchStreams !== 'function' ||
      typeof fetchLocations !== 'function' ||
      typeof fetchMegaphones !== 'function' ||
      typeof fetchDevices !== 'function'
    ) {
      setServerVersionErrors((prev) => ({
        ...prev,
        [object.id]: localizeMonitoringError('API недоступен — полностью перезапустите приложение')
      }))
      return
    }

    if (!object.serverPassword) {
      setServerVersionErrors((prev) => ({
        ...prev,
        [object.id]: localizeMonitoringError('Укажите пароль OWL.Guard в настройках объекта')
      }))
      return
    }

    if (bootstrapInFlightRef.current.has(object.id)) return
    bootstrapInFlightRef.current.add(object.id)
    const epoch = probeEpochRef.current[object.id] ?? 0

    const schedule = getSchedule(object.id)
    const auth = {
      id: object.id,
      host: object.serverHost,
      username: object.serverLogin,
      password: object.serverPassword
    }

    const markCredentialFailure = (error: string | undefined): void => {
      setServerVersionErrors((prev) => ({
        ...prev,
        [object.id]: localizeMonitoringError(error)
      }))
      setSnapshot((prev) => ({
        objects: prev.objects.map((item) => {
          if (item.id !== object.id || !item.serverVersion) return item
          const nextItem = { ...item }
          delete nextItem.serverVersion
          return nextItem
        })
      }))
    }

    try {
      console.log('[monitoring] bootstrap start', object.id, object.serverHost)
      const now = Date.now()
      let streamsOk = Boolean(object.cameraStreams?.length)
      let locationsOk = Boolean(object.locations?.length)
      let megaphonesOk = Boolean(object.megaphones?.length) || object.megaphonesTotal !== undefined
      let devicesOk = object.guardDevices !== undefined
      let versionOk = Boolean(object.serverVersion)

      // Warm-start from cache so metrics can run while lists refresh.
      if (streamsOk) {
        schedule.streamsReady = true
        if (schedule.nextPreviewAt === 0) schedule.nextPreviewAt = now
      }
      if (locationsOk) {
        schedule.locationsReady = true
      }
      if (megaphonesOk) {
        schedule.megaphonesReady = true
        if (schedule.nextMegaphoneStatusAt === 0) schedule.nextMegaphoneStatusAt = now
      }
      if (devicesOk) {
        schedule.devicesReady = true
        if (schedule.nextDeviceProbeAt === 0 && (object.guardDevices?.length ?? 0) > 0) {
          schedule.nextDeviceProbeAt = now
        }
      }

      const needVersion = !object.serverVersion
      const needStreams =
        forceStreams ||
        !object.cameraStreams?.length ||
        schedule.lastStreamsAt === 0 ||
        now - schedule.lastStreamsAt >= MONITORING_STREAMS_REFRESH_MS
      const needLocations =
        forceStreams ||
        !object.locations?.length ||
        schedule.lastLocationsAt === 0 ||
        now - schedule.lastLocationsAt >= MONITORING_STREAMS_REFRESH_MS
      const needMegaphones =
        forceStreams ||
        !object.megaphones?.length ||
        object.megaphonesTotal === undefined ||
        schedule.lastMegaphonesAt === 0 ||
        now - schedule.lastMegaphonesAt >= MONITORING_STREAMS_REFRESH_MS
      const needDevices =
        forceStreams ||
        object.guardDevices === undefined ||
        schedule.lastDevicesAt === 0 ||
        now - schedule.lastDevicesAt >= MONITORING_STREAMS_REFRESH_MS

      if (needVersion) {
        const versionResult = await fetchVersion(auth)
        if (!mountedRef.current || (probeEpochRef.current[object.id] ?? 0) !== epoch) return

        if (!versionResult.ok || !versionResult.version) {
          versionOk = false
          if (isCredentialAuthError(versionResult.error)) {
            markCredentialFailure(versionResult.error)
          } else {
            setServerVersionErrors((prev) => ({
              ...prev,
              [object.id]: localizeMonitoringError(versionResult.error)
            }))
          }
        } else {
          versionOk = true
          setServerVersionErrors((prev) => {
            if (!(object.id in prev)) return prev
            const next = { ...prev }
            delete next[object.id]
            return next
          })
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id ? { ...item, serverVersion: versionResult.version! } : item
            )
          }))
        }
      }

      if (needStreams) {
        const streamsResult = await fetchStreams(auth)
        if (!mountedRef.current || (probeEpochRef.current[object.id] ?? 0) !== epoch) return

        if (!streamsResult.ok) {
          console.warn('[monitoring] streams failed', object.id, streamsResult.error)
          if (isCredentialAuthError(streamsResult.error)) {
            markCredentialFailure(streamsResult.error)
            versionOk = false
            streamsOk = false
            schedule.streamsReady = false
          } else if (object.cameraStreams?.length) {
            streamsOk = true
            schedule.streamsReady = true
            if (schedule.lastStreamsAt === 0) schedule.lastStreamsAt = now
          } else {
            streamsOk = false
            schedule.streamsReady = false
          }
        } else {
          streamsOk = true
          setServerVersionErrors((prev) => {
            if (!(object.id in prev)) return prev
            const next = { ...prev }
            delete next[object.id]
            return next
          })
          schedule.lastStreamsAt = now
          schedule.streamsReady = true
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id
                ? {
                    ...item,
                    cameraStreams: streamsResult.streams,
                    camerasTotal: streamsResult.streams.length
                  }
                : item
            )
          }))

          if (needVersion) {
            const latest = snapshotRef.current.objects.find((item) => item.id === object.id)
            if (!latest?.serverVersion) {
              const retryVersion = await fetchVersion(auth)
              if (
                mountedRef.current &&
                (probeEpochRef.current[object.id] ?? 0) === epoch &&
                retryVersion.ok &&
                retryVersion.version
              ) {
                versionOk = true
                setSnapshot((prev) => ({
                  objects: prev.objects.map((item) =>
                    item.id === object.id ? { ...item, serverVersion: retryVersion.version! } : item
                  )
                }))
              }
            }
          }
        }
      }

      // After version is known (cached, fresh, or retry), load location names for camera tooltips.
      if (versionOk && needLocations) {
        const locationsResult = await fetchLocations(auth)
        if (!mountedRef.current || (probeEpochRef.current[object.id] ?? 0) !== epoch) return

        if (!locationsResult.ok) {
          console.warn('[monitoring] locations failed', object.id, locationsResult.error)
          if (isCredentialAuthError(locationsResult.error)) {
            markCredentialFailure(locationsResult.error)
            versionOk = false
            locationsOk = false
            schedule.locationsReady = false
          } else if (object.locations?.length) {
            locationsOk = true
            schedule.locationsReady = true
            if (schedule.lastLocationsAt === 0) schedule.lastLocationsAt = now
          } else {
            locationsOk = false
            schedule.locationsReady = false
          }
        } else {
          locationsOk = true
          schedule.lastLocationsAt = now
          schedule.locationsReady = true
          const primaryLocationName = resolvePrimaryLocationName(locationsResult.locations)
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) => {
              if (item.id !== object.id) return item
              const next: MonitoringObject = {
                ...item,
                locations: locationsResult.locations
              }
              if (primaryLocationName) next.primaryLocationName = primaryLocationName
              else delete next.primaryLocationName
              return next
            })
          }))
        }
      }

      if (needMegaphones) {
        const megaphonesResult = await fetchMegaphones(auth)
        if (!mountedRef.current || (probeEpochRef.current[object.id] ?? 0) !== epoch) return

        if (!megaphonesResult.ok) {
          console.warn('[monitoring] megaphones failed', object.id, megaphonesResult.error)
          if (isCredentialAuthError(megaphonesResult.error)) {
            markCredentialFailure(megaphonesResult.error)
            versionOk = false
            megaphonesOk = false
            schedule.megaphonesReady = false
          } else if (object.megaphones?.length || object.megaphonesTotal !== undefined) {
            megaphonesOk = true
            schedule.megaphonesReady = true
            if (schedule.lastMegaphonesAt === 0) schedule.lastMegaphonesAt = now
          } else {
            megaphonesOk = false
            schedule.megaphonesReady = false
          }
        } else {
          megaphonesOk = true
          schedule.lastMegaphonesAt = now
          schedule.megaphonesReady = true
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id
                ? {
                    ...item,
                    megaphones: megaphonesResult.megaphones,
                    megaphonesTotal: megaphonesResult.megaphones.length,
                    ...(megaphonesResult.megaphones.length === 0 ? { megaphonesOnline: 0, megaphonesOnlineIds: [] } : {})
                  }
                : item
            )
          }))
        }
      }

      if (needDevices) {
        const devicesResult = await fetchDevices(auth)
        if (!mountedRef.current || (probeEpochRef.current[object.id] ?? 0) !== epoch) return

        if (!devicesResult.ok) {
          console.warn('[monitoring] devices failed', object.id, devicesResult.error)
          if (isCredentialAuthError(devicesResult.error)) {
            markCredentialFailure(devicesResult.error)
            versionOk = false
            devicesOk = false
            schedule.devicesReady = false
          } else if (object.guardDevices !== undefined) {
            devicesOk = true
            schedule.devicesReady = true
            if (schedule.lastDevicesAt === 0) schedule.lastDevicesAt = now
          } else {
            devicesOk = false
            schedule.devicesReady = false
          }
        } else {
          devicesOk = true
          schedule.lastDevicesAt = now
          schedule.devicesReady = true
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id
                ? {
                    ...item,
                    guardDevices: devicesResult.devices,
                    ...(devicesResult.devices.length === 0
                      ? { devicesOnline: 0, devicesOnlineIds: [] }
                      : {})
                  }
                : item
            )
          }))
          if (devicesResult.devices.length > 0 && schedule.nextDeviceProbeAt === 0) {
            schedule.nextDeviceProbeAt = now
          }
        }
      }

      // Arm metric ticks only for successfully bootstrapped parts.
      if (streamsOk) {
        schedule.streamsReady = true
        if (schedule.nextPreviewAt === 0) schedule.nextPreviewAt = now
      }
      if (locationsOk) {
        schedule.locationsReady = true
      }
      if (megaphonesOk) {
        schedule.megaphonesReady = true
        if (schedule.nextMegaphoneStatusAt === 0) schedule.nextMegaphoneStatusAt = now
      }
      if (devicesOk) {
        schedule.devicesReady = true
        if (schedule.nextDeviceProbeAt === 0) {
          const latest = snapshotRef.current.objects.find((item) => item.id === object.id)
          if ((latest?.guardDevices?.length ?? object.guardDevices?.length ?? 0) > 0) {
            schedule.nextDeviceProbeAt = now
          }
        }
      }
    } finally {
      bootstrapInFlightRef.current.delete(object.id)
    }
  }, [getSchedule])

  const refreshMetricBlock = useCallback(
    async (object: MonitoringObject, kind: MonitoringMetricKind): Promise<void> => {
      const api = window.api
      if (!api || !object.serverPassword) return
      if (!isOnline(resultsRef.current[targetId(object.id, 'server')])) return

      const refreshKey = `${object.id}:${kind}`
      if (metricRefreshInFlightRef.current.has(refreshKey)) return
      metricRefreshInFlightRef.current.add(refreshKey)

      const auth = {
        id: object.id,
        host: object.serverHost,
        username: object.serverLogin,
        password: object.serverPassword
      }
      const schedule = getSchedule(object.id)

      if (kind === 'cameras') {
        setCamerasMetricFailed((prev) => clearIdFlag(prev, object.id))
        setCamerasPreviewLoading((prev) => ({ ...prev, [object.id]: true }))
      } else if (kind === 'megaphones') {
        setMegaphonesMetricFailed((prev) => clearIdFlag(prev, object.id))
        setMegaphonesStatusLoading((prev) => ({ ...prev, [object.id]: true }))
      } else {
        setSensorsRefreshLoading((prev) => ({ ...prev, [object.id]: true }))
      }

      try {
        if (kind === 'cameras') {
          const streamsResult = await api.monitoringFetchStreams(auth)
          if (!streamsResult.ok) throw new Error(streamsResult.error || 'Не удалось обновить список камер')

          const streamIds = streamsResult.streams.map((stream) => stream.id)
          const previewResult =
            streamIds.length > 0
              ? await api.monitoringPreviewCameras({ ...auth, streamIds })
              : { ok: true as const, onlineCount: 0, onlineIds: [] as number[] }
          if (!previewResult.ok) throw new Error(previewResult.error || 'Не удалось обновить статусы камер')

          schedule.streamsReady = true
          schedule.lastStreamsAt = Date.now()
          schedule.previewFailures = 0
          schedule.nextPreviewAt =
            Date.now() + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id
                ? {
                    ...item,
                    cameraStreams: streamsResult.streams,
                    camerasTotal: streamsResult.streams.length,
                    camerasOnline: previewResult.onlineCount,
                    camerasOnlineIds: previewResult.onlineIds ?? []
                  }
                : item
            )
          }))
          return
        }

        if (kind === 'megaphones') {
          const megaphonesResult = await api.monitoringFetchMegaphones(auth)
          if (!megaphonesResult.ok) {
            throw new Error(megaphonesResult.error || 'Не удалось обновить список рупоров')
          }

          const statusesResult =
            megaphonesResult.megaphones.length > 0
              ? await api.monitoringFetchMegaphoneStatuses(auth)
              : { ok: true as const, onlineCount: 0, onlineIds: [] as number[] }
          if (!statusesResult.ok) throw new Error(statusesResult.error || 'Не удалось обновить статусы рупоров')

          schedule.megaphonesReady = true
          schedule.lastMegaphonesAt = Date.now()
          schedule.megaphoneStatusFailures = 0
          schedule.nextMegaphoneStatusAt =
            Date.now() + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id
                ? {
                    ...item,
                    megaphones: megaphonesResult.megaphones,
                    megaphonesTotal: megaphonesResult.megaphones.length,
                    megaphonesOnline: statusesResult.onlineCount,
                    megaphonesOnlineIds: statusesResult.onlineIds ?? []
                  }
                : item
            )
          }))
          return
        }

        const devicesResult = await api.monitoringFetchDevices(auth)
        if (!devicesResult.ok) throw new Error(devicesResult.error || 'Не удалось обновить список датчиков')

        const probeResult =
          devicesResult.devices.length > 0
            ? await api.monitoringProbeDevices({ ...auth, devices: devicesResult.devices })
            : { ok: true as const, onlineCount: 0, onlineIds: [] as number[] }
        if (!probeResult.ok) throw new Error(probeResult.error || 'Не удалось обновить статусы датчиков')

        schedule.devicesReady = true
        schedule.lastDevicesAt = Date.now()
        schedule.deviceProbeFailures = 0
        schedule.nextDeviceProbeAt =
          Date.now() + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))
        setSnapshot((prev) => ({
          objects: prev.objects.map((item) =>
            item.id === object.id
              ? {
                  ...item,
                  guardDevices: devicesResult.devices,
                  devicesOnline: probeResult.onlineCount,
                  devicesOnlineIds: probeResult.onlineIds ?? []
                }
              : item
          )
        }))
      } catch (error) {
        console.warn(`[monitoring] manual ${kind} refresh failed`, object.id, error)
        if (kind === 'cameras') {
          setCamerasMetricFailed((prev) => ({ ...prev, [object.id]: true }))
        } else if (kind === 'megaphones') {
          setMegaphonesMetricFailed((prev) => ({ ...prev, [object.id]: true }))
        }
      } finally {
        metricRefreshInFlightRef.current.delete(refreshKey)
        if (kind === 'cameras') {
          setCamerasPreviewLoading((prev) => clearIdFlag(prev, object.id))
        } else if (kind === 'megaphones') {
          setMegaphonesStatusLoading((prev) => clearIdFlag(prev, object.id))
        } else {
          setSensorsRefreshLoading((prev) => clearIdFlag(prev, object.id))
        }
      }
    },
    [getSchedule]
  )

  const refresh = useCallback(async () => {
    if (!snapshotRef.current.objects.length || refreshingRef.current) return

    refreshingRef.current = true

    try {
      if (!window.api) return
      const api = window.api
      const now = Date.now()
      const objects = snapshotRef.current.objects

      // Drop schedules for removed objects.
      const liveIds = new Set(objects.map((object) => object.id))
      for (const id of Object.keys(scheduleRef.current)) {
        if (!liveIds.has(id)) delete scheduleRef.current[id]
      }
      for (const id of Object.keys(probeEpochRef.current)) {
        if (!liveIds.has(id)) delete probeEpochRef.current[id]
      }

      const catchUp = needsProbeCatchUp(objects, resultsRef.current)
      const linkLimit = linkBatchLimit(catchUp)
      const serverLimit = serverBatchLimit(catchUp)

      const dueLinks = objects
        .filter((object) => getSchedule(object.id).nextLinkAt <= now)
        .sort((a, b) => {
          const aFirst = resultsRef.current[targetId(a.id, 'link')] ? 1 : 0
          const bFirst = resultsRef.current[targetId(b.id, 'link')] ? 1 : 0
          if (aFirst !== bFirst) return aFirst - bFirst
          return getSchedule(a.id).nextLinkAt - getSchedule(b.id).nextLinkAt
        })
        .slice(0, linkLimit)

      const mergedResults: ResultMap = { ...resultsRef.current }
      const serverProbePromises = new Map<string, Promise<MonitoringPingResult>>()

      const applyServerResult = (object: MonitoringObject, result: MonitoringPingResult): void => {
        mergedResults[result.id] = result
        setResults((prev) => ({ ...prev, [result.id]: result }))

        const schedule = getSchedule(object.id)
        const credKey = versionFetchKey(object)
        if (credentialKeyRef.current[object.id] !== credKey) {
          credentialKeyRef.current[object.id] = credKey
          schedule.streamsReady = false
          schedule.locationsReady = false
          schedule.megaphonesReady = false
          schedule.devicesReady = false
          schedule.lastStreamsAt = 0
          schedule.lastLocationsAt = 0
          schedule.lastMegaphonesAt = 0
          schedule.lastDevicesAt = 0
          schedule.nextPreviewAt = 0
          schedule.nextMegaphoneStatusAt = 0
          schedule.nextDeviceProbeAt = 0
          bumpProbeEpoch(object.id)
        }

        if (result.status !== 'online') {
          schedule.serverFailures += 1
          schedule.lastHttpOk = false
          schedule.nextServerAt =
            Date.now() + failureBackoffMs(schedule.serverFailures, MONITORING_SERVER_INTERVAL_MS)
          bumpProbeEpoch(object.id)
          return
        }

        schedule.serverFailures = 0
        schedule.lastHttpOk = true
        schedule.nextServerAt =
          Date.now() + successDelayMs(adaptiveIntervalMs('server', schedule.signalTier))

        const latestObject = snapshotRef.current.objects.find((item) => item.id === object.id) ?? object
        const streamsStale =
          schedule.lastStreamsAt > 0 && now - schedule.lastStreamsAt >= MONITORING_STREAMS_REFRESH_MS
        const locationsStale =
          schedule.lastLocationsAt > 0 && now - schedule.lastLocationsAt >= MONITORING_STREAMS_REFRESH_MS
        const megaphonesStale =
          schedule.lastMegaphonesAt > 0 && now - schedule.lastMegaphonesAt >= MONITORING_STREAMS_REFRESH_MS
        const devicesStale =
          schedule.lastDevicesAt > 0 && now - schedule.lastDevicesAt >= MONITORING_STREAMS_REFRESH_MS
        const needBootstrap =
          !schedule.streamsReady ||
          !schedule.locationsReady ||
          !schedule.megaphonesReady ||
          !schedule.devicesReady ||
          schedule.lastStreamsAt === 0 ||
          schedule.lastLocationsAt === 0 ||
          schedule.lastMegaphonesAt === 0 ||
          schedule.lastDevicesAt === 0 ||
          streamsStale ||
          locationsStale ||
          megaphonesStale ||
          devicesStale ||
          !latestObject.serverVersion ||
          latestObject.megaphonesTotal === undefined ||
          latestObject.guardDevices === undefined
        if (needBootstrap) {
          void runBootstrap(
            latestObject,
            streamsStale || locationsStale || megaphonesStale || devicesStale
          )
        }
      }

      const startServerProbe = (object: MonitoringObject): Promise<MonitoringPingResult> => {
        const existing = serverProbePromises.get(object.id)
        if (existing) return existing

        const schedule = getSchedule(object.id)
        schedule.nextServerAt = Number.MAX_SAFE_INTEGER
        setServerChecking((prev) => (prev[object.id] ? prev : { ...prev, [object.id]: true }))
        const target: MonitoringPingTarget = {
          id: targetId(object.id, 'server'),
          label: `${object.code} сервер`,
          host: object.serverHost,
          fast: !resultsRef.current[targetId(object.id, 'server')]
        }

        const promise = api
          .monitoringPing([target])
          .then(async ([pingResult]) => {
            if (pingResult.status !== 'online') {
              return {
                ...pingResult,
                status: 'offline' as const,
                latencyMs: null,
                checkedAt: Date.now()
              }
            }

            const httpProbe = api.monitoringHttpProbe
            if (typeof httpProbe !== 'function') return pingResult
            const [httpResult] = await httpProbe([
              {
                id: target.id,
                host: object.serverHost,
                label: target.label
              }
            ])
            const httpOk = httpResult?.ok === true
            return {
              ...pingResult,
              status: (httpOk ? 'online' : 'error') as MonitoringPingStatus,
              checkedAt: Date.now(),
              error: httpOk ? undefined : OWL_GUARD_UNREACHABLE
            }
          })
          .catch((error: unknown) => ({
            id: target.id,
            host: target.host,
            label: target.label,
            status: 'error' as const,
            latencyMs: null,
            checkedAt: Date.now(),
            error: error instanceof Error ? error.message : 'Не удалось проверить сервер'
          }))
          .then((result) => {
            applyServerResult(object, result)
            return result
          })
          .finally(() => {
            setServerChecking((prev) => clearIdFlag(prev, object.id))
          })

        serverProbePromises.set(object.id, promise)
        return promise
      }

      if (dueLinks.length) {
        const linkIds = dueLinks.map((object) => object.id)
        setLinkChecking(setIdFlags(linkIds, true))

        try {
          const linkTargets: MonitoringPingTarget[] = dueLinks.map((object) => ({
            id: targetId(object.id, 'link'),
            label: `${object.code} связь`,
            host: object.linkHost,
            fast: !resultsRef.current[targetId(object.id, 'link')]
          }))

          const linkResults = await Promise.all(
            linkTargets.map(async (target, index) => {
              try {
                const [result] = await api.monitoringPing([target])
                setResults((prev) => ({ ...prev, [result.id]: result }))
                const object = dueLinks[index]
                const schedule = getSchedule(object.id)
                if (result.status === 'online' && schedule.nextServerAt <= now) {
                  void startServerProbe(object)
                }
                return result
              } finally {
                const objectId = dueLinks[index].id
                setLinkChecking((prev) => clearIdFlag(prev, objectId))
              }
            })
          )
          const offlineServers: MonitoringPingResult[] = []

          linkResults.forEach((result) => {
            mergedResults[result.id] = result
            const objectId = result.id.replace(/:link$/, '')
            const object = objects.find((item) => item.id === objectId)
            const schedule = getSchedule(objectId)
            const checkedAt = result.checkedAt || Date.now()
            const statusHistory = appendLinkStatusSample(
              linkStatusHistoryRef.current[result.id],
              result.status === 'online',
              checkedAt
            )
            const unstable = resolveLinkUnstable(
              Boolean(linkUnstableFlagsRef.current[result.id]),
              statusHistory,
              checkedAt
            )
            linkUnstableFlagsRef.current = {
              ...linkUnstableFlagsRef.current,
              [result.id]: unstable
            }
            updateSignalTier(schedule, {
              online: result.status === 'online',
              latencyMs: result.latencyMs,
              replyCount: result.replyCount,
              sentCount: result.sentCount,
              unstable
            })
            if (result.status === 'online') {
              schedule.linkFailures = 0
              schedule.nextLinkAt =
                checkedAt + successDelayMs(adaptiveIntervalMs('link', schedule.signalTier))
              if (
                !serverProbePromises.has(objectId) &&
                (schedule.nextServerAt === 0 || schedule.nextServerAt > now + MONITORING_SERVER_INTERVAL_MS)
              ) {
                schedule.nextServerAt = now
              }
            } else {
              schedule.linkFailures += 1
              schedule.nextLinkAt = checkedAt + linkFailureBackoffMs(schedule.linkFailures)
              schedule.nextServerAt = Number.MAX_SAFE_INTEGER
              bumpProbeEpoch(objectId)
              const serverResult: MonitoringPingResult = {
                id: targetId(objectId, 'server'),
                host: object?.serverHost ?? '',
                label: `${object?.code ?? ''} сервер`,
                status: 'offline',
                latencyMs: null,
                checkedAt: now
              }
              mergedResults[serverResult.id] = serverResult
              offlineServers.push(serverResult)
            }
          })

          setResults((prev) => {
            const next = { ...prev }
            linkResults.forEach((result) => {
              next[result.id] = result
            })
            offlineServers.forEach((result) => {
              next[result.id] = result
            })
            return next
          })
          setLatencyHistory((prev) => {
            let next = prev
            linkResults.forEach((result) => {
              if (result.status !== 'online' || result.latencyMs === null) return
              if (next === prev) next = { ...prev }
              next[result.id] = [...(next[result.id] ?? []), result.latencyMs].slice(-LINK_LATENCY_HISTORY_LIMIT)
            })
            return next
          })
          setLinkStatusHistory((prev) => {
            let next = prev
            linkResults.forEach((result) => {
              if (result.status !== 'online' && result.status !== 'offline' && result.status !== 'error') return
              if (next === prev) next = { ...prev }
              next[result.id] = appendLinkStatusSample(
                next[result.id],
                result.status === 'online',
                result.checkedAt || now
              )
            })
            return next
          })
          setLinkUnstableFlags((prev) => {
            let next = prev
            linkResults.forEach((result) => {
              if (result.status !== 'online' && result.status !== 'offline' && result.status !== 'error') return
              const history = appendLinkStatusSample(
                linkStatusHistoryRef.current[result.id],
                result.status === 'online',
                result.checkedAt || now
              )
              const unstable = resolveLinkUnstable(
                Boolean(prev[result.id]),
                history,
                result.checkedAt || now
              )
              if (Boolean(prev[result.id]) === unstable) return
              if (next === prev) next = { ...prev }
              if (unstable) next[result.id] = true
              else delete next[result.id]
            })
            return next
          })
        } finally {
          setLinkChecking((prev) => {
            let next = prev
            linkIds.forEach((id) => {
              if (!(id in next)) return
              if (next === prev) next = { ...prev }
              delete next[id]
            })
            return next
          })
        }
      }

      const dueServers = objects
        .filter((object) => {
          const schedule = getSchedule(object.id)
          if (schedule.nextServerAt > now) return false
          return isOnline(mergedResults[targetId(object.id, 'link')])
        })
        .sort((a, b) => {
          const aFirst = mergedResults[targetId(a.id, 'server')] ? 1 : 0
          const bFirst = mergedResults[targetId(b.id, 'server')] ? 1 : 0
          if (aFirst !== bFirst) return aFirst - bFirst
          return getSchedule(a.id).nextServerAt - getSchedule(b.id).nextServerAt
        })
        .slice(0, serverLimit)

      if (dueServers.length) {
        const serverIds = dueServers.map((object) => object.id)
        setServerChecking(setIdFlags(serverIds, true))

        try {
          // ICMP first: host may be reachable while OWL.Guard HTTP is down.
          const serverPingTargets: MonitoringPingTarget[] = dueServers.map((object) => ({
            id: targetId(object.id, 'server'),
            label: `${object.code} сервер`,
            host: object.serverHost
          }))
          const serverPingResults = await window.api.monitoringPing(serverPingTargets)
          const pingOnlineServers = dueServers.filter((_, index) => serverPingResults[index]?.status === 'online')

          const httpTargets: MonitoringHttpTarget[] = pingOnlineServers.map((object) => ({
            id: targetId(object.id, 'server'),
            host: object.serverHost,
            label: `${object.code} сервер`
          }))

          const httpProbe = window.api.monitoringHttpProbe
          const httpProbeAvailable = typeof httpProbe === 'function'
          const httpResults: Array<{ id: string; ok: boolean }> =
            httpTargets.length && httpProbeAvailable
              ? await httpProbe(httpTargets)
              : httpTargets.map((target) => ({ id: target.id, ok: true }))
          const httpOkById = new Map<string, boolean>(httpResults.map((result) => [result.id, result.ok]))

          const serverResults: MonitoringPingResult[] = serverPingResults.map((pingResult, index) => {
            const object = dueServers[index]
            if (pingResult.status !== 'online') {
              return {
                id: pingResult.id,
                host: object.serverHost,
                label: `${object.code} сервер`,
                status: 'offline' as const,
                latencyMs: null,
                checkedAt: now
              }
            }

            if (!httpProbeAvailable) {
              return {
                id: pingResult.id,
                host: object.serverHost,
                label: `${object.code} сервер`,
                status: 'online' as const,
                latencyMs: pingResult.latencyMs,
                checkedAt: now
              }
            }

            const httpOk = httpOkById.get(pingResult.id) === true
            return {
              id: pingResult.id,
              host: object.serverHost,
              label: `${object.code} сервер`,
              status: (httpOk ? 'online' : 'error') as MonitoringPingStatus,
              latencyMs: pingResult.latencyMs,
              checkedAt: now,
              error: httpOk ? undefined : OWL_GUARD_UNREACHABLE
            }
          })

          setResults((prev) => {
            const next = { ...prev }
            serverResults.forEach((result) => {
              next[result.id] = result
            })
            return next
          })

          for (let index = 0; index < dueServers.length; index += 1) {
            const object = dueServers[index]
            const result = serverResults[index]
            const schedule = getSchedule(object.id)
            const credKey = versionFetchKey(object)
            if (credentialKeyRef.current[object.id] !== credKey) {
              credentialKeyRef.current[object.id] = credKey
              schedule.streamsReady = false
              schedule.locationsReady = false
              schedule.megaphonesReady = false
              schedule.devicesReady = false
              schedule.lastStreamsAt = 0
              schedule.lastLocationsAt = 0
              schedule.lastMegaphonesAt = 0
              schedule.lastDevicesAt = 0
              schedule.nextPreviewAt = 0
              schedule.nextMegaphoneStatusAt = 0
              schedule.nextDeviceProbeAt = 0
              bumpProbeEpoch(object.id)
            }

            if (result.status === 'offline') {
              schedule.serverFailures += 1
              schedule.lastHttpOk = false
              schedule.nextServerAt =
                Date.now() + failureBackoffMs(schedule.serverFailures, MONITORING_SERVER_INTERVAL_MS)
              bumpProbeEpoch(object.id)
              continue
            }

            if (result.status === 'error') {
              schedule.serverFailures += 1
              schedule.lastHttpOk = false
              schedule.nextServerAt =
                Date.now() + failureBackoffMs(schedule.serverFailures, MONITORING_SERVER_INTERVAL_MS)
              bumpProbeEpoch(object.id)
              continue
            }

            schedule.serverFailures = 0
            schedule.lastHttpOk = true
            schedule.nextServerAt =
              Date.now() + successDelayMs(adaptiveIntervalMs('server', schedule.signalTier))

            if (result.status === 'online') {
              const streamsStale =
                schedule.lastStreamsAt > 0 && now - schedule.lastStreamsAt >= MONITORING_STREAMS_REFRESH_MS
              const locationsStale =
                schedule.lastLocationsAt > 0 && now - schedule.lastLocationsAt >= MONITORING_STREAMS_REFRESH_MS
              const megaphonesStale =
                schedule.lastMegaphonesAt > 0 && now - schedule.lastMegaphonesAt >= MONITORING_STREAMS_REFRESH_MS
              const devicesStale =
                schedule.lastDevicesAt > 0 && now - schedule.lastDevicesAt >= MONITORING_STREAMS_REFRESH_MS
              const needBootstrap =
                !schedule.streamsReady ||
                !schedule.locationsReady ||
                !schedule.megaphonesReady ||
                !schedule.devicesReady ||
                schedule.lastStreamsAt === 0 ||
                schedule.lastLocationsAt === 0 ||
                schedule.lastMegaphonesAt === 0 ||
                schedule.lastDevicesAt === 0 ||
                streamsStale ||
                locationsStale ||
                megaphonesStale ||
                devicesStale ||
                !object.serverVersion ||
                object.megaphonesTotal === undefined ||
                object.guardDevices === undefined
              if (needBootstrap) {
                void runBootstrap(
                  object,
                  streamsStale || locationsStale || megaphonesStale || devicesStale
                )
              }
            }
          }
        } finally {
          setServerChecking((prev) => {
            let next = prev
            serverIds.forEach((id) => {
              if (!(id in next)) return
              if (next === prev) next = { ...prev }
              delete next[id]
            })
            return next
          })
        }
      }
    } finally {
      refreshingRef.current = false
    }
  }, [bumpProbeEpoch, getSchedule, runBootstrap])

  useEffect(() => {
    if (!snapshot.objects.length) return

    let cancelled = false
    let timer: number | undefined

    const run = async (): Promise<void> => {
      await refresh()
      if (cancelled) return
      const catchUp = needsProbeCatchUp(snapshotRef.current.objects, resultsRef.current)
      timer = window.setTimeout(run, schedulerTickMs(catchUp))
    }

    void run()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refresh, objectsKey, snapshot.objects.length])

  useEffect(() => {
    const previewCameras = window.api?.monitoringPreviewCameras
    if (typeof previewCameras !== 'function') return

    let cancelled = false
    let timer: number | undefined

    const runPreviewTick = (): void => {
      if (cancelled) return
      const now = Date.now()
      const catchUp = needsMetricsCatchUp(snapshotRef.current.objects, resultsRef.current)
      const due = snapshotRef.current.objects
        .filter((object) => {
          if (previewInFlightRef.current.has(object.id)) return false
          if (!object.serverPassword) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'link')])) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'server')])) return false
          const streamIds = object.cameraStreams?.map((stream) => stream.id) ?? []
          if (!streamIds.length) return false
          const schedule = getSchedule(object.id)
          if (!schedule.streamsReady) return false
          return schedule.nextPreviewAt <= now
        })
        .sort((a, b) => {
          const aFirst = a.camerasOnline === undefined ? 0 : 1
          const bFirst = b.camerasOnline === undefined ? 0 : 1
          if (aFirst !== bFirst) return aFirst - bFirst
          return getSchedule(a.id).nextPreviewAt - getSchedule(b.id).nextPreviewAt
        })
        .slice(0, previewBatchLimit(catchUp))

      due.forEach((object) => {
        const streamIds = object.cameraStreams?.map((stream) => stream.id).filter((id) => Number.isFinite(id)) ?? []
        const schedule = getSchedule(object.id)
        const isFirstPreview = object.camerasOnline === undefined
        const epoch = probeEpochRef.current[object.id] ?? 0
        previewInFlightRef.current.add(object.id)
        schedule.nextPreviewAt =
          now + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))

        if (isFirstPreview) {
          setCamerasMetricFailed((prev) => clearIdFlag(prev, object.id))
          setCamerasPreviewLoading((prev) => (prev[object.id] ? prev : { ...prev, [object.id]: true }))
        }

        console.log('[monitoring] preview cameras', object.id, streamIds.length)
        void previewCameras({
          id: object.id,
          host: object.serverHost,
          username: object.serverLogin,
          password: object.serverPassword,
          streamIds
        })
          .then((result) => {
            if (!mountedRef.current) return
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            console.log('[monitoring] preview result', result)
            if (!result.ok) {
              schedule.previewFailures += 1
              schedule.nextPreviewAt =
                Date.now() + failureBackoffMs(schedule.previewFailures, MONITORING_PREVIEW_INTERVAL_MS)
              if (isFirstPreview) {
                setCamerasMetricFailed((prev) => ({ ...prev, [object.id]: true }))
              }
              console.warn('[monitoring] preview failed', object.id, result.error)
              return
            }

            schedule.previewFailures = 0
            schedule.nextPreviewAt =
              Date.now() + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))
            setCamerasMetricFailed((prev) => clearIdFlag(prev, object.id))
            setSnapshot((prev) => {
              const current = prev.objects.find((item) => item.id === object.id)
              if (!current) return prev
              const onlineIds = result.onlineIds ?? []
              if (
                current.camerasOnline === result.onlineCount &&
                sameNumberList(current.camerasOnlineIds, onlineIds)
              ) {
                return prev
              }
              return {
                objects: prev.objects.map((item) =>
                  item.id === object.id
                    ? { ...item, camerasOnline: result.onlineCount, camerasOnlineIds: onlineIds }
                    : item
                )
              }
            })
          })
          .finally(() => {
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            previewInFlightRef.current.delete(object.id)
            setCamerasPreviewLoading((prev) => clearIdFlag(prev, object.id))
          })
      })

      if (cancelled) return
      timer = window.setTimeout(runPreviewTick, schedulerTickMs(catchUp || due.length > 0))
    }

    runPreviewTick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [getSchedule, objectsKey])

  useEffect(() => {
    const fetchMegaphoneStatuses = window.api?.monitoringFetchMegaphoneStatuses
    if (typeof fetchMegaphoneStatuses !== 'function') return

    let cancelled = false
    let timer: number | undefined

    const runMegaphoneStatusTick = (): void => {
      if (cancelled) return
      const now = Date.now()
      const catchUp = needsMetricsCatchUp(snapshotRef.current.objects, resultsRef.current)
      const due = snapshotRef.current.objects
        .filter((object) => {
          if (megaphoneStatusInFlightRef.current.has(object.id)) return false
          if (!object.serverPassword) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'link')])) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'server')])) return false
          if ((object.megaphonesTotal ?? object.megaphones?.length ?? 0) <= 0) return false
          const schedule = getSchedule(object.id)
          if (!schedule.megaphonesReady) return false
          return schedule.nextMegaphoneStatusAt <= now
        })
        .sort((a, b) => {
          const aFirst = a.megaphonesOnline === undefined ? 0 : 1
          const bFirst = b.megaphonesOnline === undefined ? 0 : 1
          if (aFirst !== bFirst) return aFirst - bFirst
          return getSchedule(a.id).nextMegaphoneStatusAt - getSchedule(b.id).nextMegaphoneStatusAt
        })
        .slice(0, previewBatchLimit(catchUp))

      due.forEach((object) => {
        const schedule = getSchedule(object.id)
        const isFirstStatus = object.megaphonesOnline === undefined
        const epoch = probeEpochRef.current[object.id] ?? 0
        megaphoneStatusInFlightRef.current.add(object.id)
        schedule.nextMegaphoneStatusAt =
          now + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))

        if (isFirstStatus) {
          setMegaphonesMetricFailed((prev) => clearIdFlag(prev, object.id))
          setMegaphonesStatusLoading((prev) => (prev[object.id] ? prev : { ...prev, [object.id]: true }))
        }

        console.log('[monitoring] megaphone statuses', object.id)
        void fetchMegaphoneStatuses({
          id: object.id,
          host: object.serverHost,
          username: object.serverLogin,
          password: object.serverPassword
        })
          .then((result) => {
            if (!mountedRef.current) return
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            console.log('[monitoring] megaphone statuses result', result)
            if (!result.ok) {
              schedule.megaphoneStatusFailures += 1
              schedule.nextMegaphoneStatusAt =
                Date.now() + failureBackoffMs(schedule.megaphoneStatusFailures, MONITORING_PREVIEW_INTERVAL_MS)
              if (isFirstStatus) {
                setMegaphonesMetricFailed((prev) => ({ ...prev, [object.id]: true }))
              }
              console.warn('[monitoring] megaphone statuses failed', object.id, result.error)
              return
            }

            schedule.megaphoneStatusFailures = 0
            schedule.nextMegaphoneStatusAt =
              Date.now() + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))
            setMegaphonesMetricFailed((prev) => clearIdFlag(prev, object.id))
            setSnapshot((prev) => {
              const current = prev.objects.find((item) => item.id === object.id)
              if (!current) return prev
              const onlineIds = result.onlineIds ?? []
              if (
                current.megaphonesOnline === result.onlineCount &&
                sameNumberList(current.megaphonesOnlineIds, onlineIds)
              ) {
                return prev
              }
              return {
                objects: prev.objects.map((item) =>
                  item.id === object.id
                    ? {
                        ...item,
                        megaphonesOnline: result.onlineCount,
                        megaphonesOnlineIds: onlineIds
                      }
                    : item
                )
              }
            })
          })
          .finally(() => {
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            megaphoneStatusInFlightRef.current.delete(object.id)
            setMegaphonesStatusLoading((prev) => clearIdFlag(prev, object.id))
          })
      })

      if (cancelled) return
      timer = window.setTimeout(runMegaphoneStatusTick, schedulerTickMs(catchUp || due.length > 0))
    }

    runMegaphoneStatusTick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [getSchedule, objectsKey])

  useEffect(() => {
    const probeDevices = window.api?.monitoringProbeDevices
    if (typeof probeDevices !== 'function') return

    let cancelled = false
    let timer: number | undefined

    const runDeviceProbeTick = (): void => {
      if (cancelled) return
      const now = Date.now()
      const catchUp = needsMetricsCatchUp(snapshotRef.current.objects, resultsRef.current)
      const due = snapshotRef.current.objects
        .filter((object) => {
          if (deviceProbeInFlightRef.current.has(object.id)) return false
          if (!object.serverPassword) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'link')])) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'server')])) return false
          if ((object.guardDevices?.length ?? 0) <= 0) return false
          const schedule = getSchedule(object.id)
          if (!schedule.devicesReady) return false
          return schedule.nextDeviceProbeAt <= now
        })
        .sort((a, b) => {
          const aFirst = a.devicesOnline === undefined ? 0 : 1
          const bFirst = b.devicesOnline === undefined ? 0 : 1
          if (aFirst !== bFirst) return aFirst - bFirst
          return getSchedule(a.id).nextDeviceProbeAt - getSchedule(b.id).nextDeviceProbeAt
        })
        .slice(0, previewBatchLimit(catchUp))

      due.forEach((object) => {
        const devices = object.guardDevices ?? []
        const schedule = getSchedule(object.id)
        const epoch = probeEpochRef.current[object.id] ?? 0
        deviceProbeInFlightRef.current.add(object.id)
        schedule.nextDeviceProbeAt =
          now + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))

        console.log('[monitoring] probe devices', object.id, devices.length)
        void probeDevices({
          id: object.id,
          host: object.serverHost,
          username: object.serverLogin,
          password: object.serverPassword,
          devices
        })
          .then((result) => {
            if (!mountedRef.current) return
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            console.log('[monitoring] device probe result', result)
            if (!result.ok) {
              schedule.deviceProbeFailures += 1
              schedule.nextDeviceProbeAt =
                Date.now() + failureBackoffMs(schedule.deviceProbeFailures, MONITORING_PREVIEW_INTERVAL_MS)
              console.warn('[monitoring] device probe failed', object.id, result.error)
              return
            }

            schedule.deviceProbeFailures = 0
            schedule.nextDeviceProbeAt =
              Date.now() + successDelayMs(adaptiveIntervalMs('metrics', schedule.signalTier))
            setSnapshot((prev) => {
              const current = prev.objects.find((item) => item.id === object.id)
              if (!current) return prev
              const onlineIds = result.onlineIds ?? []
              if (
                current.devicesOnline === result.onlineCount &&
                sameNumberList(current.devicesOnlineIds, onlineIds)
              ) {
                return prev
              }
              return {
                objects: prev.objects.map((item) =>
                  item.id === object.id
                    ? {
                        ...item,
                        devicesOnline: result.onlineCount,
                        devicesOnlineIds: onlineIds
                      }
                    : item
                )
              }
            })
          })
          .finally(() => {
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            deviceProbeInFlightRef.current.delete(object.id)
          })
      })

      if (cancelled) return
      timer = window.setTimeout(runDeviceProbeTick, schedulerTickMs(catchUp || due.length > 0))
    }

    runDeviceProbeTick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [getSchedule, objectsKey])

  const clearObjectResults = useCallback(
    (id: string) => {
      bumpProbeEpoch(id)
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
      setLinkStatusHistory((prev) => {
        const next = { ...prev }
        delete next[targetId(id, 'link')]
        return next
      })
      setServerVersionErrors((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setCamerasMetricFailed((prev) => clearIdFlag(prev, id))
      setMegaphonesMetricFailed((prev) => clearIdFlag(prev, id))
      setSensorsRefreshLoading((prev) => clearIdFlag(prev, id))
      setLinkChecking((prev) => clearIdFlag(prev, id))
      setServerChecking((prev) => clearIdFlag(prev, id))
      delete scheduleRef.current[id]
      delete credentialKeyRef.current[id]
      delete probeEpochRef.current[id]
    },
    [bumpProbeEpoch]
  )

  const saveObject = useCallback(
    (next: MonitoringObject, originalId?: string): boolean => {
      const prev = snapshot
      let nextObjects: MonitoringObject[] | null = null

      if (originalId) {
        nextObjects = prev.objects.map((object) => {
          if (object.id !== originalId) return object
          // Keep cached OWL.Guard data only when host + login + password are unchanged.
          // Otherwise a wrong password would keep the old version and leave the server status green.
          const sameCredentials =
            object.serverHost === next.serverHost &&
            object.serverLogin === next.serverLogin &&
            object.serverPassword === next.serverPassword
          return {
            ...next,
            id: originalId,
            code: object.code,
            ...(sameCredentials && object.serverVersion ? { serverVersion: object.serverVersion } : {}),
            ...(sameCredentials && object.primaryLocationName
              ? { primaryLocationName: object.primaryLocationName }
              : {}),
            ...(sameCredentials && object.cameraStreams
              ? {
                  cameraStreams: object.cameraStreams,
                  camerasTotal: object.camerasTotal ?? object.cameraStreams.length,
                  ...(object.camerasOnline !== undefined ? { camerasOnline: object.camerasOnline } : {}),
                  ...(object.camerasOnlineIds !== undefined
                    ? { camerasOnlineIds: object.camerasOnlineIds }
                    : {})
                }
              : {}),
            ...(sameCredentials && object.locations?.length ? { locations: object.locations } : {}),
            ...(sameCredentials && object.megaphones?.length
              ? {
                  megaphones: object.megaphones,
                  megaphonesTotal: object.megaphonesTotal ?? object.megaphones.length,
                  ...(object.megaphonesOnline !== undefined
                    ? { megaphonesOnline: object.megaphonesOnline }
                    : {}),
                  ...(object.megaphonesOnlineIds !== undefined
                    ? { megaphonesOnlineIds: object.megaphonesOnlineIds }
                    : {})
                }
              : sameCredentials && object.megaphonesTotal !== undefined
                ? {
                    megaphonesTotal: object.megaphonesTotal,
                    ...(object.megaphonesOnline !== undefined
                      ? { megaphonesOnline: object.megaphonesOnline }
                      : {}),
                    ...(object.megaphonesOnlineIds !== undefined
                      ? { megaphonesOnlineIds: object.megaphonesOnlineIds }
                      : {})
                  }
                : {}),
          }
        })
      } else if (prev.objects.some((object) => object.id === next.id)) {
        return false
      } else {
        nextObjects = [...prev.objects, next]
      }

      setSnapshot({ objects: [...nextObjects].sort(compareMonitoringObjectsByDigits) })

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
            <h1 className="m-0 text-[1.75rem] font-semibold tracking-[-0.028em] leading-[1.2] text-label-primary">Мониторинг</h1>
          </div>
          <button
            type="button"
            onClick={openAddEditor}
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-tint-blue px-3 py-2 text-[13px] font-semibold tracking-tight text-white shadow-sm transition-colors duration-200 hover:bg-tint-blue-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-window"
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

      <div className="grid gap-4 lg:grid-cols-2">
        {sortedObjects.map((object) => (
          <MonitoringObjectCard
            key={object.id}
            object={object}
            results={results}
            latencyHistory={latencyHistory}
            linkUnstable={Boolean(linkUnstableFlags[targetId(object.id, 'link')])}
            checkingLink={Boolean(linkChecking[object.id])}
            checkingServer={Boolean(serverChecking[object.id])}
            serverVersion={object.serverVersion ?? null}
            serverVersionError={serverVersionErrors[object.id] ?? null}
            serverResources={EMPTY_SERVER_RESOURCES}
            camerasPreviewLoading={Boolean(camerasPreviewLoading[object.id])}
            megaphonesStatusLoading={Boolean(megaphonesStatusLoading[object.id])}
            camerasMetricFailed={Boolean(camerasMetricFailed[object.id])}
            megaphonesMetricFailed={Boolean(megaphonesMetricFailed[object.id])}
            sensorsRefreshLoading={Boolean(sensorsRefreshLoading[object.id])}
            now={uiClock}
            onEdit={openEditEditor}
            onRefreshMetric={refreshMetricBlock}
          />
        ))}
      </div>

      {sortedObjects.length === 0 && (
        <p className="mt-6 text-center text-[15px] font-medium text-label-secondary">
          Нет объектов для отслеживания
        </p>
      )}
    </article>
  )
}
