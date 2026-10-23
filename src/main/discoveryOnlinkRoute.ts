/**
 * Temporary on-link routes for 192.168.0.0/24, 192.168.1.0/24, and 192.168.3.152/32.
 * Windows sends ping to a foreign subnet only through a gateway. On a switch
 * with no gateway, an on-link route (no next hop) makes the NIC ARP for those
 * addresses. A high metric loses to a real route for the same prefix.
 * Routes use the active store and are removed when the scan stops.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { EXTRA_HOST_CIDRS, EXTRA_SCAN_CIDRS, netmaskToPrefix, parseCidr, type OnlinkIface } from './discoveryOnlink'
import { ipv4ToInt, isIPv4 } from './discoveryMndp'
import { logger } from './logger'

const execFileAsync = promisify(execFile)
const ONLINK_ROUTE_METRIC = 9000

export interface ExtraOnlinkRoute {
  iface: string
  cidr: string
}

export function cidrCoveredByIface(cidr: string, iface: OnlinkIface): boolean {
  const parsed = parseCidr(cidr)
  const prefix = netmaskToPrefix(iface.netmask)
  if (!parsed || prefix === null || !isIPv4(iface.address)) return false
  if (prefix > parsed.prefix) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (parsed.network & mask) >>> 0 === (ipv4ToInt(iface.address) & mask) >>> 0
}

export function extraRoutesToInstall(
  ifaces: OnlinkIface[],
  cidrs: readonly string[] = [...EXTRA_SCAN_CIDRS, ...EXTRA_HOST_CIDRS]
): ExtraOnlinkRoute[] {
  const routes: ExtraOnlinkRoute[] = []
  const seen = new Set<string>()
  for (const cidr of cidrs) {
    if (!parseCidr(cidr)) continue
    if (ifaces.some((iface) => cidrCoveredByIface(cidr, iface))) continue
    for (const iface of ifaces) {
      const name = iface.name.trim()
      if (!name) continue
      const key = routeKey({ iface: name, cidr })
      if (seen.has(key)) continue
      seen.add(key)
      routes.push({ iface: name, cidr })
    }
  }
  return routes
}

export function netshRouteArgs(action: 'add' | 'delete', iface: string, cidr: string): string[] {
  const args = ['interface', 'ipv4', action, 'route', `prefix=${cidr}`, `interface=${iface}`, 'store=active']
  if (action === 'add') args.push(`metric=${ONLINK_ROUTE_METRIC}`)
  return args
}

function routeKey(route: ExtraOnlinkRoute): string {
  return `${route.iface}\0${route.cidr}`
}

async function runNetsh(args: string[]): Promise<void> {
  await execFileAsync('netsh', args, { timeout: 8000, windowsHide: true })
}

export function createExtraRouteSession(run: (args: string[]) => Promise<void>) {
  const installed = new Map<string, ExtraOnlinkRoute>()
  const warned = new Set<string>()
  let generation = 0
  let queue: Promise<void> = Promise.resolve()

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const runJob = queue.then(job, job)
    queue = runJob.then(
      () => undefined,
      () => undefined
    )
    return runJob
  }

  const warnOnce = (key: string, error: unknown): void => {
    if (warned.has(key)) return
    warned.add(key)
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`discovery on-link route ${key.replace('\0', ' on ')} failed: ${message}`)
  }

  return {
    has(): boolean {
      return installed.size > 0
    },
    sync(ifaces: OnlinkIface[]): Promise<void> {
      const token = ++generation
      return enqueue(async () => {
        if (token !== generation) return
        const wanted = extraRoutesToInstall(ifaces)
        const wantedKeys = new Set(wanted.map(routeKey))
        for (const [key, route] of [...installed]) {
          if (token !== generation) return
          if (wantedKeys.has(key)) continue
          try {
            await run(netshRouteArgs('delete', route.iface, route.cidr))
          } catch (error) {
            warnOnce(`delete ${key}`, error)
          }
          installed.delete(key)
        }
        for (const route of wanted) {
          if (token !== generation) return
          const key = routeKey(route)
          if (installed.has(key)) continue
          try {
            await run(netshRouteArgs('add', route.iface, route.cidr))
          } catch (error) {
            warnOnce(`add ${key}`, error)
            continue
          }
          if (token !== generation) {
            await run(netshRouteArgs('delete', route.iface, route.cidr)).catch((error) => {
              warnOnce(`delete ${key}`, error)
            })
            return
          }
          installed.set(key, route)
        }
      })
    },
    clear(): Promise<void> {
      const token = ++generation
      return enqueue(async () => {
        if (token !== generation) return
        const pending = [...installed.values()]
        installed.clear()
        for (const route of pending) {
          try {
            await run(netshRouteArgs('delete', route.iface, route.cidr))
          } catch (error) {
            warnOnce(`delete ${routeKey(route)}`, error)
          }
        }
      })
    }
  }
}

const session = createExtraRouteSession(runNetsh)
let quitCleanup: Promise<void> | null = null

export function hasExtraOnlinkRoutes(): boolean {
  return session.has()
}

export async function syncExtraOnlinkRoutes(ifaces: OnlinkIface[]): Promise<void> {
  if (process.platform !== 'win32') return
  await session.sync(ifaces)
}

export function clearExtraOnlinkRoutes(): Promise<void> {
  return session.clear()
}

export function clearExtraOnlinkRoutesOnQuit(quit: () => void, prevent: () => void): void {
  if (!session.has()) return
  prevent()
  if (quitCleanup) return
  quitCleanup = session.clear().finally(() => {
    quitCleanup = null
    quit()
  })
}
