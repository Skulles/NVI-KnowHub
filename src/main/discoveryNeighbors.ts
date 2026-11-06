/**
 * Fill missing MACs from the OS neighbor table after L2 discovery.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DiscoveryDevice } from '../shared/api'
import { isIPv4, mergeDiscoveryDevice } from './discoveryMndp'
import { normalizeMacString } from './discoveryWs'

const execFileAsync = promisify(execFile)

export function parseNeighborTable(text: string): Map<string, string> {
  const found = new Map<string, string>()
  const pattern =
    /(?:^|\(|\s)(\d{1,3}(?:\.\d{1,3}){3})(?:\))?(?:.*?lladdr|\s+at)\s+([0-9a-f:.-]{11,17})/gi
  for (const match of text.matchAll(pattern)) {
    const ip = match[1]
    const mac = normalizeMacString(match[2])
    if (!isIPv4(ip) || !mac || mac === 'FF:FF:FF:FF:FF:FF') continue
    found.set(ip, mac)
  }
  return found
}

export function applyNeighborMacs(
  devices: DiscoveryDevice[],
  neighbors: Map<string, string>,
  replySourceByIp: Map<string, string> = new Map()
): DiscoveryDevice[] {
  return devices.map((device) => {
    if (device.mac) return device
    const sourceIp = replySourceByIp.get(device.ip)
    const mac = neighbors.get(device.ip) || (sourceIp ? neighbors.get(sourceIp) : undefined)
    return mac ? mergeDiscoveryDevice(device, { ...device, mac }) : device
  })
}

function pingArgs(ip: string): string[] {
  if (process.platform === 'win32') return ['-n', '1', '-w', '800', ip]
  if (process.platform === 'darwin') return ['-c', '1', '-W', '800', ip]
  return ['-c', '1', '-W', '1', ip]
}

/** Ping a few discovered hosts so their ARP entries are fresh, then read those rows. */
export async function refreshNeighborMacs(ips: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ips.filter((ip) => isIPv4(ip)))]
  const found = new Map<string, string>()
  await Promise.all(
    unique.map(async (ip) => {
      await execFileAsync(process.platform === 'win32' ? 'ping.exe' : 'ping', pingArgs(ip), {
        timeout: 2000
      }).catch(() => undefined)
      try {
        const { stdout } = await execFileAsync('arp', process.platform === 'win32' ? ['-a', ip] : ['-n', ip], {
          timeout: 1500
        })
        const mac = parseNeighborTable(stdout).get(ip)
        if (mac) found.set(ip, mac)
      } catch {
        // host did not answer ARP
      }
    })
  )
  return found
}

export async function readNeighborMacs(): Promise<Map<string, string>> {
  const commands: Array<[string, string[]]> =
    process.platform === 'linux'
      ? [
          ['ip', ['neigh']],
          ['arp', ['-an']]
        ]
      : [['arp', ['-an']]]

  for (const [bin, args] of commands) {
    try {
      const { stdout } = await execFileAsync(bin, args, { timeout: 2000 })
      const parsed = parseNeighborTable(stdout)
      if (parsed.size) return parsed
    } catch {
      // try the next table command
    }
  }
  return new Map()
}
