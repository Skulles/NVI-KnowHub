/**
 * Collect local IPv4 addresses and gateways for Monitoring LAN detection.
 */
import { execFile } from 'child_process'
import os from 'os'
import { promisify } from 'util'
import type { MonitoringLanHints } from '../shared/api'

const execFileAsync = promisify(execFile)

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/

function isIPv4(value: string): boolean {
  if (!IPV4_RE.test(value)) return false
  return value.split('.').every((part) => {
    const n = Number(part)
    return Number.isInteger(n) && n >= 0 && n <= 255
  })
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function listLocalIPv4Addresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const familyValue = entry.family as string | number
      const family = familyValue === 'IPv4' || familyValue === 4 ? 'IPv4' : 'IPv6'
      if (family !== 'IPv4' || entry.internal) continue
      if (isIPv4(entry.address)) addresses.push(entry.address)
    }
  }
  return uniqueStrings(addresses)
}

/** Exported for unit tests. */
export function parseGatewaysFromNetstat(stdout: string): string[] {
  const gateways: string[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || /^(Routing tables|Internet|Destination|Kernel)/i.test(line)) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const gateway = parts[1]
    if (gateway.toLowerCase().startsWith('link#')) continue
    if (gateway === '*' || gateway.toLowerCase() === '0.0.0.0') continue
    if (isIPv4(gateway)) gateways.push(gateway)
  }
  return uniqueStrings(gateways)
}

/** Exported for unit tests. */
export function parseGatewaysFromWindowsRoute(stdout: string): string[] {
  const gateways: string[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(/\s+/).filter(Boolean)
    // Network Destination / Netmask / Gateway / Interface / Metric
    if (parts.length < 3) continue
    const gateway = parts[2]
    if (!isIPv4(gateway)) continue
    if (gateway === '0.0.0.0' || gateway === '127.0.0.1') continue
    // On-link rows sometimes repeat interface IP as gateway — still useful for subnet match.
    gateways.push(gateway)
  }
  return uniqueStrings(gateways)
}

/** Exported for unit tests. */
export function parseGatewaysFromIpRoute(stdout: string): string[] {
  const gateways: string[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = rawLine.match(/\bvia\s+(\d{1,3}(?:\.\d{1,3}){3})\b/i)
    if (match && isIPv4(match[1])) gateways.push(match[1])
  }
  return uniqueStrings(gateways)
}

async function collectGatewaysUnix(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('netstat', ['-rn', '-f', 'inet'], {
      timeout: 5000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    })
    const fromNetstat = parseGatewaysFromNetstat(stdout)
    if (fromNetstat.length) return fromNetstat
  } catch {
    // fall through
  }

  if (process.platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('ip', ['-4', 'route'], {
        timeout: 5000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      })
      return parseGatewaysFromIpRoute(stdout)
    } catch {
      return []
    }
  }

  return []
}

async function collectGatewaysWindows(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('route', ['print', '-4'], {
      timeout: 8000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true
    })
    return parseGatewaysFromWindowsRoute(stdout)
  } catch {
    return []
  }
}

export async function collectLanHints(): Promise<MonitoringLanHints> {
  const localAddresses = listLocalIPv4Addresses()
  const gateways =
    process.platform === 'win32' ? await collectGatewaysWindows() : await collectGatewaysUnix()

  return {
    localAddresses,
    gateways
  }
}
