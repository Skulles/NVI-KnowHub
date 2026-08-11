import type { MonitoringLanHints } from '@shared/api'

export const LAN_ENTER_LATENCY_MS = 10
export const LAN_EXIT_LATENCY_MS = 20

export function ipv4Octets(host: string): [number, number, number, number] | null {
  const parts = host.trim().split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null
  })
  if (octets.some((value) => value === null)) return null
  return octets as [number, number, number, number]
}

export function sameSubnet24(left: string, right: string): boolean {
  const a = ipv4Octets(left)
  const b = ipv4Octets(right)
  if (!a || !b) return false
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export function objectMatchesLanSubnet(
  object: { serverHost: string; linkHost: string },
  hints: MonitoringLanHints
): boolean {
  const anchors = [object.serverHost, object.linkHost]
  const inObjectSubnet = (ip: string): boolean => anchors.some((anchor) => sameSubnet24(ip, anchor))

  // Prefer gateway match (user requirement); local address covers on-link routes without IP gateway.
  if (hints.gateways.some(inObjectSubnet)) return true
  return hints.localAddresses.some(inObjectSubnet)
}

export function resolveLanActiveObjectId(input: {
  objects: Array<{ id: string; serverHost: string; linkHost: string }>
  hints: MonitoringLanHints | null
  serverLatencyByObjectId: Record<string, number | null | undefined>
  serverOnlineByObjectId: Record<string, boolean>
  currentLanObjectId: string | null
}): string | null {
  const { objects, hints, serverLatencyByObjectId, serverOnlineByObjectId, currentLanObjectId } =
    input
  if (!hints || objects.length === 0) return null

  const subnetMatches = objects.filter((object) => objectMatchesLanSubnet(object, hints))
  if (subnetMatches.length === 0) return null

  if (currentLanObjectId) {
    const current = subnetMatches.find((object) => object.id === currentLanObjectId)
    if (current) {
      const online = serverOnlineByObjectId[current.id] === true
      const latency = serverLatencyByObjectId[current.id]
      if (online && typeof latency === 'number' && latency < LAN_EXIT_LATENCY_MS) {
        return current.id
      }
      // Keep LAN briefly while a probe is in flight (online but latency not yet known).
      if (online && (latency === null || latency === undefined)) {
        return current.id
      }
    }
  }

  const enterMatches = subnetMatches.filter((object) => {
    if (serverOnlineByObjectId[object.id] !== true) return false
    const latency = serverLatencyByObjectId[object.id]
    return typeof latency === 'number' && latency < LAN_ENTER_LATENCY_MS
  })

  if (enterMatches.length === 1) return enterMatches[0].id
  return null
}
