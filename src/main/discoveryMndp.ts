/**
 * MNDP (MikroTik Neighbor Discovery Protocol) packet helpers.
 * UDP/5678 TLV format used by WinBox Neighbors.
 */
import type { DiscoveryDevice } from '../shared/api'
import { isPlaceholderDiscoveryBoard } from '../shared/discoveryBoard'
import { decodeDiscoveryBytes, normalizeDiscoveryText } from './discoveryText'

export const MNDP_PORT = 5678
export const MNDP_REQUEST = Buffer.from([0, 0, 0, 0])

const TLV_MAC = 1
const TLV_IDENTITY = 5
const TLV_VERSION = 7
const TLV_PLATFORM = 8
const TLV_BOARD = 12
const TLV_IPV4 = 17

const TUNNEL_IFACE_RE = /^(utun|tun|tap|ppp|ipsec|wg|awdl|llw|anpi)/i
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/

export function isTunnelInterface(name: string): boolean {
  return TUNNEL_IFACE_RE.test(name.trim())
}

export function isIPv4(value: string): boolean {
  if (!IPV4_RE.test(value)) return false
  return value.split('.').every((part) => {
    const n = Number(part)
    return Number.isInteger(n) && n >= 0 && n <= 255
  })
}

export function formatMac(bytes: Buffer): string | null {
  if (bytes.length !== 6) return null
  return [...bytes].map((octet) => octet.toString(16).padStart(2, '0')).join(':').toUpperCase()
}

export function ipv4FromBytes(bytes: Buffer): string | null {
  if (bytes.length !== 4) return null
  const value = `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`
  return isIPv4(value) ? value : null
}

export function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

export function intToIpv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

export function directedBroadcast(address: string, netmask: string): string | null {
  if (!isIPv4(address) || !isIPv4(netmask)) return null
  return intToIpv4((ipv4ToInt(address) | (~ipv4ToInt(netmask) >>> 0)) >>> 0)
}

function readTlvString(bytes: Buffer): string {
  return normalizeDiscoveryText(decodeDiscoveryBytes(bytes))
}

export interface ParsedMndpNeighbor {
  ip: string
  mac: string
  identity: string | null
  platform: string | null
  board: string | null
  version: string | null
}

export function parseMndpPacket(packet: Buffer, sourceIp: string): ParsedMndpNeighbor | null {
  if (packet.length < 8) return null

  let offset = 4
  let mac = ''
  let identity: string | null = null
  let platform: string | null = null
  let board: string | null = null
  let version: string | null = null
  let ip = isIPv4(sourceIp) ? sourceIp : ''
  let knownTlv = false

  while (offset + 4 <= packet.length) {
    const type = packet.readUInt16BE(offset)
    const length = packet.readUInt16BE(offset + 2)
    offset += 4
    if (offset + length > packet.length) break
    const payload = packet.subarray(offset, offset + length)
    offset += length

    switch (type) {
      case TLV_MAC: {
        const formatted = formatMac(payload)
        if (formatted) {
          mac = formatted
          knownTlv = true
        }
        break
      }
      case TLV_IDENTITY: {
        const value = readTlvString(payload)
        if (value) {
          identity = value
          knownTlv = true
        }
        break
      }
      case TLV_VERSION: {
        const value = readTlvString(payload)
        if (value) {
          version = value
          knownTlv = true
        }
        break
      }
      case TLV_PLATFORM: {
        const value = readTlvString(payload)
        if (value) {
          platform = value
          knownTlv = true
        }
        break
      }
      case TLV_BOARD: {
        const value = readTlvString(payload)
        if (value) {
          board = value
          knownTlv = true
        }
        break
      }
      case TLV_IPV4: {
        const parsedIp = ipv4FromBytes(payload)
        if (parsedIp) {
          ip = parsedIp
          knownTlv = true
        }
        break
      }
      default:
        break
    }
  }

  if (!knownTlv || !ip) return null
  return { ip, mac, identity, platform, board, version }
}

export function neighborToDevice(neighbor: ParsedMndpNeighbor): DiscoveryDevice {
  return {
    ip: neighbor.ip,
    mac: neighbor.mac,
    name: neighbor.identity,
    board: neighbor.board,
    vendor: 'MikroTik',
    kind: 'mikrotik'
  }
}

export function deviceKey(device: DiscoveryDevice): string {
  return device.mac || device.ip
}

export function isPlaceholderBoard(board: string | null | undefined): boolean {
  return isPlaceholderDiscoveryBoard(board)
}

export function usableDiscoveryBoard(board: string | null | undefined): string | null {
  const value = board?.trim() ?? ''
  if (!value || isPlaceholderBoard(value)) return null
  return value
}

export function mergeDiscoveryDevice(current: DiscoveryDevice, incoming: DiscoveryDevice): DiscoveryDevice {
  return {
    ip: incoming.ip || current.ip,
    mac: current.mac || incoming.mac,
    name: incoming.name ?? current.name,
    board: usableDiscoveryBoard(incoming.board) ?? usableDiscoveryBoard(current.board),
    vendor: current.vendor || incoming.vendor,
    kind: incoming.kind
  }
}

export function compareIpv4(a: string, b: string): number {
  if (!isIPv4(a) || !isIPv4(b)) return a.localeCompare(b)
  return ipv4ToInt(a) - ipv4ToInt(b)
}

export function sortDiscoveryDevices(devices: DiscoveryDevice[]): DiscoveryDevice[] {
  return [...devices].sort((left, right) => compareIpv4(left.ip, right.ip) || left.mac.localeCompare(right.mac))
}
