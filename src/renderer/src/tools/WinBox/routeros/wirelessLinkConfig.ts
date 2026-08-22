import type {
  GrooveaRole,
  GrooveaWirelessBand,
  GrooveaWirelessProtocol,
  WirelessStack,
} from '../winboxConfigTypes'
import { buildPassThroughCommand, escapeRouterOsString } from './routerOsShared'

export const GROOVEA_ROLES: readonly GrooveaRole[] = ['ap', 'station1', 'station2']
export const WIFI_LINK_ROLES: readonly GrooveaRole[] = ['ap', 'station1']

export const GROOVEA_ROLE_LABELS: Record<GrooveaRole, string> = {
  ap: 'AP',
  station1: 'Station 1',
  station2: 'Station 2',
}

export const WIFI_LINK_ROLE_LABELS: Partial<Record<GrooveaRole, string>> = {
  ap: 'AP',
  station1: 'Station',
}

export const GROOVEA_ROLE_INDEX: Record<GrooveaRole, number> = { ap: 0, station1: 1, station2: 2 }
export const GROOVEA_DEFAULT_PASSWORD = 'TaburetkaOgurec'
export const GROOVEA_HOST_SUFFIXES = [210, 211, 212] as const
export const GROOVEA_HOST_LABELS = ['AP', 'Station 1', 'Station 2'] as const
export const WIFI_LINK_HOST_SUFFIXES = [210, 211] as const
export const WIFI_LINK_HOST_LABELS = ['AP', 'Station'] as const

/**
 * Fixed W60G channel for nRAY (EU region).
 * 58320 (ch1 / 58.32 GHz) — certified for nRAY, away from O₂ absorption peak (~60 GHz).
 * Locking frequency (vs auto) avoids mid-link channel hops; station scan-list matches AP.
 */
export const NRAY_W60G_FREQUENCY = 58320

export function isPairLinkStack(wirelessStack: WirelessStack): boolean {
  return wirelessStack === 'wifi' || wirelessStack === 'w60g'
}

export function getLinkRoles(wirelessStack: WirelessStack): readonly GrooveaRole[] {
  return isPairLinkStack(wirelessStack) ? WIFI_LINK_ROLES : GROOVEA_ROLES
}

export function getLinkRoleLabels(
  wirelessStack: WirelessStack,
): Partial<Record<GrooveaRole, string>> {
  return isPairLinkStack(wirelessStack) ? WIFI_LINK_ROLE_LABELS : GROOVEA_ROLE_LABELS
}

export function buildGrooveaDeviceName(
  owlDigits: string,
  role: GrooveaRole,
  nameSlug: string,
  wirelessStack: WirelessStack = 'legacy',
): string {
  if (role === 'ap') return `OWL${owlDigits}-${nameSlug}-ap`
  if (isPairLinkStack(wirelessStack) || role === 'station1') {
    return isPairLinkStack(wirelessStack)
      ? `OWL${owlDigits}-${nameSlug}-station`
      : `OWL${owlDigits}-${nameSlug}-station1`
  }
  return `OWL${owlDigits}-${nameSlug}-station2`
}

export function buildGrooveaSsid(owlDigits: string, nameSlug: string): string {
  return `owl${owlDigits}-${nameSlug}`
}

export function getLinkHostSuffixes(wirelessStack: WirelessStack): readonly number[] {
  return isPairLinkStack(wirelessStack) ? WIFI_LINK_HOST_SUFFIXES : GROOVEA_HOST_SUFFIXES
}

export function getLinkHostLabels(wirelessStack: WirelessStack): readonly string[] {
  return isPairLinkStack(wirelessStack) ? WIFI_LINK_HOST_LABELS : GROOVEA_HOST_LABELS
}

export function owlDigitsToGrooveaPrefix(digits: string): [string, string, string] | null {
  if (!/^\d{4}$/.test(digits)) return null
  return ['10', digits.slice(0, 2), digits.slice(2, 4)]
}

export function grooveaPrefixToAddresses(
  prefix: [string, string, string],
  hostSuffixes: readonly (string | number)[],
): {
  ip: string
  net: string
  hosts: string[]
} | null {
  if (prefix.some((o) => o.trim() === '')) return null
  if (hostSuffixes.some((o) => String(o).trim() === '')) return null
  const nums = prefix.map((o) => parseInt(o, 10))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  const suffixes = hostSuffixes.map((o) => parseInt(String(o), 10))
  if (suffixes.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  const base = nums.join('.')
  return {
    ip: `${base}.${suffixes[0]}`,
    net: `${base}.0`,
    hosts: suffixes.map((suffix) => `${base}.${suffix}`),
  }
}

export function defaultLinkHostSuffixStrings(wirelessStack: WirelessStack): string[] {
  return getLinkHostSuffixes(wirelessStack).map(String)
}

export function grooveaBandToRouterOs(band: GrooveaWirelessBand): string {
  return band === '2.4 ГГц' ? '2ghz-b/g/n' : '5ghz-a/n/ac'
}

/** Fixed channel: outdoor-safe for Russia antennas, no DFS CAC wait. */
export function linkChannelSettings(band: GrooveaWirelessBand): {
  frequency: number
  legacyBand: string
  wifiBand: string
} {
  if (band === '2.4 ГГц') {
    return {
      frequency: 2412,
      legacyBand: '2ghz-b/g/n',
      wifiBand: '2ghz-ax',
    }
  }
  // 5765 (ch 153) — в outdoor-диапазоне russia (5755–5815), без DFS
  return {
    frequency: 5765,
    legacyBand: '5ghz-a/n/ac',
    wifiBand: '5ghz-ax',
  }
}

function formatLinkChannelLabel(frequency: number): string {
  const ghz = frequency / 1000
  const ghzLabel = ghz >= 10 ? ghz.toFixed(2) : ghz.toFixed(3)
  return `канал ${frequency} (${ghzLabel}\u00a0ГГц)`
}

/** Short radio note under antenna settings — same style as the nRAY W60G line. */
export function buildWirelessLinkNote(
  wirelessStack: WirelessStack,
  protocol: GrooveaWirelessProtocol,
  band: GrooveaWirelessBand,
): string {
  if (wirelessStack === 'w60g') {
    return `PtP-линк 60\u00a0ГГц (W60G): ${formatLinkChannelLabel(NRAY_W60G_FREQUENCY)}, регион EU.`
  }

  const { frequency } = linkChannelSettings(band)
  const channel = formatLinkChannelLabel(frequency)
  if (wirelessStack === 'wifi') {
    return `PtP-линк ${band} (Wi-Fi 6): ${channel}, ширина 20 МГц, страна Russia.`
  }

  return `PtP-линк ${band} (${protocol}): ${channel}, outdoor, страна russia.`
}

export function buildCredentialsSummary(owlDigits: string, adminPassword: string): string {
  return [
    `OWLGUARD ID: ${owlDigits}`,
    `Логин: admin`,
    `Пароль: ${adminPassword}`,
  ].join('\n')
}

export function buildGrooveaConfigHeader(
  owlDigits: string,
  hosts: string[],
  mikrotikPassword: string,
  wirelessProtocol: GrooveaWirelessProtocol,
  wirelessBand: GrooveaWirelessBand | undefined,
  linkKey: string,
  wirelessStack: WirelessStack = 'legacy',
): string {
  const roleLabels = getLinkRoleLabels(wirelessStack)
  const roles = getLinkRoles(wirelessStack)
  const lines = [
    `OWLGUARD ID: ${owlDigits}`,
    ...roles.map((role, index) => `${roleLabels[role] ?? role}: ${hosts[index]}/24`),
  ]
  if (wirelessStack === 'w60g') {
    lines.push(`Канал: ${NRAY_W60G_FREQUENCY} (58.32 ГГц)`)
  } else if (wirelessStack === 'wifi') {
    if (wirelessBand) lines.push(`Диапазон: ${wirelessBand}`)
  } else {
    lines.push(`Протокол: ${wirelessProtocol}`)
    if (wirelessProtocol === '802.11' && wirelessBand) {
      lines.push(`Диапазон: ${wirelessBand}`)
    }
  }
  lines.push(`Пароль: ${linkKey}`, `Логин: admin`, `Пароль администратора: ${mikrotikPassword}`)
  return lines.join('\n')
}

function buildMantboxAxLanBlock(options: {
  role: GrooveaRole
  hosts: string[]
  net: string
  band: GrooveaWirelessBand
  ssid: string
  linkKey: string
}): string[] {
  const { role, hosts, net, band, ssid, linkKey } = options
  const roleIndex = GROOVEA_ROLE_INDEX[role]
  const ipAddr = hosts[roleIndex]
  const is5g = band === '5 ГГц'
  // mANTBox ax 15s factory defconf: wifi1 = 2.4 GHz, wifi2 = 5 GHz
  const wifiIface = is5g ? 'wifi2' : 'wifi1'
  const unusedIface = is5g ? 'wifi1' : 'wifi2'
  const antennaGain = is5g ? 15 : 12
  const { frequency, wifiBand } = linkChannelSettings(band)
  const mode = role === 'ap' ? 'ap' : 'station-bridge'
  const escapedSsid = escapeRouterOsString(ssid)
  const escapedKey = escapeRouterOsString(linkKey)

  return [
    `/interface bridge add name=bridge-lan`,
    `/interface bridge port add bridge=bridge-lan interface=ether1`,
    `/interface bridge port add bridge=bridge-lan interface=${wifiIface}`,
    `/interface wifi set [find default-name=${wifiIface}] disabled=no configuration.mode=${mode} configuration.ssid="${escapedSsid}" configuration.country=Russia configuration.antenna-gain=${antennaGain} security.authentication-types=wpa2-psk security.passphrase="${escapedKey}" channel.band=${wifiBand} channel.frequency=${frequency} channel.width=20mhz channel.skip-dfs-channels=all`,
    `/interface wifi set [find default-name=${unusedIface}] disabled=yes`,
    `/ip address add address=${ipAddr}/24 network=${net} interface=bridge-lan`,
  ]
}

/** Wireless Wire nRAY (W60G PtP): bridge + station-bridge per MikroTik PtP CLI example. */
function buildNrayLanBlock(options: {
  role: GrooveaRole
  hosts: string[]
  net: string
  ssid: string
  linkKey: string
}): string[] {
  const { role, hosts, net, ssid, linkKey } = options
  const roleIndex = GROOVEA_ROLE_INDEX[role]
  const ipAddr = hosts[roleIndex]
  const escapedSsid = escapeRouterOsString(ssid)
  const escapedKey = escapeRouterOsString(linkKey)
  const frequency = NRAY_W60G_FREQUENCY

  const lines: string[] = [
    `/interface bridge add name=bridge-lan`,
    `/interface bridge port add bridge=bridge-lan interface=ether1`,
    `/interface bridge port add bridge=bridge-lan interface=wlan60-1`,
  ]

  if (role === 'ap') {
    lines.push(
      `/interface w60g set wlan60-1 disabled=no mode=bridge frequency=${frequency} region=eu ssid="${escapedSsid}" password="${escapedKey}" put-stations-in-bridge=bridge-lan isolate-stations=yes`,
    )
  } else {
    lines.push(
      `/interface w60g set wlan60-1 disabled=no mode=station-bridge frequency=auto scan-list=${frequency} region=eu ssid="${escapedSsid}" password="${escapedKey}"`,
    )
  }

  lines.push(`/ip address add address=${ipAddr}/24 network=${net} interface=bridge-lan`)
  return lines
}

export function buildGrooveaLanBlock(options: {
  role: GrooveaRole
  hosts: string[]
  net: string
  protocol: GrooveaWirelessProtocol
  band: GrooveaWirelessBand
  ssid: string
  linkKey: string
  wirelessStack?: WirelessStack
}): string[] {
  const { role, hosts, net, protocol, band, ssid, linkKey, wirelessStack = 'legacy' } = options
  if (wirelessStack === 'wifi') {
    return buildMantboxAxLanBlock({ role, hosts, net, band, ssid, linkKey })
  }
  if (wirelessStack === 'w60g') {
    return buildNrayLanBlock({ role, hosts, net, ssid, linkKey })
  }

  const roleIndex = GROOVEA_ROLE_INDEX[role]
  const ipAddr = hosts[roleIndex]
  const escapedSsid = escapeRouterOsString(ssid)
  const escapedKey = escapeRouterOsString(linkKey)
  const { frequency, legacyBand } = linkChannelSettings(band)
  const bandName = protocol === 'nv2' ? legacyBand : grooveaBandToRouterOs(band)
  // GrooveA 52 ac / Metal 52 ac stock omni: 6 dBi @ 2.4 GHz, 8 dBi @ 5 GHz
  const antennaGain = band === '2.4 ГГц' ? 6 : 8
  const wirelessCommon =
    `band=${bandName} frequency=${frequency} channel-width=20mhz skip-dfs-channels=all installation=outdoor antenna-gain=${antennaGain} country=russia`

  const lines: string[] = [
    `/interface bridge add name=bridge-lan`,
    `/interface bridge port add bridge=bridge-lan interface=ether1`,
    `/interface bridge port add bridge=bridge-lan interface=wlan1`,
  ]

  if (protocol === 'nv2') {
    if (role === 'ap') {
      lines.push(
        `/interface wireless set [find default-name=wlan1] disabled=no mode=ap-bridge ${wirelessCommon} wireless-protocol=nv2 ssid="${escapedSsid}" nv2-security=enabled nv2-preshared-key="${escapedKey}"`,
      )
    } else {
      lines.push(
        `/interface wireless set [find default-name=wlan1] disabled=no mode=station ${wirelessCommon} scan-list=${frequency} wireless-protocol=nv2 ssid="${escapedSsid}" nv2-security=enabled nv2-preshared-key="${escapedKey}"`,
      )
    }
  } else if (role === 'ap') {
    lines.push(
      `/interface wireless security-profiles add name=groovea-link mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key="${escapedKey}"`,
      `/interface wireless set [find default-name=wlan1] disabled=no mode=ap-bridge ${wirelessCommon} wireless-protocol=802.11 ssid="${escapedSsid}" security-profile=groovea-link`,
    )
  } else {
    lines.push(
      `/interface wireless security-profiles add name=groovea-link mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key="${escapedKey}"`,
      `/interface wireless set [find default-name=wlan1] disabled=no mode=station ${wirelessCommon} scan-list=${frequency} wireless-protocol=802.11 ssid="${escapedSsid}" security-profile=groovea-link`,
    )
  }

  lines.push(`/ip address add address=${ipAddr}/24 network=${net} interface=bridge-lan`)
  return lines
}

export function buildGrooveaDeviceConfig(options: {
  role: GrooveaRole
  owlDigits: string
  nameSlug: string
  ssid: string
  hosts: string[]
  net: string
  newPassword: string
  protocol: GrooveaWirelessProtocol
  band: GrooveaWirelessBand
  linkKey: string
  wirelessStack?: WirelessStack
}): string {
  const {
    role,
    owlDigits,
    nameSlug,
    ssid,
    hosts,
    net,
    newPassword,
    protocol,
    band,
    linkKey,
    wirelessStack = 'legacy',
  } = options
  const deviceName = buildGrooveaDeviceName(owlDigits, role, nameSlug, wirelessStack)

  const sections = [
    buildGrooveaLanBlock({
      role,
      hosts,
      net,
      protocol,
      band,
      ssid,
      linkKey,
      wirelessStack,
    }).join('\n'),
    [
      `/tool romon set enabled=yes`,
      deviceName.trim() ? `/system identity set name="${deviceName.trim()}"` : '',
      newPassword ? `/user set admin password=${newPassword}` : '',
      newPassword ? buildPassThroughCommand() : '',
    ]
      .filter(Boolean)
      .join('\n'),
  ]

  return sections.filter(Boolean).join('\n\n')
}

export function buildGrooveaAllConfigs(options: {
  owlDigits: string
  nameSlug: string
  ssid: string
  hosts: string[]
  net: string
  newPassword: string
  protocol: GrooveaWirelessProtocol
  band: GrooveaWirelessBand
  linkKey: string
  wirelessStack?: WirelessStack
}): Partial<Record<GrooveaRole, string>> {
  const wirelessStack = options.wirelessStack ?? 'legacy'
  const roles = getLinkRoles(wirelessStack)
  return Object.fromEntries(
    roles.map((role) => [role, buildGrooveaDeviceConfig({ role, ...options, wirelessStack })]),
  )
}

export function buildGrooveaSaveTxt(
  header: string,
  configs: Partial<Record<GrooveaRole, string>>,
  deviceNames: Partial<Record<GrooveaRole, string>>,
  wirelessStack: WirelessStack = 'legacy',
): string {
  const sep = '='.repeat(48)
  const roles = getLinkRoles(wirelessStack)
  const labels = getLinkRoleLabels(wirelessStack)
  const blocks = roles
    .filter((role) => configs[role])
    .map(
      (role) =>
        `=== ${labels[role] ?? role}: ${deviceNames[role] ?? role} ===\n\n${configs[role]}`,
    )
  return [header, sep, ...blocks].join('\n\n')
}
