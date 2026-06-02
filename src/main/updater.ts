import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow } from 'electron'

export function setupUpdater(window: BrowserWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    window.webContents.send('app:update-available', info.version)
  })

  autoUpdater.on('update-downloaded', () => {
    window.webContents.send('app:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('Updater error:', err)
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Update check failed:', err)
  })
}
