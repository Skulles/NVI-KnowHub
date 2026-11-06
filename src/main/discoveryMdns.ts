/**
 * Bonjour / mDNS neighbor queries used by Trassir cameras (UPnP analog).
 */
import type { DiscoveryDevice } from '../shared/api'
import { isIPv4 } from './discoveryMndp'
import { decodeDiscoveryBytes, normalizeDiscoveryText } from './discoveryText'
import { vendorFromOnvifText } from './discoveryWs'

export const MDNS_PORT = 5353
export const MDNS_ADDR = '224.0.0.251'

const CAMERA_NAME = /onvif|_rtsp|_nvd|trassir|activecam|\btr-d|ip.?cam|_axis-video/i

function encodeDnsName(name: string): Buffer {
  const labels = name.split('.').filter(Boolean)
  const chunks: Buffer[] = []
  for (const label of labels) {
    const bytes = Buffer.from(label)
    chunks.push(Buffer.from([bytes.length]), bytes)
  }
  chunks.push(Buffer.from([0]))
  return Buffer.concat(chunks)
}

export function buildMdnsPtrQuery(name: string): Buffer {
  const qname = encodeDnsName(name)
  const header = Buffer.alloc(12)
  header.writeUInt16BE(1, 4)
  const question = Buffer.alloc(4)
  question.writeUInt16BE(12, 0)
  question.writeUInt16BE(1, 2)
  return Buffer.concat([header, qname, question])
}

export function buildMdnsCameraQueries(): Buffer[] {
  return [
    buildMdnsPtrQuery('_onvif._tcp.local'),
    buildMdnsPtrQuery('_rtsp._tcp.local')
  ]
}

function readDnsName(packet: Buffer, offset: number, hops = 0): { name: string; next: number } {
  if (hops > 10 || offset >= packet.length) return { name: '', next: offset }
  const labels: string[] = []
  let i = offset
  let next = offset
  let jumped = false

  while (i < packet.length) {
    const len = packet[i]
    if (len === 0) {
      if (!jumped) next = i + 1
      break
    }
    if ((len & 0xc0) === 0xc0) {
      if (i + 1 >= packet.length) break
      const pointer = ((len & 0x3f) << 8) | packet[i + 1]
      if (!jumped) next = i + 2
      const nested = readDnsName(packet, pointer, hops + 1)
      if (nested.name) labels.push(nested.name)
      jumped = true
      break
    }
    const end = i + 1 + len
    if (end > packet.length) break
    labels.push(normalizeDiscoveryText(decodeDiscoveryBytes(packet.subarray(i + 1, end))))
    i = end
    if (!jumped) next = i
  }

  return { name: labels.filter(Boolean).join('.'), next: jumped ? next : next }
}

export function parseMdnsMessage(packet: Buffer, sourceIp: string): DiscoveryDevice[] {
  if (packet.length < 12) return []
  const qdcount = packet.readUInt16BE(4)
  const ancount = packet.readUInt16BE(6)
  const nscount = packet.readUInt16BE(8)
  const arcount = packet.readUInt16BE(10)
  const total = qdcount + ancount + nscount + arcount
  if (total === 0) return []

  let offset = 12
  const hosts = new Map<string, string>()
  const names: string[] = []

  for (let i = 0; i < total; i++) {
    const read = readDnsName(packet, offset)
    offset = read.next
    if (offset + 4 > packet.length) break
    const type = packet.readUInt16BE(offset)
    offset += 4
    if (i < qdcount) continue
    if (offset + 6 > packet.length) break
    offset += 4
    const rdlength = packet.readUInt16BE(offset)
    offset += 2
    const rdataEnd = offset + rdlength
    if (rdataEnd > packet.length) break

    if (type === 1 && rdlength === 4) {
      const ip = `${packet[offset]}.${packet[offset + 1]}.${packet[offset + 2]}.${packet[offset + 3]}`
      if (isIPv4(ip)) hosts.set(read.name.toLowerCase(), ip)
    } else if (type === 12 || type === 33) {
      const targetOffset = type === 33 ? offset + 6 : offset
      const target = type === 33 ? readDnsName(packet, targetOffset).name : readDnsName(packet, offset).name
      names.push(read.name, target)
    } else {
      names.push(read.name)
    }
    offset = rdataEnd
  }

  const hostNames = [...hosts.keys()]
  const blob = `${names.join(' ')} ${hostNames.join(' ')}`
  if (!CAMERA_NAME.test(blob)) return []

  const cameraName =
    names.find((name) => CAMERA_NAME.test(name) && !name.startsWith('_')) ??
    hostNames.find((name) => CAMERA_NAME.test(name)) ??
    names[0] ??
    hostNames[0] ??
    null
  const ips = new Set<string>()
  for (const ip of hosts.values()) ips.add(ip)
  if (ips.size === 0 && isIPv4(sourceIp)) ips.add(sourceIp)

  const vendor = vendorFromOnvifText(cameraName, blob)
  return [...ips].map((ip) => ({
    ip,
    mac: '',
    name: cameraName,
    board: null,
    vendor: vendor === 'ONVIF' ? 'Bonjour' : vendor,
    kind: 'cameras' as const
  }))
}
