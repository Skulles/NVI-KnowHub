import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '../../components/Icons'
import {
  compareMonitoringObjectsByDigits,
  loadMonitoringSnapshot,
  saveMonitoringSnapshot,
  type MonitoringObject
} from './monitoringStorage'
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

const MONITORING_VIEW_MODE_KEY = 'monitoring-view-mode'

export function Monitoring() {
  const [snapshot, setSnapshot] = useState(() => {
    const loaded = loadMonitoringSnapshot()
    return { objects: loaded.objects.map(clearCachedMetricCounts) }
  })
  const [viewMode, setViewMode] = useState<MonitoringViewMode>(() => {
    try {
      return window.localStorage.getItem(MONITORING_VIEW_MODE_KEY) === 'table' ? 'table' : 'cards'
    } catch {
      return 'cards'
    }
  })
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
    clearObjectResults
  } = useMonitoringProbes({ snapshot, setSnapshot })

  useEffect(() => {
    try {
      window.localStorage.setItem(MONITORING_VIEW_MODE_KEY, viewMode)
    } catch {
      // The view still works when persistent storage is unavailable.
    }
  }, [viewMode])

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

      <div className="mb-2 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => void refreshAllData()}
          aria-label="Обновить все данные"
          aria-busy={manualRefreshLoading}
          disabled={manualRefreshLoading || sortedObjects.length === 0}
          title="Обновить все данные"
          className="flex h-6 w-6 items-center justify-center rounded text-label-tertiary transition-colors hover:text-label-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 disabled:cursor-default disabled:opacity-40"
        >
          <ArrowPathIcon className={`h-4 w-4 ${manualRefreshLoading ? 'animate-spin' : ''}`} />
        </button>
        <div
          className="flex items-center gap-0.5"
          role="group"
          aria-label="Вид карточек"
        >
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            aria-label="Карточки"
            aria-pressed={viewMode === 'cards'}
            className={`flex h-6 w-6 items-center justify-center rounded text-label-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 ${
              viewMode === 'cards' ? 'bg-white/[0.06] text-tint-blue' : 'hover:text-label-secondary'
            }`}
          >
            <CardsViewIcon />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            aria-label="Табличный вид"
            aria-pressed={viewMode === 'table'}
            className={`flex h-6 w-6 items-center justify-center rounded text-label-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 ${
              viewMode === 'table' ? 'bg-white/[0.06] text-tint-blue' : 'hover:text-label-secondary'
            }`}
          >
            <TableViewIcon />
          </button>
        </div>
      </div>

      <div className={`grid ${viewMode === 'table' ? 'gap-3' : 'gap-4 lg:grid-cols-2'}`}>
        {SHOW_MONITORING_DEBUG_CARD ? (
          <MonitoringDebugObjectCard now={uiClock} compact={viewMode === 'table'} />
        ) : null}
        {sortedObjects.map((object) => (
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
            onRefreshMetric={refreshMetricBlock}
            compact={viewMode === 'table'}
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
