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
}

export type MonitoringPingStatus = 'online' | 'offline' | 'error'

export interface MonitoringPingResult {
  id: string
  host: string
  label: string
  status: MonitoringPingStatus
  latencyMs: number | null
  checkedAt: number
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
  winboxCheckUpdate(): Promise<WinboxUpdateInfo>
  /** Скачать WinBox с CDN MikroTik в resources/winbox/ (тот же путь, что для «Открыть»). */
  winboxDownloadBundled(): Promise<{ ok: boolean; error?: string }>
  winboxOpenDownloadPage(): Promise<{ ok: boolean }>
  monitoringPing(targets: MonitoringPingTarget[]): Promise<MonitoringPingResult[]>
}
