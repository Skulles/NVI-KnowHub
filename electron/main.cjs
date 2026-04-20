const { app, BrowserWindow, ipcMain, shell } = require('electron')
const dgram = require('node:dgram')
const fs = require('node:fs')
const path = require('node:path')

const { createMacTelnetSession } = require('./mac-telnet.cjs')

const DEV_SERVER_URL = 'http://127.0.0.1:5173'
const isDev = !app.isPackaged
const MNDP_PORT = 5678
const MNDP_VISIBLE_DEVICE_TTL_MS = 45_000
const MNDP_BUFFER_DEVICE_TTL_MS = 10 * 60_000
const MNDP_BUFFER_SWEEP_INTERVAL_MS = 5_000

const mikrotikDiscoveryState = {
  socket: null,
  startPromise: null,
  sweepTimer: null,
  status: 'idle',
  lastError: null,
  devices: new Map(),
  lastSnapshotSignature: '',
}

function formatMac(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 6) {
    return null
  }
  return [...raw].map((byte) => byte.toString(16).padStart(2, '0')).join(':')
}

function decodeUtf8(raw) {
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    return null
  }
  const value = raw.toString('utf8').replace(/\0+$/g, '').trim()
  return value || null
}

function decodeIpv4(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 4) {
    return null
  }
  return [...raw].join('.')
}

function decodeIpv6(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 16) {
    return null
  }
  const parts = []
  for (let offset = 0; offset < raw.length; offset += 2) {
    parts.push(raw.readUInt16BE(offset).toString(16))
  }
  return parts.join(':')
}

function parseMndpPacket(message, remoteAddress) {
  if (!Buffer.isBuffer(message) || message.length < 4) {
    return null
  }

  const fields = {
    mac: null,
    identity: null,
    version: null,
    platform: null,
    board: null,
    softwareId: null,
    interfaceName: null,
    ipv4: null,
    ipv6: null,
    uptimeSeconds: null,
  }

  let offset = 4
  while (offset + 4 <= message.length) {
    const type = message.readUInt16BE(offset)
    const length = message.readUInt16BE(offset + 2)
    offset += 4

    if (length < 0 || offset + length > message.length) {
      break
    }

    const value = message.subarray(offset, offset + length)
    offset += length

    switch (type) {
      case 1:
        fields.mac = formatMac(value)
        break
      case 5:
        fields.identity = decodeUtf8(value)
        break
      case 7:
        fields.version = decodeUtf8(value)
        break
      case 8:
        fields.platform = decodeUtf8(value)
        break
      case 10:
        fields.uptimeSeconds = value.length === 4 ? value.readUInt32LE(0) : null
        break
      case 11:
        fields.softwareId = decodeUtf8(value)
        break
      case 12:
        fields.board = decodeUtf8(value)
        break
      case 15:
      case 21:
        fields.ipv6 = decodeIpv6(value)
        break
      case 16:
        fields.interfaceName = decodeUtf8(value)
        break
      case 17:
        fields.ipv4 = decodeIpv4(value)
        break
      default:
        break
    }
  }

  const fallbackAddress =
    typeof remoteAddress === 'string' && remoteAddress.trim() ? remoteAddress : null
  const dedupeKey =
    fields.mac ??
    [fields.ipv4 ?? fallbackAddress, fields.identity ?? fields.board ?? fields.platform]
      .filter(Boolean)
      .join('|')

  if (!dedupeKey) {
    return null
  }

  return {
    id: dedupeKey,
    ...fields,
    address: fallbackAddress,
    lastSeen: new Date().toISOString(),
  }
}

function mergeDiscoveredDevice(previous, next) {
  if (!previous) {
    return next
  }
  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== null && value !== ''),
    ),
    id: previous.id,
    lastSeen: next.lastSeen,
  }
}

function parseLastSeenMs(device) {
  const ts = Date.parse(device.lastSeen)
  return Number.isFinite(ts) ? ts : 0
}

function isVisibleDiscoveredDevice(device, nowMs = Date.now()) {
  return nowMs - parseLastSeenMs(device) <= MNDP_VISIBLE_DEVICE_TTL_MS
}

function pruneBufferedDevices(nowMs = Date.now()) {
  let removed = false
  for (const [deviceId, device] of mikrotikDiscoveryState.devices.entries()) {
    if (nowMs - parseLastSeenMs(device) > MNDP_BUFFER_DEVICE_TTL_MS) {
      mikrotikDiscoveryState.devices.delete(deviceId)
      removed = true
    }
  }
  return removed
}

function getVisibleDiscoveredDevices(nowMs = Date.now()) {
  return [...mikrotikDiscoveryState.devices.values()]
    .filter((device) => isVisibleDiscoveredDevice(device, nowMs))
    .sort((left, right) => {
      const leftKey = `${left.identity ?? ''}${left.mac ?? ''}${left.address ?? ''}`
      const rightKey = `${right.identity ?? ''}${right.mac ?? ''}${right.address ?? ''}`
      if (left.lastSeen !== right.lastSeen) {
        return right.lastSeen.localeCompare(left.lastSeen)
      }
      return leftKey.localeCompare(rightKey, 'ru')
    })
}

function getMikrotikDiscoverySnapshot() {
  pruneBufferedDevices()
  return {
    status: mikrotikDiscoveryState.status,
    lastError: mikrotikDiscoveryState.lastError,
    devices: getVisibleDiscoveredDevices(),
  }
}

function snapshotSignature(snapshot) {
  return `${snapshot.status}|${snapshot.lastError ?? ''}|${snapshot.devices.map((device) => `${device.id}:${device.lastSeen}`).join(',')}`
}

function broadcastMikrotikDiscoverySnapshot(force = false) {
  const snapshot = getMikrotikDiscoverySnapshot()
  const nextSignature = snapshotSignature(snapshot)
  if (!force && nextSignature === mikrotikDiscoveryState.lastSnapshotSignature) {
    return snapshot
  }
  mikrotikDiscoveryState.lastSnapshotSignature = nextSignature
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('mikrotik-discovery:snapshot', snapshot)
    }
  }
  return snapshot
}

function resetMikrotikDiscoverySocket() {
  mikrotikDiscoveryState.socket = null
  mikrotikDiscoveryState.startPromise = null
}

function startMikrotikDiscoverySweep() {
  if (mikrotikDiscoveryState.sweepTimer) {
    return
  }
  mikrotikDiscoveryState.sweepTimer = setInterval(() => {
    pruneBufferedDevices()
    broadcastMikrotikDiscoverySnapshot()
  }, MNDP_BUFFER_SWEEP_INTERVAL_MS)
}

function stopMikrotikDiscoverySweep() {
  if (!mikrotikDiscoveryState.sweepTimer) {
    return
  }
  clearInterval(mikrotikDiscoveryState.sweepTimer)
  mikrotikDiscoveryState.sweepTimer = null
}

async function startMikrotikDiscovery() {
  if (mikrotikDiscoveryState.socket && mikrotikDiscoveryState.status === 'listening') {
    return getMikrotikDiscoverySnapshot()
  }
  if (mikrotikDiscoveryState.startPromise) {
    return mikrotikDiscoveryState.startPromise
  }

  mikrotikDiscoveryState.status = 'idle'
  mikrotikDiscoveryState.lastError = null
  broadcastMikrotikDiscoverySnapshot(true)

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  mikrotikDiscoveryState.startPromise = new Promise((resolve) => {
    let startupDone = false

    const finishStartup = () => {
      if (startupDone) {
        return
      }
      startupDone = true
      mikrotikDiscoveryState.startPromise = null
      resolve(getMikrotikDiscoverySnapshot())
    }

    socket.on('listening', () => {
      mikrotikDiscoveryState.socket = socket
      mikrotikDiscoveryState.status = 'listening'
      mikrotikDiscoveryState.lastError = null
      startMikrotikDiscoverySweep()
      try {
        socket.setBroadcast(true)
      } catch {
        // Receiving MNDP works without this on some systems, so only best-effort.
      }
      broadcastMikrotikDiscoverySnapshot(true)
      finishStartup()
    })

    socket.on('message', (message, remoteInfo) => {
      const parsed = parseMndpPacket(message, remoteInfo.address)
      if (!parsed) {
        return
      }
      const existing = mikrotikDiscoveryState.devices.get(parsed.id)
      mikrotikDiscoveryState.devices.set(parsed.id, mergeDiscoveredDevice(existing, parsed))
      broadcastMikrotikDiscoverySnapshot()
    })

    socket.on('error', (error) => {
      mikrotikDiscoveryState.status = 'error'
      mikrotikDiscoveryState.lastError =
        error instanceof Error ? error.message : String(error)
      stopMikrotikDiscoverySweep()
      broadcastMikrotikDiscoverySnapshot(true)
      if (mikrotikDiscoveryState.socket === socket) {
        resetMikrotikDiscoverySocket()
      }
      try {
        socket.close()
      } catch {
        resetMikrotikDiscoverySocket()
      }
      finishStartup()
    })

    socket.on('close', () => {
      stopMikrotikDiscoverySweep()
      if (mikrotikDiscoveryState.socket === socket) {
        resetMikrotikDiscoverySocket()
      }
      if (mikrotikDiscoveryState.status !== 'error') {
        mikrotikDiscoveryState.status = 'idle'
        mikrotikDiscoveryState.lastError = null
      }
      broadcastMikrotikDiscoverySnapshot(true)
    })

    socket.bind(MNDP_PORT, '0.0.0.0')
  })

  return mikrotikDiscoveryState.startPromise
}

async function stopMikrotikDiscovery() {
  if (!mikrotikDiscoveryState.socket) {
    mikrotikDiscoveryState.status = 'idle'
    mikrotikDiscoveryState.lastError = null
    stopMikrotikDiscoverySweep()
    return broadcastMikrotikDiscoverySnapshot(true)
  }

  const socket = mikrotikDiscoveryState.socket
  mikrotikDiscoveryState.status = 'idle'
  mikrotikDiscoveryState.lastError = null
  resetMikrotikDiscoverySocket()
  stopMikrotikDiscoverySweep()

  await new Promise((resolve) => {
    socket.once('close', resolve)
    socket.close()
  })

  return getMikrotikDiscoverySnapshot()
}

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

ipcMain.handle('mikrotik-discovery:start', async () => startMikrotikDiscovery())
ipcMain.handle('mikrotik-discovery:stop', async () => stopMikrotikDiscovery())
ipcMain.handle('mikrotik-discovery:get-snapshot', async () =>
  getMikrotikDiscoverySnapshot(),
)

// --------------------------------------------------------------------------
// MAC-Telnet sessions
// --------------------------------------------------------------------------

const macTelnetSessions = new Map()
let macTelnetNextId = 1

function emitMacTelnet(event, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, payload)
    }
  }
}

function closeMacTelnetSession(sessionId, reason) {
  const session = macTelnetSessions.get(sessionId)
  if (!session) return
  macTelnetSessions.delete(sessionId)
  try {
    session.close(reason)
  } catch {
    /* already closed */
    emitMacTelnet('mac-telnet:event', {
      sessionId,
      event: { type: 'phase', phase: 'closed', reason: reason ?? null },
    })
  }
}

function closeAllMacTelnetSessions(reason) {
  const ids = [...macTelnetSessions.keys()]
  for (const id of ids) {
    closeMacTelnetSession(id, reason)
  }
}

ipcMain.handle('mac-telnet:connect', async (_event, payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('mac-telnet:connect: payload is required')
  }
  const {
    dstMac,
    username = 'admin',
    password = '',
    cols = 80,
    rows = 24,
    term = 'xterm-256color',
  } = payload
  if (!dstMac) {
    throw new Error('mac-telnet:connect: dstMac is required')
  }

  closeAllMacTelnetSessions('replaced-by-new-connect')

  const sessionId = macTelnetNextId
  macTelnetNextId += 1

  const session = createMacTelnetSession({
    dstMac,
    username,
    password,
    cols,
    rows,
    term,
    onOutput(chunk) {
      emitMacTelnet('mac-telnet:data', {
        sessionId,
        data: chunk.toString('base64'),
      })
    },
    onStatus(event) {
      emitMacTelnet('mac-telnet:event', { sessionId, event })
      if (event?.type === 'phase' && event.phase === 'closed') {
        macTelnetSessions.delete(sessionId)
      }
    },
  })

  macTelnetSessions.set(sessionId, session)

  // Return the session id immediately so the renderer can subscribe to phase/error
  // events while discovery/authentication is still in progress.
  void session.connect().catch((err) => {
    emitMacTelnet('mac-telnet:event', {
      sessionId,
      event: {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      },
    })
    macTelnetSessions.delete(sessionId)
    try {
      session.close()
    } catch {
      /* ignore */
    }
  })

  return { sessionId }
})

ipcMain.handle('mac-telnet:input', (_event, payload) => {
  const session = macTelnetSessions.get(payload?.sessionId)
  if (!session) return false
  const buf = Buffer.from(String(payload?.data ?? ''), 'base64')
  session.writeInput(buf)
  return true
})

ipcMain.handle('mac-telnet:resize', (_event, payload) => {
  const session = macTelnetSessions.get(payload?.sessionId)
  if (!session) return false
  session.resize(
    Number.isFinite(payload?.cols) ? Number(payload.cols) : undefined,
    Number.isFinite(payload?.rows) ? Number(payload.rows) : undefined,
  )
  return true
})

ipcMain.handle('mac-telnet:disconnect', (_event, payload) => {
  closeMacTelnetSession(payload?.sessionId, 'user-request')
  return true
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

function cleanupMacTelnetOnQuit() {
  closeAllMacTelnetSessions('app-quit')
}

app.on('before-quit', () => {
  stopMikrotikDiscoverySweep()
  if (mikrotikDiscoveryState.socket) {
    try {
      mikrotikDiscoveryState.socket.close()
    } catch {
      resetMikrotikDiscoverySocket()
    }
  }
  cleanupMacTelnetOnQuit()
})

app.on('will-quit', () => {
  cleanupMacTelnetOnQuit()
})
