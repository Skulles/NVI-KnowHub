const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const DEV_SERVER_URL = 'http://127.0.0.1:5173'
const isDev = !app.isPackaged

/** Release assets and API — allowlist so the preload IPC surface stays narrow. */
function assertAllowedRequestUrl(urlString) {
  let parsed
  try {
    parsed = new URL(urlString)
  } catch {
    throw new Error('net-request: invalid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('net-request: only https URLs are allowed')
  }
  const host = parsed.hostname
  const ok =
    host === 'github.com' ||
    host.endsWith('.github.com') ||
    host === 'objects.githubusercontent.com' ||
    host.endsWith('.githubusercontent.com')
  if (!ok) {
    throw new Error(`net-request: host not allowed: ${host}`)
  }
}

function normalizeIpcBody(body) {
  if (body == null) {
    return undefined
  }
  if (typeof body === 'string') {
    return body
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  if (Array.isArray(body)) {
    return Buffer.from(body)
  }
  throw new Error('net-request: unsupported body type')
}

ipcMain.handle('net-request', async (_event, req) => {
  const { url, method = 'GET', headers = {}, body, kind } = req
  assertAllowedRequestUrl(url)

  let bodyInit
  try {
    bodyInit = normalizeIpcBody(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, text: detail }
  }

  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bodyInit,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, networkError: true, text: detail }
  }

  if (kind === 'json') {
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, text }
    }
    if (response.status === 204) {
      return { ok: true, status: 204, data: null }
    }
    return {
      ok: true,
      status: response.status,
      data: text ? JSON.parse(text) : null,
    }
  }

  if (kind === 'binary') {
    if (!response.ok) {
      const text = await response.text()
      return { ok: false, status: response.status, errorText: text }
    }
    const buf = Buffer.from(await response.arrayBuffer())
    return { ok: true, status: response.status, buffer: new Uint8Array(buf) }
  }

  if (kind === 'upload-json') {
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, text }
    }
    return {
      ok: true,
      status: response.status,
      data: text ? JSON.parse(text) : null,
    }
  }

  throw new Error(`net-request: unknown kind ${kind}`)
})

function resolveWindowIconPath() {
  const devPath = path.join(__dirname, '..', 'public', 'knowhub-mark.png')
  const prodPath = path.join(__dirname, '..', 'dist', 'knowhub-mark.png')
  if (fs.existsSync(devPath)) {
    return devPath
  }
  if (fs.existsSync(prodPath)) {
    return prodPath
  }
  return undefined
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 540,
    minWidth: 1024,
    minHeight: 540,
    autoHideMenuBar: true,
    icon: resolveWindowIconPath(),
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
