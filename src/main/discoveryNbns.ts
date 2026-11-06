/**
 * NetBIOS node-status (UDP/137). Windows answers with the computer name.
 */
import { createSocket, type Socket } from 'dgram'
import { isIPv4 } from './discoveryMndp'
import { decodeDiscoveryBytes, normalizeDiscoveryText } from './discoveryText'

const NBNS_PORT = 137
const NBSTAT = 0x0021
const QUERY_MS = 700

const STATUS_NAME = Buffer.from(' CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\0', 'ascii')

export function buildNbnsStatusQuery(transactionId = 0x8194): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(transactionId & 0xffff, 0)
  header.writeUInt16BE(1, 4)
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(NBSTAT, 0)
  tail.writeUInt16BE(1, 2)
  return Buffer.concat([header, STATUS_NAME, tail])
}

function skipName(packet: Buffer, offset: number): number | null {
  let pos = offset
  while (pos < packet.length) {
    const size = packet[pos]
    if (size === 0) return pos + 1
    if ((size & 0xc0) === 0xc0) return pos + 2 <= packet.length ? pos + 2 : null
    pos += 1 + size
  }
  return null
}

/** Unique workstation name (suffix 0x00). Group names such as WORKGROUP are skipped. */
export function parseNbnsStatus(packet: Buffer): string | null {
  if (packet.length < 56) return null
  const flags = packet.readUInt16BE(2)
  if ((flags & 0x8000) === 0 || packet.readUInt16BE(6) < 1) return null
  let pos = 12
  const questions = packet.readUInt16BE(4)
  for (let index = 0; index < questions; index += 1) {
    const next = skipName(packet, pos)
    if (next === null) return null
    pos = next + 4
  }
  const answer = skipName(packet, pos)
  if (answer === null || answer + 10 > packet.length) return null
  if (packet.readUInt16BE(answer) !== NBSTAT) return null
  const rdlength = packet.readUInt16BE(answer + 8)
  pos = answer + 10
  if (rdlength < 1 || pos + rdlength > packet.length) return null
  const count = packet[pos]
  pos += 1
  for (let index = 0; index < count; index += 1) {
    if (pos + 18 > packet.length) return null
    const suffix = packet[pos + 15]
    const nameFlags = packet.readUInt16BE(pos + 16)
    const unique = (nameFlags & 0x8000) === 0
    if (suffix === 0x00 && unique) {
      const name = normalizeDiscoveryText(
        decodeDiscoveryBytes(packet.subarray(pos, pos + 15), { prefer: 'cp866' })
      )
      if (name) return name
    }
    pos += 18
  }
  return null
}

function closeSocket(socket: Socket): void {
  try {
    socket.close()
  } catch {
    // already closed
  }
}

export function readNetbiosNames(ips: string[], signal: AbortSignal): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const targets = [...new Set(ips.filter((ip) => isIPv4(ip)))]
  if (!targets.length || signal.aborted) return Promise.resolve(found)

  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      closeSocket(socket)
      resolve(found)
    }
    const onAbort = (): void => finish()
    const timer = setTimeout(finish, QUERY_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    socket.on('message', (message, rinfo) => {
      if (!isIPv4(rinfo.address) || found.has(rinfo.address)) return
      const name = parseNbnsStatus(message)
      if (name) found.set(rinfo.address, name)
    })
    socket.on('error', () => finish())
    socket.once('listening', () => {
      const query = buildNbnsStatusQuery()
      for (const ip of targets) {
        socket.send(query, NBNS_PORT, ip, () => undefined)
      }
    })
    socket.bind(0)
  })
}
