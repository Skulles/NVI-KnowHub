import type { LanAddress } from '../winboxConfigTypes'

export function escapeRouterOsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function owlDigitsToLanAddress(digits: string): LanAddress | null {
  if (!/^\d{4}$/.test(digits)) return null
  const secondOctet = digits.slice(0, 2)
  const thirdOctet = digits.slice(2, 4)
  return {
    ip: `10.${secondOctet}.${thirdOctet}.1`,
    net: `10.${secondOctet}.${thirdOctet}.0`,
  }
}

export function ipToOctets(ip: string): [string, string, string, string] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  return parts as [string, string, string, string]
}

export function octetsToLanAddress(octets: [string, string, string, string]): LanAddress | null {
  if (octets.some((o) => o.trim() === '')) return null
  const nums = octets.map((o) => parseInt(o, 10))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return { ip: nums.join('.'), net: `${nums[0]}.${nums[1]}.${nums[2]}.0` }
}

export function buildConfigDownloadContent(header: string, commands: string, footer?: string): string {
  const body = `${header}\n\n${'='.repeat(40)}\n\n${commands}\n\n${'='.repeat(40)}`
  if (!footer) return body
  return `${body}\n\n${footer}`
}

export function buildPassThroughCommand(): string {
  return `/log info message="done"`
}
