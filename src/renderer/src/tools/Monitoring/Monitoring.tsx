import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'
import { ArrowPathIcon, XMarkIcon } from '../../components/Icons'
import {
  compareMonitoringObjectsByDigits,
  loadMonitoringSnapshot,
  saveMonitoringSnapshot,
  type MonitoringObject
} from './monitoringStorage'
import { applyResolvedObjectKind, MONITORING_OBJECT_KIND_SUMMARY_LABELS } from './monitoringObjectKind'
import {
  groupHealthByObjectKind,
  HEALTH_COLORS,
  HEALTH_LABELS,
  resolveObjectHealthFromProbes,
  type MonitoringObjectHealth,
  type SummaryHealthFilter
} from './monitoringObjectHealth'
import type {
  EditorState,
  MonitoringViewMode,
  ServerResourceStubs
} from './monitoringTypes'
import { ObjectEditorModal } from './components/ObjectEditorModal'
import {
  MonitoringDebugObjectCard,
  MonitoringObjectCard
} from './components/MonitoringObjectCard'
import { MetricHoverTooltip } from './components/MonitoringMetricStatus'
import { MonitoringSummaryStats } from './components/MonitoringSummaryStats'
import { recentPacketLossPercent } from './monitoringSchedule'
import { useMonitoringProbes } from './hooks/useMonitoringProbes'

function targetId(objectId: string, kind: 'link' | 'server'): string {
  return `${objectId}:${kind}`
}

function clearCachedMetricCounts(object: MonitoringObject): MonitoringObject {
  const next = { ...object }
  delete next.camerasOnline
  delete next.camerasOnlineIds
  delete next.megaphonesOnline
  delete next.megaphonesOnlineIds
  return next
}

function CardsViewIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function TableViewIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="16" height="3.5" rx="1.5" />
      <rect x="2" y="8.25" width="16" height="3.5" rx="1.5" />
      <rect x="2" y="13.5" width="16" height="3.5" rx="1.5" />
    </svg>
  )
}

function ToolbarIconButton({
  hint,
  children,
  onMouseEnter,
  onMouseLeave,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { hint: string; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = useState(false)

  return (
    <>
      <button
        ref={ref}
        {...props}
        onMouseEnter={(event) => {
          onMouseEnter?.(event)
          setHovered(true)
        }}
        onMouseLeave={(event) => {
          onMouseLeave?.(event)
          setHovered(false)
        }}
      >
        {children}
      </button>
      {hovered ? (
        <MetricHoverTooltip compact anchorEl={ref.current}>
          <p className="m-0 text-[13px] font-medium leading-snug text-label-primary">{hint}</p>
        </MetricHoverTooltip>
      ) : null}
    </>
  )
}

function SummaryStatsIcon() {
  const radius = 6.8
  const circumference = 2 * Math.PI * radius
  const segments = [
    { share: 0.42, opacity: 1 },
    { share: 0.28, opacity: 0.55 },
    { share: 0.3, opacity: 0.28 }
  ]
  let offset = 0

  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 -rotate-90" fill="none" aria-hidden>
      {segments.map((segment) => {
        const length = segment.share * circumference
        const circle = (
          <circle
            key={segment.opacity}
            cx="10"
            cy="10"
            r={radius}
            stroke="currentColor"
            strokeWidth="3.4"
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            opacity={segment.opacity}
          />
        )
        offset += length
        return circle
      })}
    </svg>
  )
}

const EMPTY_SERVER_RESOURCES: ServerResourceStubs = {
  cpuLoad: null,
  cpuTempC: null,
  gpuLoad: null,
  gpuTempC: null,
  ramLoad: null,
  uptimeDays: null
}

/** Temporary sample card for the new layout — remove after QA. */
const SHOW_MONITORING_DEBUG_CARD = false
const DEBUG_LAN_OBJECT_CODE = 'owl9999'

const MONITORING_VIEW_MODE_KEY = 'monitoring-view-mode'
const MONITORING_SUMMARY_STATS_KEY = 'monitoring-summary-stats'

export function Monitoring({ screenActive = true }: { screenActive?: boolean }) {
  const [snapshot, setSnapshot] = useState(() => {
    const loaded = loadMonitoringSnapshot()
    return { objects: loaded.objects.map(clearCachedMetricCounts).map(applyResolvedObjectKind) }
  })
  const [viewMode, setViewMode] = useState<MonitoringViewMode>(() => {
    try {
      return window.localStorage.getItem(MONITORING_VIEW_MODE_KEY) === 'table' ? 'table' : 'cards'
    } catch {
      return 'cards'
    }
  })
  const [summaryStatsOpen, setSummaryStatsOpen] = useState(() => {
    try {
      return window.localStorage.getItem(MONITORING_SUMMARY_STATS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [summaryFilter, setSummaryFilter] = useState<SummaryHealthFilter | null>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const {
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
    clearObjectResults,
    lanActiveObjectId
  } = useMonitoringProbes({ snapshot, setSnapshot, screenActive })

  const lanActiveObject = useMemo(
    () =>
      lanActiveObjectId
        ? snapshot.objects.find((object) => object.id === lanActiveObjectId) ?? null
        : null,
    [lanActiveObjectId, snapshot.objects]
  )
  const lanBannerCode = SHOW_MONITORING_DEBUG_CARD
    ? DEBUG_LAN_OBJECT_CODE
    : lanActiveObject
      ? lanActiveObject.code.replace(/\/$/, '')
      : null

  useEffect(() => {
    try {
      window.localStorage.setItem(MONITORING_VIEW_MODE_KEY, viewMode)
    } catch {
      // The view still works when persistent storage is unavailable.
    }
  }, [viewMode])

  useEffect(() => {
    try {
      window.localStorage.setItem(MONITORING_SUMMARY_STATS_KEY, summaryStatsOpen ? '1' : '0')
    } catch {
      // The toggle still works when persistent storage is unavailable.
    }
  }, [summaryStatsOpen])

  const editingObject = useMemo(
    () => (editor?.mode === 'edit' && editor.objectId ? snapshot.objects.find((object) => object.id === editor.objectId) ?? null : null),
    [editor, snapshot.objects]
  )

  const healthById = useMemo(() => {
    const next: Record<string, MonitoringObjectHealth | null> = {}
    for (const object of snapshot.objects) {
      next[object.id] = resolveObjectHealthFromProbes(object, results, {
        serverVersionError: serverVersionErrors[object.id],
        camerasMetricFailed: camerasMetricFailed[object.id],
        megaphonesMetricFailed: megaphonesMetricFailed[object.id],
        cpuLoad: cpuLoads[object.id],
        cpuTempC: cpuTemps[object.id],
        gpuLoad: gpuLoads[object.id],
        gpuTempC: gpuTemps[object.id],
        ramLoad: ramLoads[object.id]
      })
    }
    return next
  }, [
    camerasMetricFailed,
    cpuLoads,
    cpuTemps,
    gpuLoads,
    gpuTemps,
    megaphonesMetricFailed,
    ramLoads,
    results,
    serverVersionErrors,
    snapshot.objects
  ])

  const summaryGroups = useMemo(
    () => (summaryStatsOpen ? groupHealthByObjectKind(snapshot.objects, healthById) : []),
    [healthById, snapshot.objects, summaryStatsOpen]
  )

  const sortedObjects = useMemo(() => {
    const sorted = [...snapshot.objects].sort(compareMonitoringObjectsByDigits)
    if (!lanActiveObjectId) return sorted
    const activeIndex = sorted.findIndex((object) => object.id === lanActiveObjectId)
    if (activeIndex <= 0) return sorted
    const [active] = sorted.splice(activeIndex, 1)
    return [active, ...sorted]
  }, [lanActiveObjectId, snapshot.objects])

  const visibleObjects = useMemo(() => {
    if (!summaryFilter) return sortedObjects
    return sortedObjects.filter((object) => {
      if (object.objectKind !== summaryFilter.kind) return false
      if (!summaryFilter.health) return true
      return healthById[object.id] === summaryFilter.health
    })
  }, [healthById, sortedObjects, summaryFilter])

  const selectSummaryFilter = useCallback((filter: SummaryHealthFilter): void => {
    setSummaryFilter((prev) =>
      prev && prev.kind === filter.kind && prev.health === filter.health ? null : filter
    )
  }, [])

  useEffect(() => {
    saveMonitoringSnapshot(snapshot)
  }, [snapshot])

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
          return applyResolvedObjectKind({
            ...next,
            id: originalId,
            code: object.code,
            objectKind: next.objectKind,
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
            ...(sameCredentials && object.guardDevices
              ? {
                  guardDevices: object.guardDevices,
                  ...(object.devicesOnline !== undefined ? { devicesOnline: object.devicesOnline } : {}),
                  ...(object.devicesOnlineIds !== undefined
                    ? { devicesOnlineIds: object.devicesOnlineIds }
                    : {})
                }
              : {})
          })
        })
      } else if (prev.objects.some((object) => object.id === next.id)) {
        return false
      } else {
        nextObjects = [...prev.objects, applyResolvedObjectKind(next)]
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
          {lanBannerCode
            ? `Локальное подключение к ${lanBannerCode}. Мониторинг остальных объектов на паузе`
            : 'Для работы инструмента необходимо подключиться к VPN'}
        </p>
      </header>

      <ObjectEditorModal
        editor={editor}
        object={editingObject}
        onClose={closeEditor}
        onSave={saveObject}
        onDelete={deleteObject}
      />

      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <ToolbarIconButton
            type="button"
            hint="Сводная статистика"
            onClick={() => setSummaryStatsOpen((prev) => !prev)}
            aria-label="Сводная статистика"
            aria-pressed={summaryStatsOpen}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-label-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 ${
              summaryStatsOpen ? 'bg-white/[0.06] text-tint-blue' : 'hover:text-label-secondary'
            }`}
          >
            <SummaryStatsIcon />
          </ToolbarIconButton>
          {summaryStatsOpen ? (
            <>
              <span className="min-w-0 truncate text-[12px] font-medium text-label-secondary">
                {summaryFilter ? (
                  <>
                    {MONITORING_OBJECT_KIND_SUMMARY_LABELS[summaryFilter.kind]}
                    {summaryFilter.health ? (
                      <>
                        <span className="text-label-tertiary"> · </span>
                        <span className={HEALTH_COLORS[summaryFilter.health]}>
                          {HEALTH_LABELS[summaryFilter.health]}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  'Все объекты'
                )}
              </span>
              {summaryFilter ? (
                <ToolbarIconButton
                  type="button"
                  hint="Сбросить"
                  onClick={() => setSummaryFilter(null)}
                  aria-label="Сбросить фильтр"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-label-tertiary transition-colors hover:bg-white/[0.06] hover:text-label-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </ToolbarIconButton>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <ToolbarIconButton
            type="button"
            hint="Обновить все данные"
            onClick={() => void refreshAllData()}
            aria-label="Обновить все данные"
            aria-busy={manualRefreshLoading}
            disabled={manualRefreshLoading || sortedObjects.length === 0}
            className="flex h-6 w-6 items-center justify-center rounded text-label-tertiary transition-colors hover:text-label-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 disabled:cursor-default disabled:opacity-40"
          >
            <ArrowPathIcon className={`h-4 w-4 ${manualRefreshLoading ? 'animate-spin' : ''}`} />
          </ToolbarIconButton>
          <div
            className="flex items-center gap-0.5"
            role="group"
            aria-label="Вид карточек"
          >
            <ToolbarIconButton
              type="button"
              hint="Карточки"
              onClick={() => setViewMode('cards')}
              aria-label="Карточки"
              aria-pressed={viewMode === 'cards'}
              className={`flex h-6 w-6 items-center justify-center rounded text-label-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 ${
                viewMode === 'cards' ? 'bg-white/[0.06] text-tint-blue' : 'hover:text-label-secondary'
              }`}
            >
              <CardsViewIcon />
            </ToolbarIconButton>
            <ToolbarIconButton
              type="button"
              hint="Табличный вид"
              onClick={() => setViewMode('table')}
              aria-label="Табличный вид"
              aria-pressed={viewMode === 'table'}
              className={`flex h-6 w-6 items-center justify-center rounded text-label-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 ${
                viewMode === 'table' ? 'bg-white/[0.06] text-tint-blue' : 'hover:text-label-secondary'
              }`}
            >
              <TableViewIcon />
            </ToolbarIconButton>
          </div>
        </div>
      </div>

      {summaryStatsOpen ? (
        <MonitoringSummaryStats
          groups={summaryGroups}
          selected={summaryFilter}
          onSelect={selectSummaryFilter}
        />
      ) : null}

      <div className={`grid ${viewMode === 'table' ? 'gap-3' : 'gap-4 lg:grid-cols-2'}`}>
        {SHOW_MONITORING_DEBUG_CARD ? (
          <MonitoringDebugObjectCard now={uiClock} compact={viewMode === 'table'} />
        ) : null}
        {visibleObjects.map((object) => (
          <MonitoringObjectCard
            key={object.id}
            object={object}
            results={results}
            latencyHistory={latencyHistory}
            linkPacketLossPercent={recentPacketLossPercent(
              linkStatusHistory[targetId(object.id, 'link')]
            )}
            linkUnstable={Boolean(linkUnstableFlags[targetId(object.id, 'link')])}
            checkingLink={Boolean(linkChecking[object.id])}
            checkingServer={Boolean(serverChecking[object.id])}
            serverVersion={object.serverVersion ?? null}
            serverVersionError={serverVersionErrors[object.id] ?? null}
            serverResources={{
              ...EMPTY_SERVER_RESOURCES,
              cpuLoad: cpuLoads[object.id] ?? null,
              cpuTempC: cpuTemps[object.id] ?? null,
              gpuLoad: gpuLoads[object.id] ?? null,
              gpuTempC: gpuTemps[object.id] ?? null,
              ramLoad: ramLoads[object.id] ?? null,
              loading:
                Boolean(serverResourcesLoading[object.id]) &&
                cpuLoads[object.id] == null &&
                gpuLoads[object.id] == null &&
                ramLoads[object.id] == null
            }}
            camerasPreviewLoading={Boolean(camerasPreviewLoading[object.id])}
            megaphonesStatusLoading={Boolean(megaphonesStatusLoading[object.id])}
            camerasMetricFailed={Boolean(camerasMetricFailed[object.id])}
            megaphonesMetricFailed={Boolean(megaphonesMetricFailed[object.id])}
            sensorsRefreshLoading={Boolean(sensorsRefreshLoading[object.id])}
            now={uiClock}
            onEdit={openEditEditor}
            onRefreshMetric={
              SHOW_MONITORING_DEBUG_CARD || (lanActiveObjectId && lanActiveObjectId !== object.id)
                ? undefined
                : refreshMetricBlock
            }
            probePaused={
              SHOW_MONITORING_DEBUG_CARD ||
              Boolean(lanActiveObjectId && lanActiveObjectId !== object.id)
            }
            lanActive={!SHOW_MONITORING_DEBUG_CARD && lanActiveObjectId === object.id}
            compact={viewMode === 'table'}
          />
        ))}
      </div>

      {visibleObjects.length === 0 && (
        <p className="mt-6 text-center text-[15px] font-medium text-label-secondary">
          {snapshot.objects.length === 0
            ? 'Нет объектов для отслеживания'
            : 'Нет объектов с таким статусом'}
        </p>
      )}
    </article>
  )
}
