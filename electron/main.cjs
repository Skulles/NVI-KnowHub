const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

const DEV_SERVER_URL = 'http://127.0.0.1:5173'
const isDev = !app.isPackaged

function createMainWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 540,
    minWidth: 960,
    minHeight: 540,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
    return
  }

  void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
