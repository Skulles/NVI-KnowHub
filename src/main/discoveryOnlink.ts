/**
 * On-link IPv4 ranges plus a small extra host list for field Repka Pi boards.
 * Extra: 192.168.3.152 always; 10.{64-80}.{0-99}.{40-50} on a full scan (~18.7k).
 */
import { intToIpv4, ipv4ToInt, isIPv4 } from './discoveryMndp'

export const EXTRA_SINGLE_IPS = ['192.168.3.152'] as const
export const MAX_SCAN_PREFIX = 22

const REPKA_OCTET2_MIN = 64
const REPKA_OCTET2_MAX = 80
const REPKA_OCTET3_MAX = 99
const REPKA_OCTET4_MIN = 40
const REPKA_OCTET4_MAX = 50

export interface OnlinkIface {
  name: string
  address: string
  netmask: string
}

export function netmaskToPrefix(netmask: string): number | null {
  if (!isIPv4(netmask)) return null
  const value = ipv4ToInt(netmask)
  const hostBits = value === 0 ? 32 : 31 - Math.clz32(value & -value)
  const prefix = 32 - hostBits
  const expected = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return value === expected ? prefix : null
}

export function parseCidr(cidr: string): { network: number; prefix: number } | null {
  const [ip, prefixText] = cidr.split('/')
  if (!ip || !isIPv4(ip) || prefixText === undefined) return null
  const prefix = Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { network: (ipv4ToInt(ip) & mask) >>> 0, prefix }
}

export function scanPrefixForAddress(address: string, netmask: string): number | null {
  const prefix = netmaskToPrefix(netmask)
  if (prefix === null || !isIPv4(address)) return null
  return Math.max(prefix, MAX_SCAN_PREFIX)
}

export function hostsInPrefix(address: string, prefix: number, skip: Set<string> = new Set()): string[] {
  if (!isIPv4(address) || !Number.isInteger(prefix) || prefix < 8 || prefix > 30) return []
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  const network = ipv4ToInt(address) & mask
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const hostCount = ((broadcast - network) >>> 0) - 1
  if (hostCount < 1 || hostCount > 1022) return []
  const hosts: string[] = []
  for (let i = 1; i <= hostCount; i++) {
    const ip = intToIpv4((network + i) >>> 0)
    if (skip.has(ip)) continue
    hosts.push(ip)
  }
  return hosts
}

export function hostsInCidr(cidr: string, skip: Set<string> = new Set()): string[] {
  const parsed = parseCidr(cidr)
  if (!parsed) return []
  return hostsInPrefix(intToIpv4(parsed.network), parsed.prefix, skip)
}

export function collectOnlinkPingTargets(ifaces: OnlinkIface[]): string[] {
  const skip = new Set(ifaces.map((iface) => iface.address))
  const hosts = new Set<string>()
  for (const iface of ifaces) {
    const prefix = scanPrefixForAddress(iface.address, iface.netmask)
    if (prefix === null) continue
    for (const ip of hostsInPrefix(iface.address, prefix, skip)) hosts.add(ip)
  }
  return [...hosts]
}

export function ipOnlinkAny(ip: string, ifaces: OnlinkIface[]): boolean {
  if (!isIPv4(ip)) return false
  const value = ipv4ToInt(ip)
  for (const iface of ifaces) {
    const prefix = netmaskToPrefix(iface.netmask)
    if (prefix === null || !isIPv4(iface.address)) continue
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    if ((value & mask) >>> 0 === (ipv4ToInt(iface.address) & mask) >>> 0) return true
  }
  return false
}

let cachedRepkaGrid: string[] | null = null

export function listRepkaFieldGrid(): string[] {
  if (cachedRepkaGrid) return cachedRepkaGrid
  const hosts: string[] = []
  for (let second = REPKA_OCTET2_MIN; second <= REPKA_OCTET2_MAX; second++) {
    for (let third = 0; third <= REPKA_OCTET3_MAX; third++) {
      for (let fourth = REPKA_OCTET4_MIN; fourth <= REPKA_OCTET4_MAX; fourth++) {
        hosts.push(`10.${second}.${third}.${fourth}`)
      }
    }
  }
  cachedRepkaGrid = hosts
  return hosts
}

export function collectOfflinkExtraTargets(
  ifaces: OnlinkIface[],
  options: { includeGrid?: boolean } = {}
): string[] {
  const skip = new Set(ifaces.map((iface) => iface.address))
  const hosts = new Set<string>()

  const add = (ip: string): void => {
    if (skip.has(ip) || ipOnlinkAny(ip, ifaces)) return
    hosts.add(ip)
  }

  for (const ip of EXTRA_SINGLE_IPS) add(ip)
  if (options.includeGrid) {
    for (const ip of listRepkaFieldGrid()) add(ip)
  }
  return [...hosts]
}

export function collectPingTargets(ifaces: OnlinkIface[]): string[] {
  return [...new Set([...collectOnlinkPingTargets(ifaces), ...EXTRA_SINGLE_IPS.filter((ip) => !ifaces.some((iface) => iface.address === ip))])]
}
