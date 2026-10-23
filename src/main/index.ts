/**
 * Electron main process entry: single-instance lock, BrowserWindow,
 * security hooks, and IPC wiring for content / updater / WinBox / monitoring / discovery.
 */
import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { release } from 'os'
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
  app.exit(0)
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
/** Windows 11. На 10 такого атрибута DWM нет, углы рисует страница. */
const WINDOWS_11_BUILD = 22000
const DWMWA_WINDOW_CORNER_PREFERENCE = 33
const DWMWCP_ROUND = 2

function windowsBuildNumber(): number {
  if (process.platform !== 'win32') return 0
  return Number(release().split('.')[2] ?? 0)
}

function isWindows11(): boolean {
  return windowsBuildNumber() >= WINDOWS_11_BUILD
}

function windowsChromeOptions(): {
  backgroundColor: string
  frame?: false
  transparent?: true
  thickFrame?: false
  roundedCorners?: true
  titleBarStyle?: 'hidden'
  titleBarOverlay?: { color: string; symbolColor: string }
} {
  if (process.platform !== 'win32') {
    return { backgroundColor: WINDOW_CHROME_COLOR }
  }
  const chrome = {
    frame: false as const,
    titleBarStyle: 'hidden' as const,
    titleBarOverlay: {
      color: WINDOW_CHROME_COLOR,
      symbolColor: WINDOW_CHROME_SYMBOL_COLOR
    }
  }
  if (isWindows11()) {
    return { ...chrome, backgroundColor: WINDOW_CHROME_COLOR, roundedCorners: true }
  }
  return {
    ...chrome,
    transparent: true,
    thickFrame: false,
    backgroundColor: '#00000000'
  }
}

/** Сглаженные углы Windows 11. Жёсткая маска setShape даёт лесенку, поэтому её нет. */
function applyWindows11RoundedCorners(mainWindow: BrowserWindow): Promise<void> {
  if (!isWindows11() || mainWindow.isDestroyed()) return Promise.resolve()
  const hwndBuf = mainWindow.getNativeWindowHandle()
  const hwnd = hwndBuf.length >= 8 ? hwndBuf.readBigUInt64LE(0) : BigInt(hwndBuf.readUInt32LE(0))
  if (hwnd <= 0n) return Promise.resolve()
  const command = [
    `Add-Type -Namespace KnowHub -Name Dwm -MemberDefinition '[System.Runtime.InteropServices.DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(System.IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);'`,
    `$pref = ${DWMWCP_ROUND}`,
    `$hwnd = New-Object System.IntPtr ([int64]${hwnd.toString()})`,
    `[KnowHub.Dwm]::DwmSetWindowAttribute($hwnd, ${DWMWA_WINDOW_CORNER_PREFERENCE}, [ref]$pref, 4) | Out-Null`
  ].join('; ')
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    const timer = setTimeout(resolve, 4000)
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    const finish = (): void => {
      clearTimeout(timer)
      resolve()
    }
    child.once('error', (error) => {
      logger.warn(`Window corner rounding failed: ${error.message}`)
      finish()
    })
    child.once('exit', (code) => {
      if (code) logger.warn(`Window corner rounding failed (${code}): ${stderr.trim()}`)
      finish()
    })
    child.unref()
  })
}

/** На Windows 10 скругление рисует страница; у развёрнутого окна его нужно снять. */
function attachWindowCorners(mainWindow: BrowserWindow): void {
  if (process.platform !== 'win32' || isWindows11()) return

  let squareApplied: boolean | null = null

  const apply = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    const square = mainWindow.isMaximized() || mainWindow.isFullScreen()
    if (squareApplied === square) return
    squareApplied = square
    void mainWindow.webContents
      .executeJavaScript(
        `document.documentElement.classList.add('window-css-corners'); document.documentElement.classList.toggle('is-maximized', ${square})`
      )
      .catch(() => {
        squareApplied = null
      })
  }

  mainWindow.on('maximize', apply)
  mainWindow.on('unmaximize', apply)
  mainWindow.on('enter-full-screen', apply)
  mainWindow.on('leave-full-screen', apply)
  mainWindow.webContents.on('dom-ready', () => {
    squareApplied = null
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
    void applyWindows11RoundedCorners(mainWindow).finally(() => {
      if (mainWindow.isDestroyed()) return
      mainWindow.show()
      void applyWindows11RoundedCorners(mainWindow)
      if (!app.isPackaged) {
        mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
    })
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

    const showMainWindow = (): void => {
      const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
      const existing = windows[0]
      if (!existing) {
        setupWindowServices(createWindow())
        return
      }
      if (existing.isMinimized()) existing.restore()
      if (!existing.isVisible()) existing.show()
      existing.focus()
    }

    showMainWindow()

    app.on('second-instance', () => {
      showMainWindow()
    })

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
