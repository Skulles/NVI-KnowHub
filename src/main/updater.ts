/**
 * electron-updater wiring: check / download / install app updates
 * and notify the renderer over IPC.
 */
import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, ipcMain } from 'electron'
import { logger } from './logger'

let quittingForUpdate = false
let targetWindow: BrowserWindow | null = null
let ipcRegistered = false

export function isQuittingForUpdate(): boolean {
  return quittingForUpdate
}

function send(channel: string, ...args: unknown[]): void {
  const window = targetWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, ...args)
}

export function setupUpdater(window: BrowserWindow): void {
  targetWindow = window

  if (!app.isPackaged) return

  if (!ipcRegistered) {
    ipcRegistered = true

    // Скачиваем в фоне; UI показывает тост только после download-complete.
    autoUpdater.autoDownload = true
    // На macOS Squirrel должен забрать zip во время downloadUpdate(), иначе quitAndInstall() молча не сработает.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = true

    autoUpdater.on('update-available', () => {
      send('app:update-available')
    })

    autoUpdater.on('download-progress', (progress) => {
      send('app:update-download-progress', progress.percent)
    })

    autoUpdater.on('update-downloaded', () => {
      send('app:update-downloaded')
    })

    autoUpdater.on('error', (err) => {
      logger.error('Updater error', err)
      send('app:update-error', err.message)
    })

    ipcMain.handle('app:start-update-download', async () => {
      try {
        await autoUpdater.downloadUpdate()
        return { ok: true as const }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('Update download failed', err)
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
      logger.error('Update check failed', err)
    })
  }
}
