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

export interface ElectronAPI {
  getManifest(): Promise<ContentManifest | null>
  getArticleHtml(htmlFile: string): Promise<string | null>
  getAppVersion(): Promise<string>
  onContentUpdated(cb: () => void): () => void
  onAppUpdateAvailable(cb: (version: string) => void): () => void
  onAppUpdateDownloaded(cb: () => void): () => void
  installAppUpdate(): void
  winboxOpen(): Promise<{ ok: boolean; error?: string }>
  winboxCheckUpdate(): Promise<WinboxUpdateInfo>
  /** Скачать WinBox с CDN MikroTik в resources/winbox/ (тот же путь, что для «Открыть»). */
  winboxDownloadBundled(): Promise<{ ok: boolean; error?: string }>
  winboxOpenDownloadPage(): Promise<{ ok: boolean }>
}
