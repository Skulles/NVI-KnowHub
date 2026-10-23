/**
 * Electron main process entry: single-instance lock, BrowserWindow,
 * security hooks, and IPC wiring for content / updater / WinBox / monitoring / discovery.
 */
import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { setupUpdater, isQuittingForUpdate } from './updater'
import { setupContentSync, getManifest, getArticleHtml } from './contentSync'
import { setupWinbox } from './winbox'
import { setupMonitoring } from './monitoring'
import { setupDiscovery } from './discovery'
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
/** Совпадает с Tailwind `surface.window` / `--bg`. */
const WINDOW_CHROME_COLOR = '#0b0e16'
const WINDOW_CHROME_SYMBOL_COLOR = '#eef1f8'
/** Совпадает с `border-radius` у `html.platform-windows body`. */
const WINDOW_CORNER_RADIUS = 10

function windowsChromeOptions(): {
  backgroundColor: string
  frame?: false
  transparent?: true
  titleBarStyle?: 'hidden'
  titleBarOverlay?: { color: string; symbolColor: string }
} {
  if (process.platform !== 'win32') {
    return { backgroundColor: WINDOW_CHROME_COLOR }
  }
  return {
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: WINDOW_CHROME_COLOR,
      symbolColor: WINDOW_CHROME_SYMBOL_COLOR
    }
  }
}

function roundedWindowShape(
  width: number,
  height: number,
  radius: number
): { x: number; y: number; width: number; height: number }[] {
  const r = Math.max(0, Math.min(radius, Math.floor(width / 2), Math.floor(height / 2)))
  if (r === 0 || width <= 0 || height <= 0) return []

  const insetAt = (distanceFromCenter: number): number => {
    const dx = Math.sqrt(Math.max(0, r * r - distanceFromCenter * distanceFromCenter))
    return Math.max(0, Math.floor(r - dx))
  }

  const rects: { x: number; y: number; width: number; height: number }[] = []
  for (let y = 0; y < r; y++) {
    const inset = insetAt(r - y - 0.5)
    rects.push({ x: inset, y, width: Math.max(0, width - inset * 2), height: 1 })
  }
  if (height - r * 2 > 0) {
    rects.push({ x: 0, y: r, width, height: height - r * 2 })
  }
  for (let y = 0; y < r; y++) {
    const inset = insetAt(y + 0.5)
    rects.push({
      x: inset,
      y: height - r + y,
      width: Math.max(0, width - inset * 2),
      height: 1
    })
  }
  return rects
}

function attachWindowCorners(mainWindow: BrowserWindow): void {
  if (process.platform !== 'win32') return

  let squareApplied: boolean | null = null
  let classSynced = false

  const apply = (): void => {
    if (mainWindow.isDestroyed()) return
    const square = mainWindow.isMaximized() || mainWindow.isFullScreen()
    if (square) {
      if (squareApplied !== true) mainWindow.setShape([])
    } else {
      const [width, height] = mainWindow.getSize()
      mainWindow.setShape(roundedWindowShape(width, height, WINDOW_CORNER_RADIUS))
    }
    const needsClass = !classSynced || squareApplied !== square
    squareApplied = square
    if (!needsClass || mainWindow.webContents.isDestroyed() || mainWindow.webContents.isLoading()) return
    classSynced = true
    void mainWindow.webContents
      .executeJavaScript(`document.documentElement.classList.toggle('is-maximized', ${square})`)
      .catch(() => {
        classSynced = false
      })
  }

  apply()
  mainWindow.on('resize', apply)
  mainWindow.on('maximize', apply)
  mainWindow.on('unmaximize', apply)
  mainWindow.on('enter-full-screen', apply)
  mainWindow.on('leave-full-screen', apply)
  mainWindow.webContents.on('did-finish-load', () => {
    classSynced = false
    apply()
  })
}

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
    ...windowsChromeOptions(),
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
  attachWindowCorners(mainWindow)

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
  setupDiscovery()
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
