import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  MonitoringHttpTarget,
  MonitoringPingResult,
  MonitoringPingStatus,
  MonitoringPingTarget
} from '@shared/api'
import {
  resolvePrimaryLocationName,
  type MonitoringObject,
  type MonitoringSnapshot
} from '../monitoringStorage'
import { isCredentialAuthError, localizeMonitoringError } from '../monitoringErrors'
import type {
  IdFlagMap,
  LatencyHistoryMap,
  LinkStatusHistoryMap,
  MonitoringMetricKind,
  ResultMap,
  VersionErrorMap
} from '../monitoringTypes'
import {
  MONITORING_MAX_RESOURCES_BATCH,
  MONITORING_RESOURCES_INTERVAL_MS,
  MONITORING_SERVER_INTERVAL_MS,
  MONITORING_STREAMS_REFRESH_MS,
  adaptiveIntervalMs,
  appendLinkStatusSample,
  createProbeSchedule,
  failureBackoffMs,
  linkBatchLimit,
  linkFailureBackoffMs,
  metricFailureDelayMs,
  previewBatchLimit,
  resolveLinkUnstable,
  resourcesFailureBackoffMs,
  schedulerTickMs,
  serverBatchLimit,
  successDelayMs,
  updateSignalTier,
  type ObjectProbeSchedule
} from '../monitoringSchedule'

const LINK_LATENCY_HISTORY_LIMIT = 10
const OWL_GUARD_UNREACHABLE = 'не удалось подключиться к OWL.Guard'
const METRIC_RETRY_DELAY_MS = 2500
const RESOURCE_METRIC_FLIP_MS = 5000

function versionFetchKey(object: MonitoringObject): string {
  return `${object.id}|${object.serverHost}|${object.serverLogin}|${object.serverPassword}`
}

function targetId(objectId: string, kind: 'link' | 'server'): string {
  return `${objectId}:${kind}`
}

function isOnline(result: MonitoringPingResult | undefined): boolean {
  return (result?.status ?? 'unknown') === 'online'
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

async function retryMetricRequest<T extends { ok: boolean }>(
  request: () => Promise<T>,
  retryOnUnstableLink: boolean
): Promise<T> {
  const first = await request()
  if (first.ok || !retryOnUnstableLink) return first
  await new Promise<void>((resolve) => window.setTimeout(resolve, METRIC_RETRY_DELAY_MS))
  return request()
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

function sameNumberList(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  const left = [...a].sort((x, y) => x - y)
  const right = [...b].sort((x, y) => x - y)
  return left.every((value, index) => value === right[index])
}

interface UseMonitoringProbesOptions {
  snapshot: MonitoringSnapshot
  setSnapshot: Dispatch<SetStateAction<MonitoringSnapshot>>
}

export function useMonitoringProbes({ snapshot, setSnapshot }: UseMonitoringProbesOptions) {
  const [results, setResults] = useState<ResultMap>({})
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistoryMap>({})
  const [linkStatusHistory, setLinkStatusHistory] = useState<LinkStatusHistoryMap>({})
  const [linkUnstableFlags, setLinkUnstableFlags] = useState<IdFlagMap>({})
  const [serverVersionErrors, setServerVersionErrors] = useState<VersionErrorMap>({})
  const [cpuLoads, setCpuLoads] = useState<Record<string, number | null>>({})
  const [cpuTemps, setCpuTemps] = useState<Record<string, number | null>>({})
  const [gpuLoads, setGpuLoads] = useState<Record<string, number | null>>({})
  const [gpuTemps, setGpuTemps] = useState<Record<string, number | null>>({})
  const [ramLoads, setRamLoads] = useState<Record<string, number | null>>({})
  const [serverResourcesLoading, setServerResourcesLoading] = useState<IdFlagMap>({})
  const [camerasPreviewLoading, setCamerasPreviewLoading] = useState<IdFlagMap>({})
  const [megaphonesStatusLoading, setMegaphonesStatusLoading] = useState<IdFlagMap>({})
  const [camerasMetricFailed, setCamerasMetricFailed] = useState<IdFlagMap>({})
  const [megaphonesMetricFailed, setMegaphonesMetricFailed] = useState<IdFlagMap>({})
  const [sensorsRefreshLoading, setSensorsRefreshLoading] = useState<IdFlagMap>({})
  const [linkChecking, setLinkChecking] = useState<IdFlagMap>({})
  const [serverChecking, setServerChecking] = useState<IdFlagMap>({})
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false)
  /** Forces card re-render so link-stability window updates even when no probes are due. */
  const [uiClock, setUiClock] = useState(() => Date.now())
  const refreshingRef = useRef(false)
  const manualRefreshInFlightRef = useRef(false)
  const bootstrapInFlightRef = useRef(new Set<string>())
  const previewInFlightRef = useRef(new Set<string>())
  const megaphoneStatusInFlightRef = useRef(new Set<string>())
  const deviceProbeInFlightRef = useRef(new Set<string>())
  const serverResourcesInFlightRef = useRef(new Set<string>())
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

      const needVersion = forceStreams || !object.serverVersion
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
  }, [getSchedule, setSnapshot])

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
      const retryOnUnstableLink =
        schedule.signalTier === 'degraded' ||
        schedule.signalTier === 'poor' ||
        Boolean(linkUnstableFlagsRef.current[targetId(object.id, 'link')])

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
          const streamsResult = await retryMetricRequest(
            () => api.monitoringFetchStreams(auth),
            retryOnUnstableLink
          )
          if (!streamsResult.ok) throw new Error(streamsResult.error || 'Не удалось обновить список камер')

          const streamIds = streamsResult.streams.map((stream) => stream.id)
          const previewResult =
            streamIds.length > 0
              ? await retryMetricRequest(
                  () => api.monitoringPreviewCameras({ ...auth, streamIds }),
                  retryOnUnstableLink
                )
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
          const megaphonesResult = await retryMetricRequest(
            () => api.monitoringFetchMegaphones(auth),
            retryOnUnstableLink
          )
          if (!megaphonesResult.ok) {
            throw new Error(megaphonesResult.error || 'Не удалось обновить список рупоров')
          }

          const statusesResult =
            megaphonesResult.megaphones.length > 0
              ? await retryMetricRequest(
                  () => api.monitoringFetchMegaphoneStatuses(auth),
                  retryOnUnstableLink
                )
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

        const devicesResult = await retryMetricRequest(
          () => api.monitoringFetchDevices(auth),
          retryOnUnstableLink
        )
        if (!devicesResult.ok) throw new Error(devicesResult.error || 'Не удалось обновить список датчиков')

        const probeResult =
          devicesResult.devices.length > 0
            ? await retryMetricRequest(
                () => api.monitoringProbeDevices({ ...auth, devices: devicesResult.devices }),
                retryOnUnstableLink
              )
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
    [getSchedule, setSnapshot]
  )

  const refreshServerResources = useCallback(async (object: MonitoringObject): Promise<boolean> => {
    const fetchServerResources = window.api?.monitoringFetchServerResources
    if (typeof fetchServerResources !== 'function' || !object.serverPassword) return false
    if (serverResourcesInFlightRef.current.has(object.id)) return false

    serverResourcesInFlightRef.current.add(object.id)
    setServerResourcesLoading((prev) => ({ ...prev, [object.id]: true }))
    const epoch = probeEpochRef.current[object.id] ?? 0
    try {
      const result = await fetchServerResources({
        id: object.id,
        host: object.serverHost,
        username: object.serverLogin,
        password: object.serverPassword
      })
      if (!mountedRef.current || (probeEpochRef.current[object.id] ?? 0) !== epoch) return false
      setCpuLoads((prev) => ({
        ...prev,
        [object.id]: result.ok ? result.cpuLoad : null
      }))
      setCpuTemps((prev) => ({
        ...prev,
        [object.id]: result.ok ? result.cpuTempC : null
      }))
      setGpuLoads((prev) => ({
        ...prev,
        [object.id]: result.ok ? result.gpuLoad : null
      }))
      setGpuTemps((prev) => ({
        ...prev,
        [object.id]: result.ok ? result.gpuTempC : null
      }))
      setRamLoads((prev) => ({
        ...prev,
        [object.id]: result.ok ? result.ramLoad : null
      }))
      return result.ok
    } catch (error) {
      console.warn('[monitoring] server resources refresh failed', object.id, error)
      if (mountedRef.current) {
        setCpuLoads((prev) => ({ ...prev, [object.id]: null }))
        setCpuTemps((prev) => ({ ...prev, [object.id]: null }))
        setGpuLoads((prev) => ({ ...prev, [object.id]: null }))
        setGpuTemps((prev) => ({ ...prev, [object.id]: null }))
        setRamLoads((prev) => ({ ...prev, [object.id]: null }))
      }
      return false
    } finally {
      serverResourcesInFlightRef.current.delete(object.id)
      if (mountedRef.current) {
        setServerResourcesLoading((prev) => clearIdFlag(prev, object.id))
      }
    }
  }, [])

  const refresh = useCallback(async (forceAll = false) => {
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
      const bootstrapPromises: Promise<void>[] = []

      const startBootstrap = (object: MonitoringObject, forceStreams: boolean): void => {
        const promise = runBootstrap(object, forceStreams)
        if (forceAll) bootstrapPromises.push(promise)
        else void promise
      }

      const dueLinks = objects
        .filter((object) => getSchedule(object.id).nextLinkAt <= now)
        .sort((a, b) => {
          const aFirst = resultsRef.current[targetId(a.id, 'link')] ? 1 : 0
          const bFirst = resultsRef.current[targetId(b.id, 'link')] ? 1 : 0
          if (aFirst !== bFirst) return aFirst - bFirst
          return getSchedule(a.id).nextLinkAt - getSchedule(b.id).nextLinkAt
        })
        .slice(0, forceAll ? objects.length : linkLimit)

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
          schedule.nextServerResourcesAt = 0
          schedule.serverResourcesFailures = 0
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
          forceAll ||
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
          startBootstrap(
            latestObject,
            forceAll || streamsStale || locationsStale || megaphonesStale || devicesStale
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
              checkedAt,
              result.replyCount,
              result.sentCount
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
                result.checkedAt || now,
                result.replyCount,
                result.sentCount
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
                result.checkedAt || now,
                result.replyCount,
                result.sentCount
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
        .slice(0, forceAll ? objects.length : serverLimit)

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
              schedule.nextServerResourcesAt = 0
              schedule.serverResourcesFailures = 0
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
                forceAll ||
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
                startBootstrap(
                  object,
                  forceAll || streamsStale || locationsStale || megaphonesStale || devicesStale
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

      if (forceAll && serverProbePromises.size > 0) {
        await Promise.allSettled([...serverProbePromises.values()])
      }
      if (forceAll && bootstrapPromises.length > 0) {
        await Promise.allSettled(bootstrapPromises)
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
    if (typeof window.api?.monitoringFetchServerResources !== 'function') return

    let cancelled = false
    let timer: number | undefined

    const runServerResourcesTick = async (): Promise<void> => {
      if (cancelled) return
      const now = Date.now()
      const due = snapshotRef.current.objects
        .filter((object) => {
          if (!object.serverPassword || serverResourcesInFlightRef.current.has(object.id)) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'server')])) return false
          return getSchedule(object.id).nextServerResourcesAt <= now
        })
        .sort(
          (left, right) =>
            getSchedule(left.id).nextServerResourcesAt - getSchedule(right.id).nextServerResourcesAt
        )
        .slice(0, MONITORING_MAX_RESOURCES_BATCH)

      await Promise.all(
        due.map(async (object) => {
          const schedule = getSchedule(object.id)
          schedule.nextServerResourcesAt = Number.MAX_SAFE_INTEGER
          const ok = await refreshServerResources(object)
          if (cancelled) return

          if (ok) {
            schedule.serverResourcesFailures = 0
            schedule.nextServerResourcesAt =
              Date.now() + successDelayMs(MONITORING_RESOURCES_INTERVAL_MS)
          } else {
            schedule.serverResourcesFailures += 1
            schedule.nextServerResourcesAt =
              Date.now() + resourcesFailureBackoffMs(schedule.serverResourcesFailures)
          }
        })
      )

      if (cancelled) return
      timer = window.setTimeout(
        runServerResourcesTick,
        schedulerTickMs(due.length === MONITORING_MAX_RESOURCES_BATCH)
      )
    }

    void runServerResourcesTick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [getSchedule, objectsKey, refreshServerResources])

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
        const retryOnUnstableLink =
          schedule.signalTier === 'degraded' ||
          schedule.signalTier === 'poor' ||
          Boolean(linkUnstableFlagsRef.current[targetId(object.id, 'link')])
        void retryMetricRequest(
          () =>
            previewCameras({
              id: object.id,
              host: object.serverHost,
              username: object.serverLogin,
              password: object.serverPassword,
              streamIds
            }),
          retryOnUnstableLink
        )
          .then((result) => {
            if (!mountedRef.current) return
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            console.log('[monitoring] preview result', result)
            if (!result.ok) {
              schedule.previewFailures += 1
              schedule.nextPreviewAt =
                Date.now() + metricFailureDelayMs(schedule.previewFailures, schedule.signalTier)
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
  }, [getSchedule, objectsKey, setSnapshot])

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
        const retryOnUnstableLink =
          schedule.signalTier === 'degraded' ||
          schedule.signalTier === 'poor' ||
          Boolean(linkUnstableFlagsRef.current[targetId(object.id, 'link')])
        void retryMetricRequest(
          () =>
            fetchMegaphoneStatuses({
              id: object.id,
              host: object.serverHost,
              username: object.serverLogin,
              password: object.serverPassword
            }),
          retryOnUnstableLink
        )
          .then((result) => {
            if (!mountedRef.current) return
            if ((probeEpochRef.current[object.id] ?? 0) !== epoch) return
            console.log('[monitoring] megaphone statuses result', result)
            if (!result.ok) {
              schedule.megaphoneStatusFailures += 1
              schedule.nextMegaphoneStatusAt =
                Date.now() +
                metricFailureDelayMs(schedule.megaphoneStatusFailures, schedule.signalTier)
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
  }, [getSchedule, objectsKey, setSnapshot])

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
                Date.now() + metricFailureDelayMs(schedule.deviceProbeFailures, schedule.signalTier)
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
  }, [getSchedule, objectsKey, setSnapshot])

  const refreshAllData = useCallback(async (): Promise<void> => {
    if (!snapshotRef.current.objects.length || manualRefreshInFlightRef.current) return

    manualRefreshInFlightRef.current = true
    setManualRefreshLoading(true)

    try {
      while (refreshingRef.current) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 100))
        if (!mountedRef.current) return
      }

      snapshotRef.current.objects.forEach((object) => {
        const schedule = getSchedule(object.id)
        schedule.nextLinkAt = 0
        schedule.nextServerAt = 0
        schedule.nextServerResourcesAt = 0
      })

      await refresh(true)

      const onlineObjects = snapshotRef.current.objects.filter(
        (object) =>
          isOnline(resultsRef.current[targetId(object.id, 'link')]) &&
          isOnline(resultsRef.current[targetId(object.id, 'server')])
      )
      await Promise.allSettled(
        onlineObjects.flatMap((object) =>
          (['cameras', 'megaphones', 'sensors'] as const).map((kind) =>
            refreshMetricBlock(object, kind)
          )
        )
      )
    } finally {
      manualRefreshInFlightRef.current = false
      if (mountedRef.current) setManualRefreshLoading(false)
    }
  }, [getSchedule, refresh, refreshMetricBlock])

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
      setCpuLoads((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setCpuTemps((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setGpuLoads((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setGpuTemps((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setRamLoads((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setServerResourcesLoading((prev) => clearIdFlag(prev, id))
      serverResourcesInFlightRef.current.delete(id)
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

  return {
    results,
    latencyHistory,
    linkStatusHistory,
    linkUnstableFlags,
    serverVersionErrors,
    cpuLoads,
    cpuTemps,
    gpuLoads,
    gpuTemps,
    ramLoads,
    serverResourcesLoading,
    camerasPreviewLoading,
    megaphonesStatusLoading,
    camerasMetricFailed,
    megaphonesMetricFailed,
    sensorsRefreshLoading,
    linkChecking,
    serverChecking,
    manualRefreshLoading,
    uiClock,
    refreshAllData,
    refreshMetricBlock,
    clearObjectResults
  }
}
