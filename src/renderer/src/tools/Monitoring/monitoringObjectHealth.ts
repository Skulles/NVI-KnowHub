import type { MonitoringPingResult } from '@shared/api'
import { resolveSensorsIndicatorStatus } from './components/MonitoringMetricStatus'
import type { MonitoringObject, MonitoringObjectKind } from './monitoringStorage'
import { MONITORING_OBJECT_KIND_SUMMARY_LABELS } from './monitoringObjectKind'

export type MonitoringObjectHealth = 'online' | 'problems' | 'offline'

export type HealthCounts = {
  online: number
  problems: number
  offline: number
  total: number
}

export type KindHealthGroup = {
  kind: MonitoringObjectKind
  label: string
  counts: HealthCounts
}

const KIND_ORDER: MonitoringObjectKind[] = ['drilling', 'tkrs', 'auto']

export const HEALTH_LABELS: Record<MonitoringObjectHealth, string> = {
  online: 'в норме',
  problems: 'с проблемами',
  offline: 'нет связи'
}

export const HEALTH_COLORS: Record<MonitoringObjectHealth, string> = {
  online: 'text-emerald-400',
  problems: 'text-amber-300',
  offline: 'text-red-400'
}

export type SummaryHealthFilter = {
  kind: MonitoringObjectKind
  health?: MonitoringObjectHealth
}

/** Same thresholds as the yellow/red resource indicators on the card. */
export const RESOURCE_LOAD_WARN_PERCENT = 80
export const RESOURCE_LOAD_CRIT_PERCENT = 90
export const RESOURCE_TEMP_WARN_C = 75
export const RESOURCE_TEMP_CRIT_C = 85

export function isResourceLoadAlert(loadPercent: number | null | undefined): boolean {
  return typeof loadPercent === 'number' && Number.isFinite(loadPercent) && loadPercent > RESOURCE_LOAD_WARN_PERCENT
}

export function isResourceTempAlert(tempC: number | null | undefined): boolean {
  return typeof tempC === 'number' && Number.isFinite(tempC) && tempC > RESOURCE_TEMP_WARN_C
}

function isOnline(result: MonitoringPingResult | undefined): boolean {
  return (result?.status ?? 'unknown') === 'online'
}

export function emptyHealthCounts(): HealthCounts {
  return { online: 0, problems: 0, offline: 0, total: 0 }
}

function metricCountsReady(
  online: number | undefined,
  total: number | undefined,
  failed?: boolean
): boolean {
  if (failed) return true
  if (typeof total !== 'number') return false
  return total === 0 || typeof online === 'number'
}

/** `null` — ещё нет полных метрик, в сводке не считаем «в норме». */
export function resolveMonitoringObjectHealth(input: {
  linkOnline: boolean
  /** `false` — сервер или OWL.Guard точно недоступны. `undefined` — ещё нет ответа. */
  serverOnline?: boolean
  serverVersionError?: string | null
  camerasOnline?: number
  camerasTotal?: number
  megaphonesOnline?: number
  megaphonesTotal?: number
  camerasMetricFailed?: boolean
  megaphonesMetricFailed?: boolean
  sensorsStatus?: 'ok' | 'warning' | 'error' | 'unknown' | 'muted'
  cpuLoad?: number | null
  cpuTempC?: number | null
  gpuLoad?: number | null
  gpuTempC?: number | null
  ramLoad?: number | null
}): MonitoringObjectHealth | null {
  if (!input.linkOnline) return 'offline'

  if (input.serverOnline === false || input.serverVersionError) return 'problems'

  const camerasProblem =
    input.camerasMetricFailed ||
    (typeof input.camerasOnline === 'number' &&
      typeof input.camerasTotal === 'number' &&
      input.camerasTotal > 0 &&
      input.camerasOnline < input.camerasTotal)
  const megaphonesProblem =
    input.megaphonesMetricFailed ||
    (typeof input.megaphonesOnline === 'number' &&
      typeof input.megaphonesTotal === 'number' &&
      input.megaphonesTotal > 0 &&
      input.megaphonesOnline < input.megaphonesTotal)
  const sensorsProblem = input.sensorsStatus === 'warning' || input.sensorsStatus === 'error'
  const resourceProblem =
    isResourceLoadAlert(input.cpuLoad) ||
    isResourceTempAlert(input.cpuTempC) ||
    isResourceLoadAlert(input.gpuLoad) ||
    isResourceTempAlert(input.gpuTempC) ||
    isResourceLoadAlert(input.ramLoad)

  if (camerasProblem || megaphonesProblem || sensorsProblem || resourceProblem) {
    return 'problems'
  }

  const camerasReady = metricCountsReady(
    input.camerasOnline,
    input.camerasTotal,
    input.camerasMetricFailed
  )
  const megaphonesReady = metricCountsReady(
    input.megaphonesOnline,
    input.megaphonesTotal,
    input.megaphonesMetricFailed
  )
  const sensorsReady = input.sensorsStatus !== undefined && input.sensorsStatus !== 'unknown'

  if (input.serverOnline !== true || !camerasReady || !megaphonesReady || !sensorsReady) {
    return null
  }

  return 'online'
}

export function resolveObjectHealthFromProbes(
  object: MonitoringObject,
  results: Record<string, MonitoringPingResult | undefined>,
  extras: {
    serverVersionError?: string | null
    camerasMetricFailed?: boolean
    megaphonesMetricFailed?: boolean
    cpuLoad?: number | null
    cpuTempC?: number | null
    gpuLoad?: number | null
    gpuTempC?: number | null
    ramLoad?: number | null
  } = {}
): MonitoringObjectHealth | null {
  const linkResult = results[`${object.id}:link`]
  const serverResult = results[`${object.id}:server`]
  const linkOnline = isOnline(linkResult)
  const serverStatus = serverResult?.status
  const serverOnline =
    serverStatus === 'online' ? true : serverStatus === 'offline' || serverStatus === 'error' ? false : undefined
  const camerasTotal = object.camerasTotal ?? object.cameraStreams?.length
  const megaphonesTotal = object.megaphonesTotal ?? object.megaphones?.length
  const sensorsStatus = resolveSensorsIndicatorStatus(
    object.guardDevices,
    object.devicesOnline,
    linkOnline,
    serverOnline === true
  )

  return resolveMonitoringObjectHealth({
    linkOnline,
    serverOnline,
    serverVersionError: extras.serverVersionError,
    camerasOnline: object.camerasOnline,
    camerasTotal,
    megaphonesOnline: object.megaphonesOnline,
    megaphonesTotal,
    camerasMetricFailed: extras.camerasMetricFailed,
    megaphonesMetricFailed: extras.megaphonesMetricFailed,
    sensorsStatus,
    cpuLoad: extras.cpuLoad,
    cpuTempC: extras.cpuTempC,
    gpuLoad: extras.gpuLoad,
    gpuTempC: extras.gpuTempC,
    ramLoad: extras.ramLoad
  })
}

export function groupHealthByObjectKind(
  objects: MonitoringObject[],
  healthById: Record<string, MonitoringObjectHealth | null>
): KindHealthGroup[] {
  const buckets = new Map<MonitoringObjectKind, HealthCounts>()

  for (const object of objects) {
    const kind = object.objectKind
    const health = healthById[object.id]
    const current = buckets.get(kind) ?? emptyHealthCounts()
    buckets.set(kind, {
      ...current,
      ...(health ? { [health]: current[health] + 1 } : {}),
      total: current.total + 1
    })
  }

  return KIND_ORDER.flatMap((kind) => {
    const counts = buckets.get(kind)
    if (!counts) return []
    return [{ kind, label: MONITORING_OBJECT_KIND_SUMMARY_LABELS[kind], counts }]
  })
}
