/**
 * Preload bridge: exposes typed window.api via contextBridge.
 * Renderer must not import Node/Electron APIs directly.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/api'

const api: ElectronAPI = {
  getManifest: () => ipcRenderer.invoke('content:get-manifest'),

  getArticleHtml: (htmlFile: string) => ipcRenderer.invoke('content:get-article-html', htmlFile),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  onContentUpdated: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('content:updated', handler)
    return () => ipcRenderer.off('content:updated', handler)
  },

  onAppUpdateAvailable: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:update-available', handler)
    return () => ipcRenderer.off('app:update-available', handler)
  },

  onAppUpdateDownloadProgress: (cb) => {
    const handler = (_: unknown, percent: number): void => cb(percent)
    ipcRenderer.on('app:update-download-progress', handler)
    return () => ipcRenderer.off('app:update-download-progress', handler)
  },

  onAppUpdateDownloaded: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:update-downloaded', handler)
    return () => ipcRenderer.off('app:update-downloaded', handler)
  },

  onAppUpdateError: (cb) => {
    const handler = (_: unknown, message: string): void => cb(message)
    ipcRenderer.on('app:update-error', handler)
    return () => ipcRenderer.off('app:update-error', handler)
  },

  startAppUpdateDownload: () => ipcRenderer.invoke('app:start-update-download'),

  installAppUpdate: () => ipcRenderer.invoke('app:install-update'),

  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),

  winboxOpen: () => ipcRenderer.invoke('winbox:open'),
  winboxGetLocalStatus: () => ipcRenderer.invoke('winbox:get-local-status'),
  winboxCheckUpdate: () => ipcRenderer.invoke('winbox:check-update'),
  winboxDownloadBundled: () => ipcRenderer.invoke('winbox:download-bundled'),
  winboxOpenDownloadPage: () => ipcRenderer.invoke('winbox:open-download-page'),

  monitoringPing: (targets) => ipcRenderer.invoke('monitoring:ping', targets),
  monitoringHttpProbe: (targets) => ipcRenderer.invoke('monitoring:http-probe', targets),
  monitoringFetchVersion: (request) => ipcRenderer.invoke('monitoring:fetch-version', request),
  monitoringFetchServerResources: (request) =>
    ipcRenderer.invoke('monitoring:fetch-server-resources', request),
  monitoringFetchStreams: (request) => ipcRenderer.invoke('monitoring:fetch-streams', request),
  monitoringFetchLocations: (request) => ipcRenderer.invoke('monitoring:fetch-locations', request),
  monitoringPreviewCameras: (request) => ipcRenderer.invoke('monitoring:preview-cameras', request),
  monitoringFetchMegaphones: (request) => ipcRenderer.invoke('monitoring:fetch-megaphones', request),
  monitoringFetchMegaphoneStatuses: (request) =>
    ipcRenderer.invoke('monitoring:fetch-megaphone-statuses', request),
  monitoringFetchDevices: (request) => ipcRenderer.invoke('monitoring:fetch-devices', request),
  monitoringProbeDevices: (request) => ipcRenderer.invoke('monitoring:probe-devices', request)
}

contextBridge.exposeInMainWorld('api', api)
