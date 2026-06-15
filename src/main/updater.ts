import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, ipcMain } from 'electron'

let quittingForUpdate = false

export function isQuittingForUpdate(): boolean {
  return quittingForUpdate
}

export function setupUpdater(window: BrowserWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  // На macOS Squirrel должен забрать zip во время downloadUpdate(), иначе quitAndInstall() молча не сработает.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true

  autoUpdater.on('update-available', () => {
    window.webContents.send('app:update-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    window.webContents.send('app:update-download-progress', progress.percent)
  })

  autoUpdater.on('update-downloaded', () => {
    window.webContents.send('app:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('Updater error:', err)
    window.webContents.send('app:update-error', err.message)
  })

  ipcMain.handle('app:start-update-download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: message }
    }
  })

  ipcMain.handle('app:install-update', () => {
    quittingForUpdate = true
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true)
    })
    return { ok: true as const }
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Update check failed:', err)
  })
}
