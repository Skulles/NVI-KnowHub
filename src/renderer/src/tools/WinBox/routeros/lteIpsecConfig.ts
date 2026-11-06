import type { LanAddress } from '../winboxConfigTypes'
import {
  buildPassThroughCommand,
  escapeRouterOsString,
  owlDigitsToLanAddress,
} from './routerOsShared'

export const CONFIG_FOOTER_NOTE = 'DHCP отключён. Маску и шлюз на клиентах укажите вручную.'
export const CONFIG_REBOOT_NOTE =
  'После применения конфигурации необходимо перезагрузить роутер'
export const WIFI_SSID_MAX_BYTES = 32

const MANAGEMENT_NETWORKS = ['10.33.12.0/24'] as const

export function buildOwlDeviceName(owlDigits: string): string {
  return `OWL${owlDigits}-LTE`
}

export function wifiSsidByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function sanitizeWifiSsidInput(value: string): string {
  let cleaned = [...value]
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 0x20 && code <= 0x7e
    })
    .join('')
    .replace(/^\s+/, '')

  while (cleaned.length > 0 && wifiSsidByteLength(cleaned) > WIFI_SSID_MAX_BYTES) {
    cleaned = cleaned.slice(0, -1)
  }
  return cleaned
}

export function isValidWifiSsid(ssid: string): boolean {
  const normalized = ssid.trim()
  if (normalized.length === 0) return false
  if (wifiSsidByteLength(normalized) > WIFI_SSID_MAX_BYTES) return false
  if (ssid !== normalized) return false
  return /^[\x20-\x7E]+$/.test(normalized)
}

export function parseOwlKeyFromScript(script: string): {
  owlDigits: string
  ip: string
  net: string
} | null {
  const m = script.match(/my-id=key-id:(owl\d+)/i)
  if (!m) return null
  const owlDigits = m[1].replace(/^owl/i, '')
  const lanAddress = owlDigitsToLanAddress(owlDigits)
  if (!lanAddress) return null
  return { owlDigits, ...lanAddress }
}

export function buildLanPrefix(
  lanAddress: LanAddress,
  wifiEnabled: boolean,
  wifiSsid: string,
  wifiPassword: string,
  wifiHidden: boolean,
): string[] {
  if (!wifiEnabled) {
    return [
      `/ip address add address=${lanAddress.ip}/24 network=${lanAddress.net} interface=ether1`,
    ]
  }

  const ssid = escapeRouterOsString(wifiSsid.trim())
  const psk = escapeRouterOsString(wifiPassword.trim())
  const hidden = wifiHidden ? ' hide-ssid=yes' : ''

  return [
    `/interface bridge add name=bridge-lan`,
    `/interface bridge port add bridge=bridge-lan interface=ether1`,
    `/interface bridge port add bridge=bridge-lan interface=wlan1`,
    `/interface wireless security-profiles add name=ltap-wifi mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key="${psk}"`,
    `/interface wireless set [find default-name=wlan1] disabled=no mode=ap-bridge band=2ghz-b/g/n ssid="${ssid}" security-profile=ltap-wifi${hidden}`,
    `/ip address add address=${lanAddress.ip}/24 network=${lanAddress.net} interface=bridge-lan`,
  ]
}

export function buildConfigHeader(
  owlDigits: string,
  lanAddress: LanAddress,
  mikrotikPassword: string,
  wifi?: { ssid: string; password: string },
): string {
  const lines = [
    `OWLGUARD ID: ${owlDigits}`,
    `IP адрес Mikrotik роутера: ${lanAddress.ip}/24`,
    `Логин: admin`,
    `Пароль: ${mikrotikPassword}`,
  ]
  if (wifi) {
    lines.push(`WiFi SSID: ${wifi.ssid}`, `WiFi пароль: ${wifi.password}`)
  }
  return lines.join('\n')
}

function managementAddresses(lanNet: string): string {
  return `${lanNet}/24,${MANAGEMENT_NETWORKS.join(',')}`
}

function stripRouterOsComment(command: string): string {
  return command.replace(/\s+comment="[^"]*"/gi, '').trim()
}

function sanitizeRouterOsCommand(command: string): string {
  return stripRouterOsComment(command.replace(/\s+place-before=\d+/gi, ''))
}

function splitScriptToCommands(script: string): string[] {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(sanitizeRouterOsCommand)
}

function isInputFirewallFilterCommand(command: string): boolean {
  return /^\/ip\s+firewall\s+filter\s+add\b/i.test(command) && /\bchain=input\b/i.test(command)
}

function isForwardFirewallFilterCommand(command: string): boolean {
  return /^\/ip\s+firewall\s+filter\s+add\b/i.test(command) && /\bchain=forward\b/i.test(command)
}

function partitionVpnScript(commands: string[]): {
  vpnCommands: string[]
  inputFirewallRules: string[]
} {
  const vpnCommands: string[] = []
  const inputFirewallRules: string[] = []
  for (const command of commands) {
    if (isInputFirewallFilterCommand(command)) {
      inputFirewallRules.push(command)
    } else if (!isForwardFirewallFilterCommand(command)) {
      vpnCommands.push(command)
    }
  }
  return { vpnCommands, inputFirewallRules }
}

function findFirewallRule(rules: string[], pattern: RegExp): string | undefined {
  return rules.find((rule) => pattern.test(rule))
}

function extractRouterOsParam(command: string, param: string): string | undefined {
  const quoted = command.match(new RegExp(`\\b${param}="([^"]+)"`, 'i'))
  if (quoted) return quoted[1]
  const bare = command.match(new RegExp(`\\b${param}=([^\\s"]+)`, 'i'))
  return bare?.[1]
}

function extractIpsecNamesFromScript(scriptCommands: string[]): {
  profileNames: string[]
  proposalNames: string[]
  peerNames: string[]
} {
  const profileNames = new Set<string>()
  const proposalNames = new Set<string>()
  const peerNames = new Set<string>()

  for (const command of scriptCommands) {
    if (/\/ip\s+ipsec\s+profile\s+add\b/i.test(command)) {
      const name = extractRouterOsParam(command, 'name')
      if (name) profileNames.add(name)
    }
    if (/\/ip\s+ipsec\s+proposal\s+add\b/i.test(command)) {
      const name = extractRouterOsParam(command, 'name')
      if (name) proposalNames.add(name)
    }
    if (/\/ip\s+ipsec\s+peer\s+add\b/i.test(command)) {
      const name = extractRouterOsParam(command, 'name')
      if (name) peerNames.add(name)
    }
    if (
      /\/ip\s+ipsec\s+(?:policy|identity)\s+add\b/i.test(command) ||
      /\/ip\s+ipsec\s+peer\s+add\b/i.test(command)
    ) {
      const peer = extractRouterOsParam(command, 'peer')
      if (peer && !peer.startsWith('*')) peerNames.add(peer)
    }
    if (/\/ip\s+ipsec\s+policy\s+add\b/i.test(command)) {
      const proposal = extractRouterOsParam(command, 'proposal')
      if (proposal) proposalNames.add(proposal)
    }
  }

  return {
    profileNames: [...profileNames],
    proposalNames: [...proposalNames],
    peerNames: [...peerNames],
  }
}

function buildIpsecCleanupBlock(scriptCommands: string[]): string[] {
  const { profileNames, proposalNames, peerNames } = extractIpsecNamesFromScript(scriptCommands)
  const commands = [
    `/ip ipsec active-peers remove [find]`,
    `/ip ipsec installed-sa remove [find]`,
  ]

  for (const name of proposalNames) {
    commands.push(`/ip ipsec policy remove [find where proposal=${name}]`)
  }
  commands.push(`/ip ipsec policy remove [find where !default]`)
  commands.push(`/ip ipsec identity remove [find]`)

  for (const name of peerNames) {
    commands.push(`/ip ipsec peer remove [find where name=${name}]`)
  }
  commands.push(`/ip ipsec peer remove [find]`)

  for (const name of proposalNames) {
    commands.push(`/ip ipsec proposal remove [find where name=${name}]`)
  }
  commands.push(`/ip ipsec proposal remove [find where name!=default]`)

  for (const name of profileNames) {
    commands.push(`/ip ipsec profile remove [find where name=${name}]`)
  }
  commands.push(`/ip ipsec profile remove [find where name!=default]`)
  commands.push(`/ip ipsec mode-config remove [find where name!=default]`)

  return commands
}

function buildCleanupBlock(scriptCommands: string[] = []): string[] {
  return [
    `/ip firewall filter remove [find]`,
    `/ip firewall nat remove [find]`,
    `/ip firewall mangle remove [find]`,
    `/ip firewall raw remove [find]`,
    `/ip firewall address-list remove [find]`,
    ...buildIpsecCleanupBlock(scriptCommands),
    `/ip dhcp-server remove [find]`,
    `/ip dhcp-server network remove [find]`,
    `/ip dhcp-client remove [find interface!=lte1]`,
    `/ip address remove [find]`,
    `/ip route remove [find where !dynamic]`,
    `/ip dns static remove [find]`,
    `/ip pool remove [find]`,
    `/interface list member remove [find]`,
    `/interface list remove [find]`,
    `/tool mac-server set allowed-interface-list=all`,
    `/tool mac-server mac-winbox set allowed-interface-list=all`,
    `/ip neighbor discovery-settings set discover-interface-list=all`,
    `/ip service set winbox address=""`,
    `/ip service set ssh address=""`,
  ]
}

function buildInputFirewallRules(
  lanAddress: LanAddress,
  extractedRules: string[],
  includeIpsecRules: boolean,
): string[] {
  const lanCidr = `${lanAddress.net}/24`
  const lanMoscowRule = findFirewallRule(extractedRules, /src-address-list=lan-moscow/i)
  const udpIpsecRule = extractedRules.find(
    (rule) => /protocol=udp\b/i.test(rule) && /dst-port=(500,4500|4500,500)/i.test(rule),
  )

  const rules: string[] = [
    `/ip firewall filter add chain=input action=accept connection-state=established,related`,
    `/ip firewall filter add chain=input action=drop connection-state=invalid`,
  ]

  if (includeIpsecRules) {
    rules.push(
      lanMoscowRule
        ? stripRouterOsComment(lanMoscowRule)
        : `/ip firewall filter add chain=input action=accept src-address-list=lan-moscow`,
    )
  }

  rules.push(`/ip firewall filter add chain=input action=accept src-address=${lanCidr}`)

  if (includeIpsecRules) {
    rules.push(
      udpIpsecRule
        ? stripRouterOsComment(udpIpsecRule)
        : `/ip firewall filter add chain=input action=accept protocol=udp dst-port=500,4500`,
      `/ip firewall filter add chain=input action=accept protocol=ipsec-esp`,
    )
  }

  rules.push(`/ip firewall filter add chain=input action=drop`)
  return rules
}

function buildForwardFirewallRules(): string[] {
  return [
    `/ip firewall filter add chain=forward action=accept connection-state=established,related`,
    `/ip firewall filter add chain=forward action=drop connection-state=invalid`,
  ]
}

function buildHardeningBlock(
  lanAddress: LanAddress,
  wifiEnabled: boolean,
  extractedInputRules: string[],
  includeIpsecRules: boolean,
): string[] {
  const lanInterface = wifiEnabled ? 'bridge-lan' : 'ether1'
  const mgmtAddrs = managementAddresses(lanAddress.net)

  return [
    `/interface list add name=LAN`,
    `/interface list member add list=LAN interface=${lanInterface}`,
    `/tool mac-server set allowed-interface-list=LAN`,
    `/tool mac-server mac-winbox set allowed-interface-list=LAN`,
    `/ip neighbor discovery-settings set discover-interface-list=LAN`,
    `/ipv6 settings set disable-ipv6=yes`,
    `/ip service set telnet disabled=yes`,
    `/ip service set ftp disabled=yes`,
    `/ip service set www disabled=yes`,
    `/ip service set api disabled=yes`,
    `/ip service set api-ssl disabled=yes`,
    `/ip service set winbox address=${mgmtAddrs}`,
    `/ip service set ssh address=${mgmtAddrs}`,
    ...buildInputFirewallRules(lanAddress, extractedInputRules, includeIpsecRules),
    ...buildForwardFirewallRules(),
  ]
}

export function buildPreviewConfig(options: {
  lanAddress: LanAddress
  wifiEnabled: boolean
  wifiSsid: string
  wifiPassword: string
  wifiHidden: boolean
  primaryScript: string
  newPassword: string
  deviceName: string
}): string {
  const {
    lanAddress,
    wifiEnabled,
    wifiSsid,
    wifiPassword,
    wifiHidden,
    primaryScript,
    newPassword,
    deviceName,
  } = options

  const base = primaryScript.trim()
  if (!base) return ''

  const scriptCommands = splitScriptToCommands(base)
  const { vpnCommands, inputFirewallRules } = partitionVpnScript(scriptCommands)

  const sections = [
    buildCleanupBlock(scriptCommands).join('\n'),
    buildLanPrefix(lanAddress, wifiEnabled, wifiSsid, wifiPassword, wifiHidden).join('\n'),
    `/ip firewall nat add chain=srcnat out-interface=lte1 action=masquerade`,
    vpnCommands.length > 0 ? vpnCommands.join('\n') : '',
    buildHardeningBlock(lanAddress, wifiEnabled, inputFirewallRules, true).join('\n'),
    [
      deviceName.trim() ? `/system identity set name="${deviceName.trim()}"` : '',
      newPassword ? `/user set admin password=${newPassword}` : '',
      newPassword ? buildPassThroughCommand() : '',
    ]
      .filter(Boolean)
      .join('\n'),
  ]

  return sections.filter(Boolean).join('\n\n')
}
