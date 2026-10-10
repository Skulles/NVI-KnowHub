/**
 * Local-channel discovery IPC.
 * MikroTik — MNDP (UDP 5678).
 * Cameras — ONVIF, SADP, ConfigTool/Dahua, DVRIP, SSDP/UPnP, Bonjour/mDNS.
 * Other — ICMP on the laptop's own subnets. L2 hits stay only when the device answered.
 */
import { createSocket, type Socket } from 'dgram'
import { BrowserWindow, ipcMain } from 'electron'
import os from 'os'
import type { DiscoveryDevice, DiscoveryScanResult } from '../shared/api'
import {
  directedBroadcast,
  deviceKey,
  isIPv4,
  isTunnelInterface,
  isPlaceholderBoard,
  mergeDiscoveryDevice,
  usableDiscoveryBoard,
  MNDP_PORT,
  MNDP_REQUEST,
  neighborToDevice,
  parseMndpPacket,
  sortDiscoveryDevices
} from './discoveryMndp'
import { buildMdnsCameraQueries, MDNS_ADDR, MDNS_PORT, parseMdnsMessage } from './discoveryMdns'
import { decodeDiscoveryDocument } from './discoveryText'
import {
  buildDahuaSearch,
  buildDahuaSearchDhip,
  buildDahuaSearchPing,
  buildDvripSearch,
  buildSadpInquiry,
  buildSsdpProbes,
  buildWsDiscoveryGenericProbe,
  buildWsDiscoveryProbe,
  DAHUA_DISCOVERY_ADDR,
  DAHUA_DISCOVERY_PORT,
  DVRIP_DISCOVERY_PORT,
  fetchUpnpDescription,
  isSsdpBye,
  parseDahuaDiscovery,
  parseSadpMessage,
  parseSsdpResponse,
  parseUpnpDeviceDescription,
  parseWsDiscoveryMessage,
  ssdpLocation,
  ssdpMaxAgeSec,
  SADP_ADDR,
  SADP_PORT,
  SSDP_ADDR,
  SSDP_PORT,
  WS_DISCOVERY_ADDR,
  WS_DISCOVERY_PORT
} from './discoveryWs'
import { applyNeighborMacs, readNeighborMacs } from './discoveryNeighbors'
import { pingLiveHosts } from './discoveryPing'
import { dedupeDiscoveryDevices, otherFromAlive, usableMac } from './discoveryFingerprint'
import { readNetbiosNames } from './discoveryNbns'
import { readHttpDeviceTitles } from './discoveryHttp'
import { logger } from './logger'

const LISTEN_MS = 3500
const RESEND_AFTER_MS = 1200
const SSDP_LISTEN_MS = 8000
const PROBE_EVERY_MS = 15_000
const DEFAULT_STALE_MS = 60_000
const STALE_CHECK_MS = 5_000

interface TrackedDevice extends DiscoveryDevice {
  seenAt: number
  expireAt: number
  online: boolean
  /** Seen by an active probe (MNDP / ONVIF / …), not only by an SSDP advert. */
  probeSeen: boolean
}

let activeScan: AbortController | null = null
let watch: {
  controller: AbortController
  devices: Map<string, TrackedDevice>
  sockets: Socket[]
  described: Set<string>
  loop: Promise<void> | null
  staleTimer: ReturnType<typeof setInterval> | null
} | null = null

interface ScanIface {
  name: string
  address: string
  netmask: string
  broadcast: string
}

function listScanInterfaces(): ScanIface[] {
  const ifaces: ScanIface[] = []
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (isTunnelInterface(name)) continue
    for (const entry of entries ?? []) {
      const familyValue = entry.family as string | number
      const family = familyValue === 'IPv4' || familyValue === 4 ? 'IPv4' : 'IPv6'
      if (family !== 'IPv4' || entry.internal || !isIPv4(entry.address)) continue
      const broadcast = directedBroadcast(entry.address, entry.netmask)
      if (!broadcast) continue
      ifaces.push({ name, address: entry.address, netmask: entry.netmask, broadcast })
    }
  }
  return ifaces
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function closeSocket(socket: Socket): void {
  try {
    socket.close()
  } catch {
    // already closed
  }
}

function probeTargets(ifaces: ScanIface[], multicastAddr?: string, iface?: ScanIface): string[] {
  const broadcasts = iface ? [iface.broadcast] : ifaces.map((item) => item.broadcast)
  return [...new Set([...(multicastAddr ? [multicastAddr] : []), ...broadcasts])]
}

function isIgnorableSendError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  return code === 'EADDRNOTAVAIL' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EPERM'
}

function logSendFailure(label: string, error: unknown): void {
  if (isIgnorableSendError(error)) return
  const message = error instanceof Error ? error.message : String(error)
  logger.warn(`discovery ${label} send failed: ${message}`)
}

function sendMndpRequest(socket: Socket, targets: string[]): void {
  for (const target of targets) {
    socket.send(MNDP_REQUEST, MNDP_PORT, target, (error) => {
      if (error) logSendFailure('mndp', error)
    })
  }
}

async function bindUdp(socket: Socket, port: number, address?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      socket.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      socket.off('error', onError)
      resolve()
    }
    socket.once('error', onError)
    socket.once('listening', onListening)
    if (address) socket.bind(port, address)
    else socket.bind(port)
  })
}

async function discoverMikrotik(signal: AbortSignal): Promise<DiscoveryDevice[]> {
  const ifaces = listScanInterfaces()
  const localIps = new Set(ifaces.map((iface) => iface.address))
  const found = new Map<string, DiscoveryDevice>()
  const sockets: Socket[] = []
  const senders: { socket: Socket; targets: string[] }[] = []

  const remember = (packet: Buffer, sourceIp: string): void => {
    if (localIps.has(sourceIp)) return
    const neighbor = parseMndpPacket(packet, sourceIp)
    if (!neighbor || localIps.has(neighbor.ip)) return
    const device = neighborToDevice(neighbor)
    const key = deviceKey(device)
    const current = found.get(key)
    found.set(key, current ? mergeDiscoveryDevice(current, device) : device)
  }

  const attach = (socket: Socket, targets: string[]): void => {
    sockets.push(socket)
    senders.push({ socket, targets })
    socket.on('message', (message, rinfo) => {
      remember(message, rinfo.address)
    })
    socket.on('error', (error) => {
      logger.warn('discovery mndp socket error', error)
    })
  }

  try {
    const shared = createSocket({ type: 'udp4', reuseAddr: true })
    try {
      await bindUdp(shared, MNDP_PORT)
    } catch {
      await bindUdp(shared, 0)
    }
    shared.setBroadcast(true)
    attach(shared, probeTargets(ifaces))
    sendMndpRequest(shared, probeTargets(ifaces))

    for (const iface of ifaces) {
      const socket = createSocket({ type: 'udp4', reuseAddr: true })
      try {
        await bindUdp(socket, 0, iface.address)
        socket.setBroadcast(true)
        const targets = probeTargets(ifaces, undefined, iface)
        attach(socket, targets)
        sendMndpRequest(socket, targets)
      } catch (error) {
        logger.warn(`discovery mndp bind ${iface.name} failed`, error)
        closeSocket(socket)
      }
    }

    logger.info(`discovery mndp listen ifaces=${ifaces.map((iface) => iface.name).join(',') || 'none'}`)

    await wait(RESEND_AFTER_MS, signal)
    for (const sender of senders) sendMndpRequest(sender.socket, sender.targets)
    await wait(LISTEN_MS - RESEND_AFTER_MS, signal)
  } finally {
    for (const socket of sockets) closeSocket(socket)
  }

  return sortDiscoveryDevices([...found.values()])
}

function rememberDevice(found: Map<string, DiscoveryDevice>, device: DiscoveryDevice): void {
  const key = `${device.kind}:${deviceKey(device)}`
  const current = found.get(key)
  found.set(key, current ? mergeDiscoveryDevice(current, device) : device)
}

function sendPackets(socket: Socket, packets: Buffer[], port: number, targets: string[], label: string): void {
  for (const target of targets) {
    for (const packet of packets) {
      socket.send(packet, port, target, (error) => {
        if (error) logSendFailure(label, error)
      })
    }
  }
}

async function discoverUdpCameras(
  label: string,
  port: number,
  multicastAddr: string | undefined,
  packets: Buffer[],
  parse: (message: Buffer, sourceIp: string) => DiscoveryDevice[],
  signal: AbortSignal
): Promise<DiscoveryDevice[]> {
  const ifaces = listScanInterfaces()
  const localIps = new Set(ifaces.map((iface) => iface.address))
  const found = new Map<string, DiscoveryDevice>()
  const sockets: Socket[] = []
  const senders: { socket: Socket; targets: string[] }[] = []
  const sharedTargets = probeTargets(ifaces, multicastAddr)

  const remember = (message: Buffer, sourceIp: string): void => {
    if (localIps.has(sourceIp)) return
    for (const device of parse(message, sourceIp)) {
      if (localIps.has(device.ip)) continue
      rememberDevice(found, device)
    }
  }

  const attach = (socket: Socket, targets: string[]): void => {
    sockets.push(socket)
    senders.push({ socket, targets })
    socket.on('message', (message, rinfo) => {
      remember(message, rinfo.address)
    })
    socket.on('error', (error) => {
      logger.warn(`discovery ${label} socket error`, error)
    })
  }

  try {
    const shared = createSocket({ type: 'udp4', reuseAddr: true })
    try {
      await bindUdp(shared, port)
    } catch {
      await bindUdp(shared, 0)
    }
    shared.setBroadcast(true)
    if (multicastAddr) {
      try {
        shared.setMulticastTTL(2)
      } catch {
        // keep default TTL
      }
      for (const iface of ifaces) {
        try {
          shared.addMembership(multicastAddr, iface.address)
        } catch (error) {
          logger.warn(`discovery ${label} join ${iface.name} failed`, error)
        }
      }
    }
    attach(shared, sharedTargets)
    sendPackets(shared, packets, port, sharedTargets, label)

    for (const iface of ifaces) {
      const socket = createSocket({ type: 'udp4', reuseAddr: true })
      try {
        await bindUdp(socket, 0, iface.address)
        socket.setBroadcast(true)
        if (multicastAddr) {
          try {
            socket.setMulticastTTL(2)
            socket.setMulticastInterface(iface.address)
          } catch {
            // send still goes out this NIC via bind address
          }
        }
        const targets = probeTargets(ifaces, multicastAddr, iface)
        attach(socket, targets)
        sendPackets(socket, packets, port, targets, label)
      } catch (error) {
        logger.warn(`discovery ${label} bind ${iface.name} failed`, error)
        closeSocket(socket)
      }
    }

    logger.info(`discovery ${label} listen ifaces=${ifaces.map((iface) => iface.name).join(',') || 'none'}`)

    await wait(RESEND_AFTER_MS, signal)
    for (const sender of senders) sendPackets(sender.socket, packets, port, sender.targets, label)
    await wait(LISTEN_MS - RESEND_AFTER_MS, signal)
  } finally {
    for (const socket of sockets) closeSocket(socket)
  }

  return sortDiscoveryDevices([...found.values()])
}

async function discoverSsdp(signal: AbortSignal): Promise<DiscoveryDevice[]> {
  const ifaces = listScanInterfaces()
  const localIps = new Set(ifaces.map((iface) => iface.address))
  const found = new Map<string, DiscoveryDevice>()
  const locations = new Map<string, string>()
  const sockets: Socket[] = []
  const senders: { socket: Socket; targets: string[] }[] = []
  const packets = buildSsdpProbes()

  const remember = (message: Buffer, sourceIp: string): void => {
    if (localIps.has(sourceIp)) return
    const devices = parseSsdpResponse(message, sourceIp)
    if (!devices.length) return
    const location = ssdpLocation(message)
    for (const device of devices) {
      if (localIps.has(device.ip)) continue
      rememberDevice(found, device)
      if (location && !locations.has(device.ip)) locations.set(device.ip, location)
    }
  }

  try {
    const listen = createSocket({ type: 'udp4', reuseAddr: true })
    await bindUdp(listen, SSDP_PORT)
    listen.setBroadcast(true)
    listen.on('message', (message, rinfo) => remember(message, rinfo.address))
    listen.on('error', (error) => logger.warn('discovery ssdp listen error', error))
    sockets.push(listen)
    for (const iface of ifaces) {
      try {
        listen.addMembership(SSDP_ADDR, iface.address)
      } catch (error) {
        logger.warn(`discovery ssdp join ${iface.name} failed`, error)
      }
    }

    for (const iface of ifaces) {
      const socket = createSocket({ type: 'udp4', reuseAddr: true })
      try {
        await bindUdp(socket, 0, iface.address)
        socket.setBroadcast(true)
        try {
          socket.setMulticastTTL(2)
          socket.setMulticastInterface(iface.address)
        } catch {
          // bind address still pins the NIC
        }
        socket.on('message', (message, rinfo) => remember(message, rinfo.address))
        const targets = probeTargets(ifaces, SSDP_ADDR, iface)
        sockets.push(socket)
        senders.push({ socket, targets })
        sendPackets(socket, packets, SSDP_PORT, targets, 'ssdp')
      } catch (error) {
        logger.warn(`discovery ssdp bind ${iface.name} failed`, error)
        closeSocket(socket)
      }
    }

    logger.info(`discovery ssdp listen ifaces=${ifaces.map((iface) => iface.name).join(',') || 'none'}`)
    await wait(1500, signal)
    for (const sender of senders) {
      sendPackets(sender.socket, packets, SSDP_PORT, sender.targets, 'ssdp')
    }
    await wait(SSDP_LISTEN_MS - 1500, signal)
  } finally {
    for (const socket of sockets) closeSocket(socket)
  }

  await Promise.all(
    [...locations.entries()].map(async ([ip, location]) => {
      if (signal.aborted) return
      const xml = await fetchUpnpDescription(location)
      if (!xml) return
      const extra = parseUpnpDeviceDescription(xml)
      for (const [key, current] of found) {
        if (current.ip !== ip) continue
        found.set(
          key,
          mergeDiscoveryDevice(current, {
            ...current,
            mac: extra.mac || current.mac,
            name: extra.name ?? current.name,
            board: extra.board ?? current.board,
            vendor: extra.vendor || current.vendor
          })
        )
        logger.info(`discovery ssdp describe ${extra.vendor || extra.board || 'device'}`)
      }
    })
  )

  return sortDiscoveryDevices([...found.values()])
}

async function discoverCameras(
  signal: AbortSignal,
  options: { skipSsdp?: boolean } = {}
): Promise<DiscoveryDevice[]> {
  const [onvif, sadp, dahua, dvrip, ssdp, mdns] = await Promise.all([
    discoverUdpCameras(
      'onvif',
      WS_DISCOVERY_PORT,
      WS_DISCOVERY_ADDR,
      [buildWsDiscoveryProbe(), buildWsDiscoveryGenericProbe()],
      (message, sourceIp) => parseWsDiscoveryMessage(decodeDiscoveryDocument(message), sourceIp),
      signal
    ),
    discoverUdpCameras(
      'sadp',
      SADP_PORT,
      SADP_ADDR,
      [buildSadpInquiry()],
      parseSadpMessage,
      signal
    ),
    discoverUdpCameras(
      'dahua',
      DAHUA_DISCOVERY_PORT,
      DAHUA_DISCOVERY_ADDR,
      [buildDahuaSearch(), buildDahuaSearchDhip(), buildDahuaSearchPing()],
      parseDahuaDiscovery,
      signal
    ),
    discoverUdpCameras(
      'dvrip',
      DVRIP_DISCOVERY_PORT,
      undefined,
      [buildDvripSearch()],
      parseDahuaDiscovery,
      signal
    ),
    options.skipSsdp ? Promise.resolve([]) : discoverSsdp(signal),
    discoverUdpCameras('mdns', MDNS_PORT, MDNS_ADDR, buildMdnsCameraQueries(), parseMdnsMessage, signal)
  ])

  const found = new Map<string, DiscoveryDevice>()
  for (const device of [...onvif, ...sadp, ...dahua, ...dvrip, ...ssdp, ...mdns]) {
    rememberDevice(found, device)
  }
  logger.info(
    `discovery cameras onvif=${onvif.length} sadp=${sadp.length} dahua=${dahua.length} dvrip=${dvrip.length} ssdp=${ssdp.length} mdns=${mdns.length}`
  )
  return sortDiscoveryDevices([...found.values()])
}

async function discoverGroup(
  label: string,
  worker: (signal: AbortSignal) => Promise<DiscoveryDevice[]>,
  signal: AbortSignal
): Promise<DiscoveryDevice[]> {
  try {
    return await worker(signal)
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.message === 'Aborted')) throw error
    logger.warn(`discovery ${label} failed`, error)
    return []
  }
}

function trackKey(device: DiscoveryDevice): string {
  return `${device.kind}:${device.ip}`
}

function publishWatch(): void {
  if (!watch) return
  const result: DiscoveryScanResult = { ok: true, devices: snapshotWatch(), watching: true }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    window.webContents.send('discovery:update', result)
  }
}

function isTrackedLive(device: TrackedDevice, now = Date.now()): boolean {
  return device.online && now < device.expireAt
}

function snapshotWatch(): DiscoveryDevice[] {
  if (!watch) return []
  const now = Date.now()
  return sortDiscoveryDevices(
    dedupeDiscoveryDevices(
      [...watch.devices.values()].filter((device) => isTrackedLive(device, now)).map((device) => ({
        ...device,
        board: usableDiscoveryBoard(device.board),
        online: true
      }))
    )
  )
}

function sameHost(left: DiscoveryDevice, right: DiscoveryDevice): boolean {
  if (left.ip === right.ip) return true
  const leftMac = usableMac(left.mac)
  const rightMac = usableMac(right.mac)
  return Boolean(leftMac && rightMac && leftMac === rightMac)
}

function isGenericKind(kind: DiscoveryDevice['kind']): boolean {
  return kind === 'other' || kind === 'repka'
}

function upsertWatch(
  device: DiscoveryDevice,
  options: { bye?: boolean; maxAgeSec?: number | null; fromProbe?: boolean } = {}
): void {
  if (!watch || options.bye) return
  const now = Date.now()
  const key = trackKey(device)
  if (isGenericKind(device.kind)) {
    for (const existing of watch.devices.values()) {
      if (isGenericKind(existing.kind) || !sameHost(existing, device)) continue
      return
    }
  }
  for (const [existingKey, existing] of watch.devices) {
    if (existingKey === key || !sameHost(existing, device)) continue
    const weaker =
      isGenericKind(existing.kind) || (device.kind === 'mikrotik' && existing.kind === 'cameras')
    if (!weaker) continue
    watch.devices.delete(existingKey)
    if (![...watch.devices.values()].some((item) => item.ip === existing.ip)) {
      watch.described.delete(existing.ip)
    }
  }
  const current = watch.devices.get(key)
  const normalized = { ...device, mac: usableMac(device.mac), board: usableDiscoveryBoard(device.board) }
  const merged = current ? mergeDiscoveryDevice(current, normalized) : normalized
  const advertisedMs = options.maxAgeSec ? options.maxAgeSec * 1000 + 20_000 : DEFAULT_STALE_MS
  const staleMs = Math.min(advertisedMs, DEFAULT_STALE_MS)
  const next: TrackedDevice = {
    ...merged,
    seenAt: now,
    expireAt: now + staleMs,
    online: true,
    probeSeen: Boolean(options.fromProbe || current?.probeSeen)
  }
  watch.devices.set(key, next)
}

function dropMissedProbeDevices(probeKeys: Set<string>, roundStarted: number): void {
  if (!watch) return
  for (const [key, device] of watch.devices) {
    // L3 hosts stay until the stale timer. One missed ICMP reply in a /24 sweep is common.
    if (device.kind !== 'mikrotik' && device.kind !== 'cameras') continue
    if (!device.probeSeen || probeKeys.has(key) || device.seenAt >= roundStarted) continue
    watch.devices.delete(key)
    watch.described.delete(device.ip)
    logger.info(`discovery drop ${key}`)
  }
}

function sweepWatch(): boolean {
  if (!watch) return false
  const now = Date.now()
  let changed = false
  for (const [key, device] of watch.devices) {
    if (isTrackedLive(device, now)) continue
    watch.devices.delete(key)
    watch.described.delete(device.ip)
    changed = true
  }
  return changed
}

async function describeWatchDevice(ip: string, location: string): Promise<void> {
  if (!watch || watch.described.has(ip)) return
  watch.described.add(ip)
  const xml = await fetchUpnpDescription(location)
  if (!watch || !xml) return
  const extra = parseUpnpDeviceDescription(xml)
  const current = [...watch.devices.values()].find((device) => device.ip === ip)
  if (!current?.online) return
  upsertWatch({
    ...current,
    mac: extra.mac || current.mac,
    name: extra.name ?? current.name,
    board: extra.board ?? current.board,
    vendor: extra.vendor || current.vendor
  })
  publishWatch()
}

async function attachWatchSsdp(signal: AbortSignal): Promise<void> {
  if (!watch) return
  const ifaces = listScanInterfaces()
  const localIps = new Set(ifaces.map((iface) => iface.address))
  const listen = createSocket({ type: 'udp4', reuseAddr: true })
  await bindUdp(listen, SSDP_PORT)
  listen.setBroadcast(true)
  listen.on('error', (error) => logger.warn('discovery ssdp watch error', error))
  listen.on('message', (message, rinfo) => {
    if (localIps.has(rinfo.address)) return
    const devices = parseSsdpResponse(message, rinfo.address)
    if (!devices.length) return
    const bye = isSsdpBye(message)
    const maxAgeSec = ssdpMaxAgeSec(message)
    const location = ssdpLocation(message)
    for (const device of devices) {
      if (localIps.has(device.ip)) continue
      const current = watch?.devices.get(trackKey(device))
      if (current && isPlaceholderBoard(current.board)) watch?.described.delete(device.ip)
      upsertWatch(device, { bye, maxAgeSec })
      if (!bye && location) void describeWatchDevice(device.ip, location)
    }
    publishWatch()
  })
  for (const iface of ifaces) {
    try {
      listen.addMembership(SSDP_ADDR, iface.address)
    } catch (error) {
      logger.warn(`discovery ssdp watch join ${iface.name} failed`, error)
    }
  }
  watch.sockets.push(listen)
  signal.addEventListener(
    'abort',
    () => {
      closeSocket(listen)
    },
    { once: true }
  )
}

async function runProbeRound(signal: AbortSignal, skipSsdp: boolean): Promise<void> {
  const roundStarted = Date.now()
  const ifaces = listScanInterfaces()
  const localIps = new Set(ifaces.map((iface) => iface.address))
  const [mikrotik, cameras, pingAlive] = await Promise.all([
    discoverGroup('mndp', discoverMikrotik, signal),
    discoverGroup('onvif', (inner) => discoverCameras(inner, { skipSsdp }), signal),
    pingLiveHosts(ifaces, localIps, signal)
  ])
  if (signal.aborted) return
  const neighbors = await readNeighborMacs()
  const announced = [...mikrotik, ...cameras]
  const others = otherFromAlive(pingAlive, neighbors, {
    ips: new Set([...localIps, ...announced.map((device) => device.ip)]),
    macs: new Set(announced.map((device) => device.mac))
  })
  const probed = applyNeighborMacs([...announced, ...others], neighbors)
  const unnamed = probed.filter((device) => !device.name?.trim()).map((device) => device.ip)
  const netbios = await readNetbiosNames(unnamed, signal)
  if (signal.aborted) return
  const httpNames = await readHttpDeviceTitles(
    unnamed.filter((ip) => !netbios.has(ip)),
    signal
  )
  if (signal.aborted) return
  for (const device of probed) {
    const name = device.name?.trim() ? device.name : (netbios.get(device.ip) ?? httpNames.get(device.ip) ?? null)
    upsertWatch(name === device.name ? device : { ...device, name }, { fromProbe: true })
  }
  dropMissedProbeDevices(new Set(probed.map((device) => trackKey(device))), roundStarted)
  sweepWatch()
  const snapshot = snapshotWatch()
  const online = snapshot.filter((device) => device.online !== false).length
  logger.info(`discovery watch online=${online} total=${snapshot.length}`)
}

async function watchLoop(signal: AbortSignal): Promise<void> {
  try {
    await attachWatchSsdp(signal)
    await runProbeRound(signal, true)
    if (!signal.aborted) publishWatch()
    while (!signal.aborted) {
      await wait(PROBE_EVERY_MS, signal)
      if (signal.aborted) break
      await runProbeRound(signal, true)
      if (!signal.aborted) publishWatch()
    }
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.message === 'Aborted')) return
    logger.warn('discovery watch failed', error)
  }
}

function stopWatch(): void {
  if (!watch) return
  watch.controller.abort()
  if (watch.staleTimer) clearInterval(watch.staleTimer)
  for (const socket of watch.sockets) closeSocket(socket)
  watch = null
  activeScan = null
}

async function startWatch(): Promise<DiscoveryScanResult> {
  if (watch) return { ok: true, devices: snapshotWatch(), watching: true }
  const controller = new AbortController()
  activeScan = controller
  watch = {
    controller,
    devices: new Map(),
    sockets: [],
    described: new Set(),
    loop: null,
    staleTimer: setInterval(() => {
      if (sweepWatch()) publishWatch()
    }, STALE_CHECK_MS)
  }
  watch.loop = watchLoop(controller.signal)
  try {
    await wait(LISTEN_MS + 800, controller.signal)
  } catch {
    return { ok: true, devices: snapshotWatch(), watching: true, cancelled: true }
  }
  return { ok: true, devices: snapshotWatch(), watching: true }
}

async function runDiscoveryScan(): Promise<DiscoveryScanResult> {
  if (watch) {
    try {
      await runProbeRound(watch.controller.signal, true)
      publishWatch()
    } catch (error) {
      if (watch.controller.signal.aborted) {
        return { ok: true, devices: snapshotWatch(), watching: true, cancelled: true }
      }
      const message = error instanceof Error ? error.message : 'Не удалось выполнить поиск'
      return { ok: false, devices: snapshotWatch(), watching: true, error: message }
    }
    return { ok: true, devices: snapshotWatch(), watching: true }
  }
  return startWatch()
}

export function setupDiscovery(): void {
  ipcMain.handle('discovery:scan', async (): Promise<DiscoveryScanResult> => runDiscoveryScan())
  ipcMain.handle('discovery:watch', async (): Promise<DiscoveryScanResult> => startWatch())
  ipcMain.handle('discovery:cancel', async (): Promise<{ ok: boolean }> => {
    stopWatch()
    return { ok: true }
  })
}
