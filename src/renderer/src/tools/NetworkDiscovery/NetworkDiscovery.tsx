import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { ArrowPathIcon, RouterIcon } from '../../components/Icons'
import cameraIconUrl from '../../assets/monitoring/camera-icon.png'
import type { DiscoveryDevice, DiscoveryDeviceKind } from '@shared/api'
import { isPlaceholderDiscoveryBoard } from '@shared/discoveryBoard'

const ADDRESS_COL = 'w-44'
const CELL = 'px-4 py-2.5 text-[13.5px]'
const MONO_CELL = `${CELL} font-mono text-[12.5px] tabular-nums tracking-tight`

type VisibleDiscoveryKind = Exclude<DiscoveryDeviceKind, 'repka'>

type DiscoveryGroup = {
  id: VisibleDiscoveryKind
  title: string
  icon: ComponentType<{ className?: string }> | null
}

function CameraIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      className={`inline-block bg-current ${className}`}
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

const GROUPS: DiscoveryGroup[] = [
  {
    id: 'mikrotik',
    title: 'MikroTik',
    icon: RouterIcon
  },
  {
    id: 'cameras',
    title: 'Камеры',
    icon: CameraIcon
  },
  {
    id: 'other',
    title: 'Остальное',
    icon: null
  }
]

const ROW_MOTION_MS = 240

type AnimatedRow = {
  device: DiscoveryDevice
  phase: 'in' | 'out'
}

function rowKey(device: DiscoveryDevice): string {
  return `${device.kind}:${device.ip}`
}

function useAnimatedRows(rows: DiscoveryDevice[]): AnimatedRow[] {
  const [items, setItems] = useState<AnimatedRow[]>(() => rows.map((device) => ({ device, phase: 'in' })))
  const timersRef = useRef(new Map<string, number>())
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    const incoming = new Map(rows.map((device) => [rowKey(device), device]))
    const removed: string[] = []
    const next: AnimatedRow[] = []
    const seen = new Set<string>()

    for (const item of itemsRef.current) {
      const key = rowKey(item.device)
      const fresh = incoming.get(key)
      if (fresh) {
        seen.add(key)
        next.push({ device: fresh, phase: item.phase === 'out' ? 'in' : item.phase })
      } else if (item.phase !== 'out') {
        removed.push(key)
        next.push({ device: item.device, phase: 'out' })
      } else {
        next.push(item)
      }
    }
    for (const device of rows) {
      const key = rowKey(device)
      if (!seen.has(key)) next.push({ device, phase: 'in' })
    }

    setItems(next)

    for (const key of removed) {
      const pending = timersRef.current.get(key)
      if (pending) window.clearTimeout(pending)
      const timer = window.setTimeout(() => {
        timersRef.current.delete(key)
        setItems((current) =>
          current.filter((item) => rowKey(item.device) !== key || item.phase !== 'out')
        )
      }, ROW_MOTION_MS)
      timersRef.current.set(key, timer)
    }
  }, [rows])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
  }, [])

  return items
}

function shownName(value: string | null | undefined): string {
  const text = value?.trim() ?? ''
  if (!text || isPlaceholderDiscoveryBoard(text)) return ''
  return text
}

export function NetworkDiscovery() {
  const [devices, setDevices] = useState<DiscoveryDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scanGeneration = useRef(0)
  const rememberedFields = useRef(new Map<string, { name: string; board: string }>())

  const grouped = useMemo(() => {
    const byKind: Record<VisibleDiscoveryKind, DiscoveryDevice[]> = {
      mikrotik: [],
      cameras: [],
      other: []
    }
    const seen = new Set<string>()
    for (const device of devices) {
      const kind: VisibleDiscoveryKind = device.kind === 'repka' ? 'other' : device.kind
      byKind[kind].push(device)
      const key = `${device.kind}:${device.ip}`
      seen.add(key)
      const previous = rememberedFields.current.get(key)
      const name = device.name?.trim() ?? ''
      const board = device.board?.trim() ?? ''
      rememberedFields.current.set(key, {
        name: name && !isPlaceholderDiscoveryBoard(name) ? name : (previous?.name ?? ''),
        board: board && !isPlaceholderDiscoveryBoard(board) ? board : (previous?.board ?? '')
      })
    }
    for (const key of rememberedFields.current.keys()) {
      if (!seen.has(key)) rememberedFields.current.delete(key)
    }
    return byKind
  }, [devices])

  const mikrotikRows = useAnimatedRows(grouped.mikrotik)
  const cameraRows = useAnimatedRows(grouped.cameras)
  const otherRows = useAnimatedRows(grouped.other)
  const rowsByGroup: Record<VisibleDiscoveryKind, AnimatedRow[]> = {
    mikrotik: mikrotikRows,
    cameras: cameraRows,
    other: otherRows
  }
  const hasLiveRows = mikrotikRows.some((row) => row.phase === 'in')
    || cameraRows.some((row) => row.phase === 'in')
    || otherRows.some((row) => row.phase === 'in')

  const applyResult = useCallback((result: { ok: boolean; devices: DiscoveryDevice[]; error?: string }) => {
    if (!result.ok) {
      setError(result.error ?? 'Не удалось выполнить поиск')
      return
    }
    setError(null)
    setDevices(result.devices)
  }, [])

  const runScan = useCallback(async () => {
    if (!window.api?.discoveryScan) {
      setError('Поиск доступен только в приложении')
      setScanning(false)
      return
    }

    const generation = ++scanGeneration.current
    setScanning(true)

    try {
      const result = await window.api.discoveryScan()
      if (generation !== scanGeneration.current || result.cancelled) return
      applyResult(result)
    } catch {
      if (generation !== scanGeneration.current) return
      setError('Не удалось выполнить поиск')
    } finally {
      if (generation === scanGeneration.current) setScanning(false)
    }
  }, [applyResult])

  useEffect(() => {
    if (!window.api?.discoveryWatch) {
      void runScan()
      return () => {
        scanGeneration.current += 1
        void window.api?.discoveryCancel()
      }
    }

    const off = window.api.onDiscoveryUpdate((result) => {
      applyResult(result)
    })

    void window.api.discoveryWatch().then((result) => {
      if (result.cancelled) return
      applyResult(result)
    }).catch(() => {
      setError('Не удалось начать слежение')
    })

    return () => {
      off()
      scanGeneration.current += 1
      void window.api?.discoveryCancel()
    }
  }, [applyResult, runScan])

  return (
    <article style={{ paddingBottom: '50px' }} className="max-w-[68rem]">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="m-0 min-w-0 flex-1 text-[1.625rem] font-semibold tracking-tighter text-label-primary">
            Поиск устройств в сети
          </h1>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={scanning}
            aria-label="Обновить"
            title="Обновить"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-label-secondary transition-colors duration-200 hover:text-label-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60"
          >
            <ArrowPathIcon className={`h-7 w-7 ${scanning ? 'animate-spin' : 'discovery-refresh-spin'}`} />
          </button>
        </div>
      </header>

      {error ? (
        <aside className="mb-4 rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-[14px] text-red-400">
          <p className="m-0">{error}</p>
        </aside>
      ) : null}

      <div className={`relative ${hasLiveRows ? '' : 'min-h-[min(22rem,calc(100vh-18rem))]'}`}>
        {hasLiveRows ? null : (
          <p className="absolute inset-0 m-0 flex items-center justify-center text-center text-[15px] text-label-secondary">
            Поиск устройств
            <span className="discovery-ellipsis" aria-hidden>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        )}

      <div className="flex flex-col gap-5">
        {GROUPS.map((group) => {
          const Icon = group.icon
          const rows = rowsByGroup[group.id]
          if (rows.length === 0) return null
          return (
            <section key={group.id} aria-label={group.title}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] table-fixed border-collapse text-left">
                  <colgroup>
                    <col className={ADDRESS_COL} />
                    <col />
                    <col />
                  </colgroup>
                  <tbody>
                    {rows.map(({ device, phase }) => {
                        const rowBorder = phase === 'out' ? 'border-b border-transparent' : 'border-b border-surface-divider/40'
                        const remembered = rememberedFields.current.get(`${device.kind}:${device.ip}`)
                        const name = remembered ? remembered.name : device.name
                        const board = remembered ? remembered.board : device.board
                        const model = board?.trim() && !isPlaceholderDiscoveryBoard(board) ? board.trim() : ''
                        const label = shownName(name)
                        const boardLabel = model || label
                        const vendor = device.vendor?.trim() ?? ''
                        return (
                          <tr
                            key={`${device.kind}-${device.ip}`}
                            className={`hover:bg-white/[0.03] ${phase === 'out' ? 'discovery-row-out' : 'discovery-row-in'}`}
                          >
                            <td className={`${MONO_CELL} ${ADDRESS_COL} ${rowBorder}`}>
                              <div className="truncate text-label-primary">{device.ip}</div>
                              {device.mac?.trim() ? (
                                <div className="mt-0.5 truncate text-[11.5px] text-label-tertiary">{device.mac}</div>
                              ) : null}
                            </td>
                            <td className={`${CELL} ${rowBorder}`}>
                              {vendor || Icon ? (
                                <div className="flex items-center gap-1.5">
                                  {Icon ? <Icon className="h-4 w-4 shrink-0 text-label-secondary" /> : null}
                                  {vendor ? <div className="min-w-0 text-label-primary">{vendor}</div> : null}
                                </div>
                              ) : null}
                              {boardLabel ? (
                                <div
                                  className={
                                    vendor || Icon
                                      ? 'mt-0.5 font-mono text-[11.5px] text-label-tertiary'
                                      : 'font-mono text-[12.5px] text-label-primary'
                                  }
                                >
                                  {boardLabel}
                                </div>
                              ) : null}
                            </td>
                            <td className={`${CELL} text-label-primary ${rowBorder}`}>{model ? label : ''}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
      </div>
    </article>
  )
}
