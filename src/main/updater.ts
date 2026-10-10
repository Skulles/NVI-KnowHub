/**
 * electron-updater wiring: check / download / install app updates
 * and notify the renderer over IPC.
 */
import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, ipcMain, net } from 'electron'

import { logger } from './logger'
import { installParallelUpdateDownloader } from './parallelDownload'

const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000

let quittingForUpdate = false
let targetWindow: BrowserWindow | null = null
let ipcRegistered = false
let downloadInProgress = false
let downloadedVersion: string | null = null
let notifiedAvailableVersion: string | null = null
let notifiedDownloadedVersion: string | null = null

export function isQuittingForUpdate(): boolean {
  return quittingForUpdate
}

function send(channel: string, ...args: unknown[]): void {
  const window = targetWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, ...args)
}

function isOfflineUpdateError(err: unknown): boolean {
  if (!net.isOnline()) return true
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /net::ERR_|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|offline|network|socket hang up|getaddrinfo/i.test(
    message
  )
}

function reportUpdateError(err: unknown): void {
  logger.error('Updater error', err)
  // Без сети тост только мешает: кнопки снова бьются в тот же недоступный сервер.
  if (isOfflineUpdateError(err)) return
  const message = err instanceof Error ? err.message : String(err)
  send('app:update-error', message)
}

function checkForAppUpdates(): void {
  if (quittingForUpdate || downloadInProgress || downloadedVersion) return
  if (!net.isOnline()) return
  autoUpdater.checkForUpdates().catch((err) => {
    logger.error('Update check failed', err)
  })
}

export function setupUpdater(window: BrowserWindow): void {
  targetWindow = window

  if (!app.isPackaged) return

  if (!ipcRegistered) {
    ipcRegistered = true

    const executor = (
      autoUpdater as unknown as { httpExecutor?: Parameters<typeof installParallelUpdateDownloader>[0] }
    ).httpExecutor
    if (executor) installParallelUpdateDownloader(executor)

    // Скачивание стартует по кнопке «Обновить» (или тихо при «Позже»).
    autoUpdater.autoDownload = false
    // На macOS Squirrel должен забрать zip во время downloadUpdate(), иначе quitAndInstall() молча не сработает.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = true

    autoUpdater.on('update-available', (info) => {
      if (info.version === notifiedAvailableVersion) return
      notifiedAvailableVersion = info.version
      send('app:update-available')
    })

    autoUpdater.on('download-progress', (progress) => {
      send('app:update-download-progress', progress.percent)
    })

    autoUpdater.on('update-downloaded', (info) => {
      downloadInProgress = false
      downloadedVersion = info.version
      if (info.version === notifiedDownloadedVersion) return
      notifiedDownloadedVersion = info.version
      send('app:update-downloaded')
    })

    autoUpdater.on('error', (err) => {
      downloadInProgress = false
      reportUpdateError(err)
    })

    ipcMain.handle('app:start-update-download', async () => {
      if (downloadInProgress) return { ok: true as const }
      downloadInProgress = true
      try {
        await autoUpdater.downloadUpdate()
        return { ok: true as const }
      } catch (err) {
        downloadInProgress = false
        logger.error('Update download failed', err)
        if (isOfflineUpdateError(err)) {
          return { ok: false as const, error: 'offline' }
        }
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false as const, error: message }
      }
    })

    ipcMain.handle('app:install-update', () => {
      quittingForUpdate = true
      // Закрываем окна до spawn NSIS, чтобы раньше отпустить file locks.
      // Silent (/S): без диалога «приложение открыто»; force-run — перезапуск после установки.
      for (const win of BrowserWindow.getAllWindows()) {
        win.removeAllListeners('close')
        if (!win.isDestroyed()) win.close()
      }
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true)
      }, 300)
      return { ok: true as const }
    })

    checkForAppUpdates()
    setInterval(checkForAppUpdates, UPDATE_CHECK_INTERVAL_MS)
  }
}
