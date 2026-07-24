/**
 * Electron main process entry: single-instance lock, BrowserWindow,
 * security hooks, and IPC wiring for content / updater / WinBox / monitoring.
 */
import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { setupUpdater, isQuittingForUpdate } from './updater'
import { setupContentSync, getManifest, getArticleHtml } from './contentSync'
import { setupWinbox } from './winbox'
import { setupMonitoring } from './monitoring'
import { isAllowedAppNavigation, isAllowedExternalUrl } from './safe'
import { logger, setupProcessErrorHandlers } from './logger'

setupProcessErrorHandlers()

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      const win = windows[0]
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

/** Та же графика, что и `build/icon.png` (знак LT) — для заголовка окна и dev. */
function getWindowIconPath(): string | undefined {
  if (app.isPackaged) {
    const packed = join(process.resourcesPath, 'icon.png')
    if (existsSync(packed)) return packed
    return undefined
  }
  const dev = join(__dirname, '../../build/icon.png')
  if (existsSync(dev)) return dev
  return undefined
}

function attachWindowSecurity(mainWindow: BrowserWindow): void {
  const rendererDevUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    } else {
      logger.warn(`Blocked window.open / openExternal: ${details.url}`)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url, rendererDevUrl)) {
      event.preventDefault()
      logger.warn(`Blocked navigation: ${url}`)
    }
  })
}

/** Совпадает с Tailwind `xl`: при этой ширине viewport «Содержание» уходит в правую колонку. */
const ARTICLE_TOC_SIDEBAR_MIN_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 900
const MIN_WINDOW_HEIGHT = 600

function getDefaultWindowSize(): { width: number; height: number } {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize
  return {
    width: Math.min(ARTICLE_TOC_SIDEBAR_MIN_WIDTH, Math.max(MIN_WINDOW_WIDTH, workWidth)),
    height: Math.min(DEFAULT_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, workHeight))
  }
}

function createWindow(): BrowserWindow {
  const icon = getWindowIconPath()
  const { width, height } = getDefaultWindowSize()
  const mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    useContentSize: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  attachWindowSecurity(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function setupWindowServices(mainWindow: BrowserWindow): void {
  setupUpdater(mainWindow)
  setupContentSync(mainWindow)
}

let ipcRegistered = false

function registerIpcHandlers(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('content:get-manifest', () => getManifest())
  ipcMain.handle('content:get-article-html', (_, htmlFile: string) => getArticleHtml(htmlFile))
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('shell:open-external', async (_, url: string) => {
    if (!isAllowedExternalUrl(url)) {
      logger.warn(`Blocked shell:open-external: ${url}`)
      return { ok: false as const }
    }
    await shell.openExternal(url)
    return { ok: true as const }
  })

  setupWinbox()
  setupMonitoring()
}

if (gotTheLock) {
  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.nvi.knowhub')
    }

    registerIpcHandlers()

    const mainWindow = createWindow()
    setupWindowServices(mainWindow)

    app.on('activate', function () {
      if (isQuittingForUpdate()) return
      if (BrowserWindow.getAllWindows().length === 0) {
        const win = createWindow()
        setupWindowServices(win)
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
