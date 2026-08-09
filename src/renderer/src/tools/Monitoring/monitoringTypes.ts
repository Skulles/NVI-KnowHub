import type { MonitoringPingResult } from '@shared/api'
import type { LinkStatusSample } from './monitoringSchedule'

export type ResultMap = Record<string, MonitoringPingResult>
export type LatencyHistoryMap = Record<string, number[]>
export type LinkStatusHistoryMap = Record<string, LinkStatusSample[]>
export type VersionErrorMap = Record<string, string>
export type IdFlagMap = Record<string, boolean>
export type EditorState = { mode: 'add' | 'edit'; objectId?: string } | null
export type MonitoringMetricKind = 'cameras' | 'megaphones' | 'sensors'
export type MonitoringViewMode = 'cards' | 'table'

/** Host metrics shown under the OWL.Guard server status. */
export type ServerResourceStubs = {
  cpuLoad: number | null
  loading?: boolean
  cpuTempC: number | null
  gpuLoad: number | null
  gpuTempC: number | null
  ramLoad: number | null
  /** Uptime in whole days. */
  uptimeDays: number | null
}
