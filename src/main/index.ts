import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { setupUpdater, isQuittingForUpdate } from './updater'
import { setupContentSync, getManifest, getArticleHtml } from './contentSync'
import { setupWinbox } from './winbox'
import { setupMonitoring } from './monitoring'

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

function createWindow(): BrowserWindow {
  const icon = getWindowIconPath()
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.nvi.knowhub')
  }

  ipcMain.handle('content:get-manifest', () => getManifest())
  ipcMain.handle('content:get-article-html', (_, htmlFile: string) => getArticleHtml(htmlFile))
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('shell:open-external', async (_, url: string) => {
    await shell.openExternal(url)
    return { ok: true }
  })

  const mainWindow = createWindow()

  setupUpdater(mainWindow)
  setupContentSync(mainWindow)
  setupWinbox()
  setupMonitoring()

  app.on('activate', function () {
    if (isQuittingForUpdate()) return
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
