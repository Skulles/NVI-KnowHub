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
    const handler = (_: unknown, version: string): void => cb(version)
    ipcRenderer.on('app:update-available', handler)
    return () => ipcRenderer.off('app:update-available', handler)
  },

  onAppUpdateDownloaded: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:update-downloaded', handler)
    return () => ipcRenderer.off('app:update-downloaded', handler)
  },

  installAppUpdate: () => ipcRenderer.send('app:install-update'),

  winboxOpen: () => ipcRenderer.invoke('winbox:open'),
  winboxCheckUpdate: () => ipcRenderer.invoke('winbox:check-update'),
  winboxDownloadBundled: () => ipcRenderer.invoke('winbox:download-bundled'),
  winboxOpenDownloadPage: () => ipcRenderer.invoke('winbox:open-download-page')
}

contextBridge.exposeInMainWorld('api', api)
