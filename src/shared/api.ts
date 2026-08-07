/**
 * Contract for window.api (preload → renderer) and related IPC result types.
 */
import type { ContentManifest } from './types'

export interface WinboxUpdateInfo {
  latest: string
  local: string
  hasUpdate: boolean
  bundled: boolean
  /** Страница загрузки WinBox ответила успешно — можно открыть сайт для скачивания */
  mikrotikOnline: boolean
  /** Ожидаемое имя файла (или WinBox.app) в resources/winbox/ для текущей ОС */
  bundledExpectedName: string
}

export interface MonitoringPingTarget {
  id: string
  host: string
  label: string
  /** Send one packet for an immediate first result (used during initial loading). */
  fast?: boolean
}

export type MonitoringPingStatus = 'online' | 'offline' | 'error'

export interface MonitoringPingResult {
  id: string
  host: string
  label: string
  status: MonitoringPingStatus
  latencyMs: number | null
  /** Successful ICMP replies received for this probe. */
  replyCount?: number
  /** ICMP packets sent for this probe. */
  sentCount?: number
  checkedAt: number
  error?: string
}

/** HTTP probe target (OWL.Guard availability check). */
export interface MonitoringHttpTarget {
  id: string
  host: string
  label: string
}

export interface MonitoringHttpResult {
  id: string
  host: string
  label: string
  ok: boolean
  statusCode: number | null
  checkedAt: number
  error?: string
}

/** Shared OWL.Guard credentials for authenticated monitoring calls. */
export interface MonitoringAuthRequest {
  id: string
  host: string
  username: string
  password: string
}

/** Authenticate to OWL.Guard and fetch Configuration/version. */
export type MonitoringVersionRequest = MonitoringAuthRequest

export interface MonitoringVersionResult {
  id: string
  host: string
  ok: boolean
  version: string | null
  error?: string
}

/** Camera stream config from /gateway/config/streams. */
export interface MonitoringCameraStream {
  id: number
  connected?: boolean
  expectedImageSize?: {
    width?: number
    height?: number
  }
  stream?: {
    url?: string | null
    onvif?: unknown
    locationId?: number | null
  }
}

export interface MonitoringStreamsResult {
  id: string
  host: string
  ok: boolean
  streams: MonitoringCameraStream[]
  error?: string
}

/** Location entry from /gateway/config/core/locations. */
export interface MonitoringLocation {
  id: number
  localizedName: string
  parentId?: number | null
}

export interface MonitoringLocationsResult {
  id: string
  host: string
  ok: boolean
  locations: MonitoringLocation[]
  error?: string
}

export interface MonitoringPreviewRequest extends MonitoringAuthRequest {
  streamIds: number[]
}

export interface MonitoringPreviewResult {
  id: string
  host: string
  ok: boolean
  onlineCount: number
  /** Stream IDs present in the PreviewV2 response (online cameras). */
  onlineIds: number[]
  error?: string
}

/** Count-only result (legacy). Prefer typed list/status results below. */
export interface MonitoringCountResult {
  id: string
  host: string
  ok: boolean
  count: number
  error?: string
}

/** Megaphone config from /gateway/config/core/megaphones. */
export interface MonitoringMegaphone {
  id: number
  address?: string
  locationIds: number[]
}

export interface MonitoringMegaphonesResult {
  id: string
  host: string
  ok: boolean
  megaphones: MonitoringMegaphone[]
  error?: string
}

export interface MonitoringMegaphoneStatusesResult {
  id: string
  host: string
  ok: boolean
  onlineCount: number
  /** Megaphone IDs present in statuses/V2 (online). */
  onlineIds: number[]
  error?: string
}

/** Guard device / sensor source from /gateway/config/guard/devices. */
export interface MonitoringGuardDevice {
  id: number
  type: string
  address: string | null
  logicalAddress: number
  useRtuOverTcp: boolean
  startRegister: number
  numRegisters: number
  login: string
  password: string
  wellUid: string
  wellBoreUid: string
}

export interface MonitoringDevicesResult {
  id: string
  host: string
  ok: boolean
  devices: MonitoringGuardDevice[]
  error?: string
}

/** Body fields for POST /gateway/Telemetry/probe (from a guard device). */
export interface MonitoringDeviceProbeBody {
  type: string
  address: string
  logicalAddress: number
  useRtuOverTcp: boolean
  startRegister: number
  numRegisters: number
  login: string
  password: string
  wellUid: string
  wellBoreUid: string
}

export interface MonitoringDeviceProbeRequest extends MonitoringAuthRequest {
  devices: MonitoringGuardDevice[]
}

export interface MonitoringDeviceProbeResult {
  id: string
  host: string
  ok: boolean
  onlineCount: number
  /** Device IDs where Telemetry/probe returned connected: true. */
  onlineIds: number[]
  error?: string
}

export interface ElectronAPI {
  getManifest(): Promise<ContentManifest | null>
  getArticleHtml(htmlFile: string): Promise<string | null>
  getAppVersion(): Promise<string>
  onContentUpdated(cb: () => void): () => void
  onAppUpdateAvailable(cb: () => void): () => void
  onAppUpdateDownloadProgress(cb: (percent: number) => void): () => void
  onAppUpdateDownloaded(cb: () => void): () => void
  onAppUpdateError(cb: (message: string) => void): () => void
  startAppUpdateDownload(): Promise<{ ok: boolean; error?: string }>
  installAppUpdate(): Promise<{ ok: boolean }>
  openExternal(url: string): Promise<{ ok: boolean }>
  winboxOpen(): Promise<{ ok: boolean; error?: string }>
  /** Локальный статус без сети (есть ли exe в resources/userData). */
  winboxGetLocalStatus(): Promise<{ bundled: boolean; bundledExpectedName: string }>
  winboxCheckUpdate(): Promise<WinboxUpdateInfo>
  /** Скачать WinBox с CDN MikroTik в resources/winbox/ (тот же путь, что для «Открыть»). */
  winboxDownloadBundled(): Promise<{ ok: boolean; error?: string }>
  winboxOpenDownloadPage(): Promise<{ ok: boolean }>
  monitoringPing(targets: MonitoringPingTarget[]): Promise<MonitoringPingResult[]>
  monitoringHttpProbe(targets: MonitoringHttpTarget[]): Promise<MonitoringHttpResult[]>
  monitoringFetchVersion(request: MonitoringVersionRequest): Promise<MonitoringVersionResult>
  monitoringFetchStreams(request: MonitoringAuthRequest): Promise<MonitoringStreamsResult>
  monitoringFetchLocations(request: MonitoringAuthRequest): Promise<MonitoringLocationsResult>
  monitoringPreviewCameras(request: MonitoringPreviewRequest): Promise<MonitoringPreviewResult>
  monitoringFetchMegaphones(request: MonitoringAuthRequest): Promise<MonitoringMegaphonesResult>
  monitoringFetchMegaphoneStatuses(request: MonitoringAuthRequest): Promise<MonitoringMegaphoneStatusesResult>
  monitoringFetchDevices(request: MonitoringAuthRequest): Promise<MonitoringDevicesResult>
  monitoringProbeDevices(request: MonitoringDeviceProbeRequest): Promise<MonitoringDeviceProbeResult>
}
