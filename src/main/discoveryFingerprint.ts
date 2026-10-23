/**
 * Classify silent LAN hosts after ICMP. Repka Pi ethernet uses locally
 * administered MAC 02:07:B0. Every other on-link answer is an L3 host.
 */
import type { DiscoveryDevice, DiscoveryDeviceKind } from '../shared/api'
import { isIPv4 } from './discoveryMndp'
import { normalizeMacString } from './discoveryWs'

const REPKA_MAC_PREFIX = '02:07:B0:'
const UNUSABLE_MAC = new Set(['', '00:00:00:00:00:00', 'FF:FF:FF:FF:FF:FF'])

const KIND_RANK: Record<DiscoveryDeviceKind, number> = {
  mikrotik: 0,
  cameras: 1,
  repka: 2,
  other: 3
}

export function usableMac(mac: string): string {
  const normalized = normalizeMacString(mac)
  return UNUSABLE_MAC.has(normalized) ? '' : normalized
}

export function isRepkaMac(mac: string): boolean {
  const normalized = normalizeMacString(mac)
  return normalized.startsWith(REPKA_MAC_PREFIX)
}

export function repkaFromNeighbor(ip: string, mac: string): DiscoveryDevice | null {
  if (!isRepkaMac(mac)) return null
  return {
    ip,
    mac: normalizeMacString(mac),
    name: null,
    board: null,
    vendor: 'Repka Pi',
    kind: 'repka'
  }
}

export function repkaFromAlive(alive: string[], neighbors: Map<string, string>): DiscoveryDevice[] {
  const found: DiscoveryDevice[] = []
  for (const ip of alive) {
    const mac = neighbors.get(ip)
    if (!mac) continue
    const device = repkaFromNeighbor(ip, mac)
    if (device) found.push(device)
  }
  return found
}

export function repkaFromNeighbors(
  neighbors: Map<string, string>,
  skipIps: Set<string> = new Set()
): DiscoveryDevice[] {
  const found: DiscoveryDevice[] = []
  for (const [ip, mac] of neighbors) {
    if (skipIps.has(ip)) continue
    const device = repkaFromNeighbor(ip, mac)
    if (device) found.push(device)
  }
  return found
}

/** On-link ICMP answers that did not already announce as MikroTik or a camera. */
export function otherFromAlive(
  alive: string[],
  neighbors: Map<string, string>,
  skip: { ips?: Set<string>; macs?: Set<string> } = {}
): DiscoveryDevice[] {
  const skipIps = skip.ips ?? new Set<string>()
  const skipMacs = new Set([...(skip.macs ?? [])].map((mac) => usableMac(mac)).filter(Boolean))
  const seenIps = new Set<string>()
  const seenMacs = new Set<string>()
  const found: DiscoveryDevice[] = []

  for (const ip of alive) {
    if (!isIPv4(ip) || skipIps.has(ip) || seenIps.has(ip)) continue
    const mac = usableMac(neighbors.get(ip) ?? '')
    if (mac && (skipMacs.has(mac) || seenMacs.has(mac))) continue
    seenIps.add(ip)
    if (mac) seenMacs.add(mac)
    found.push({
      ip,
      mac,
      name: null,
      board: null,
      vendor: mac && isRepkaMac(mac) ? 'Repka Pi' : '',
      kind: 'other'
    })
  }
  return found
}

/**
 * One row per host. Devices that share an IP stay separate when their MACs differ.
 * The same MAC, or a later hit with no MAC of its own, collapses into the row already kept.
 * An L2 announcement wins over a generic L3 hit.
 */
export function dedupeDiscoveryDevices(devices: DiscoveryDevice[]): DiscoveryDevice[] {
  const ranked = [...devices].sort((left, right) => KIND_RANK[left.kind] - KIND_RANK[right.kind])
  const macs = new Set<string>()
  const kept: DiscoveryDevice[] = []
  const indexByIp = new Map<string, number>()

  for (const device of ranked) {
    const mac = usableMac(device.mac)
    if (mac && macs.has(mac)) continue
    const next = mac === device.mac ? device : { ...device, mac }
    const priorIndex = indexByIp.get(device.ip)
    if (priorIndex === undefined) {
      if (mac) macs.add(mac)
      indexByIp.set(device.ip, kept.length)
      kept.push(next)
      continue
    }

    const prior = kept[priorIndex]
    const priorMac = usableMac(prior.mac)
    if (mac && priorMac && mac !== priorMac) {
      macs.add(mac)
      kept.push(next)
      continue
    }
    if (mac && !priorMac && prior.kind === device.kind) {
      macs.add(mac)
      kept[priorIndex] = next
    }
  }
  return kept
}
