/**
 * ICMP sweep of on-link prefixes plus 192.168.0.0/24, 192.168.1.0/24, and 192.168.3.152 when off-link.
 */
import { execFile } from 'child_process'
import { collectExtraCidrTargets, collectOnlinkPingTargets, type OnlinkIface } from './discoveryOnlink'
import { isIPv4 } from './discoveryMndp'

const PING_CONCURRENCY = 32
const PING_TIMEOUT_MS = 500

function pingArgs(host: string): string[] {
  if (process.platform === 'win32') return ['-n', '1', '-w', String(PING_TIMEOUT_MS), host]
  if (process.platform === 'darwin') return ['-c', '1', '-W', String(PING_TIMEOUT_MS), host]
  return ['-c', '1', '-W', String(Math.max(1, Math.ceil(PING_TIMEOUT_MS / 1000))), host]
}

export function pingLooksAlive(output: string): boolean {
  return /\bTTL=/i.test(output) || /bytes from/i.test(output) || /байт от/i.test(output)
}

function pingHost(host: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const child = execFile(
      'ping',
      pingArgs(host),
      { timeout: PING_TIMEOUT_MS + 1500, windowsHide: true },
      (_error, stdout, stderr) => {
        const output = `${stdout ?? ''}\n${stderr ?? ''}`
        if (pingLooksAlive(output)) {
          resolve(true)
          return
        }
        resolve(false)
      }
    )
    const onAbort = (): void => {
      child.kill()
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.once('close', () => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

async function mapPool(hosts: string[], signal: AbortSignal, onAlive?: (ip: string) => void): Promise<string[]> {
  const alive: string[] = []
  let next = 0

  async function worker(): Promise<void> {
    while (next < hosts.length && !signal.aborted) {
      const index = next
      next += 1
      const host = hosts[index]
      if (!host || !isIPv4(host)) continue
      if (await pingHost(host, signal)) {
        alive.push(host)
        onAlive?.(host)
      }
    }
  }

  const workers = Array.from({ length: Math.min(PING_CONCURRENCY, hosts.length) }, () => worker())
  await Promise.all(workers)
  return alive
}

export function pingLiveHosts(
  ifaces: OnlinkIface[],
  knownIps: Set<string>,
  signal: AbortSignal,
  options: { includeExtras?: boolean; onAlive?: (ip: string) => void } = {}
): Promise<string[]> {
  const extras = options.includeExtras === false ? [] : collectExtraCidrTargets(ifaces)
  const targets = [...new Set([...collectOnlinkPingTargets(ifaces), ...extras])].filter((ip) => !knownIps.has(ip))
  if (!targets.length || signal.aborted) return Promise.resolve([])
  return mapPool(targets, signal, options.onAlive)
}
