import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownTrayIcon, CheckIcon, ClipboardDocumentIcon, DiceIcon, RouterIcon, XMarkIcon } from '../../components/Icons'
import { useWinboxStore } from '../../store/winbox'
import ltapMiniLteKitImage from '../../assets/devices/mikrotik-ltap-mini-lte-kit.png'

const MIKROTIK_CONFIG_DEVICES = [
  {
    id: 'ltap-mini-lte-kit',
    label: 'LtAP mini',
    image: ltapMiniLteKitImage,
  },
  // {
  //   id: 'groovea-52',
  //   label: 'GrooveA 52 / Metal 52 ac',
  //   image: groovea52Image,
  // },
  // {
  //   id: 'mantbox-ax-15s',
  //   label: 'mANTBox ax 15s',
  //   image: mantboxAx15sImage,
  // },
] as const

function preloadDeviceImages(): void {
  for (const device of MIKROTIK_CONFIG_DEVICES) {
    const img = new Image()
    img.src = device.image
  }
}

function owlDigitsToLanAddress(digits: string): { ip: string; net: string } | null {
  if (!/^\d{4}$/.test(digits)) return null
  const secondOctet = digits.slice(0, 2)
  const thirdOctet = digits.slice(2, 4)
  return {
    ip: `10.${secondOctet}.${thirdOctet}.1`,
    net: `10.${secondOctet}.${thirdOctet}.0`,
  }
}

function buildOwlDeviceName(owlDigits: string): string {
  return `OWL${owlDigits}-LTE`
}

const WIFI_SSID_MAX_BYTES = 32

function wifiSsidByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function sanitizeWifiSsidInput(value: string): string {
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

function isValidWifiSsid(ssid: string): boolean {
  const normalized = ssid.trim()
  if (normalized.length === 0) return false
  if (wifiSsidByteLength(normalized) > WIFI_SSID_MAX_BYTES) return false
  if (ssid !== normalized) return false
  return /^[\x20-\x7E]+$/.test(normalized)
}

function parseOwlKeyFromScript(script: string): {
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

function ipToOctets(ip: string): [string, string, string, string] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  return parts as [string, string, string, string]
}

function octetsToLanAddress(octets: [string, string, string, string]): { ip: string; net: string } | null {
  if (octets.some((o) => o.trim() === '')) return null
  const nums = octets.map((o) => parseInt(o, 10))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return { ip: nums.join('.'), net: `${nums[0]}.${nums[1]}.${nums[2]}.0` }
}

function IpOctetInput({
  value,
  onChange,
  onComplete,
  inputRef,
  compact,
  plain,
}: {
  value: string
  onChange: (v: string) => void
  onComplete?: () => void
  inputRef?: (el: HTMLInputElement | null) => void
  compact?: boolean
  plain?: boolean
}) {
  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={3}
      value={value}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, '').slice(0, 3)
        onChange(next)
        if (next.length === 3) onComplete?.()
      }}
      onKeyDown={(e) => {
        if (e.key === '.' || e.key === 'ArrowRight') {
          e.preventDefault()
          onComplete?.()
        }
      }}
      className={
        plain
          ? `bg-transparent px-0 py-0 text-center font-mono text-label-primary focus:outline-none ${
              compact ? 'w-9 text-[14px]' : 'w-10 text-[15px]'
            }`
          : `rounded-lg bg-surface-input/80 px-2 py-2 text-center font-mono text-label-primary transition-[background-color,box-shadow] duration-200 focus:bg-surface-input focus:outline-none focus:ring-2 focus:ring-tint-blue/40 ${
              compact ? 'w-10 text-[13px]' : 'w-11 text-[14px]'
            }`
      }
    />
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium text-label-secondary">{children}</span>
}

function ToggleSwitch({
  checked,
  onClick,
  ariaLabel,
}: {
  checked: boolean
  onClick: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${
        checked ? 'bg-tint-blue' : 'bg-surface-input'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-[1.375rem]' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <FieldLabel>{label}</FieldLabel>
      <ToggleSwitch checked={checked} onClick={onChange} ariaLabel={label} />
    </div>
  )
}

const fieldControlClass =
  'w-full rounded-lg bg-surface-input/80 px-3 py-2.5 text-label-primary shadow-chromeTop transition-[background-color,box-shadow] duration-200 focus:bg-surface-input focus:outline-none focus:ring-2 focus:ring-tint-blue/45'

const fieldControlFitClass =
  'w-fit max-w-full rounded-lg bg-surface-input/80 px-3 py-2.5 text-label-primary shadow-chromeTop transition-[background-color,box-shadow] duration-200 focus:bg-surface-input focus:outline-none focus:ring-2 focus:ring-tint-blue/45'

function HintLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-md px-1 py-0.5 text-[12px] text-tint-blue transition-colors hover:text-tint-blue-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
    >
      {children}
    </button>
  )
}

function FormAlert({ tone, children }: { tone: 'warning' | 'muted'; children: ReactNode }) {
  return (
    <p
      className={`m-0 text-[12px] leading-relaxed ${
        tone === 'warning' ? 'text-amber-400' : 'text-label-tertiary'
      }`}
    >
      {children}
    </p>
  )
}

function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="mt-5 flex items-center justify-between gap-3 border-t border-surface-border/70 pt-4">
      {children}
    </footer>
  )
}

function BtnSecondary({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-xl border border-surface-border bg-surface-raised/20 px-4 py-2.5 text-[13px] font-medium text-label-secondary transition-colors duration-200 hover:border-surface-border hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${className}`}
    >
      {children}
    </button>
  )
}

function BtnPrimary({
  children,
  disabled,
  onClick,
  className = '',
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-xl bg-tint-blue px-4 py-2.5 text-[13px] font-semibold tracking-tight text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_20px_rgba(124,140,255,0.22)] transition-[background-color,transform,opacity] duration-200 hover:bg-tint-blue-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card ${className}`}
    >
      {children}
    </button>
  )
}

function escapeRouterOsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildLanPrefix(
  lanAddress: { ip: string; net: string },
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

function buildConfigHeader(
  owlDigits: string,
  lanAddress: { ip: string; net: string },
  wifi?: { ssid: string; password: string; hidden: boolean },
): string {
  const lines = [
    `OWLGUARD ID: ${owlDigits}`,
    `Сеть: ${lanAddress.net}/24`,
    `IP адрес Mikrotik роутера: ${lanAddress.ip}/24`,
  ]
  if (wifi) {
    lines.push(
      `WiFi SSID: ${wifi.ssid}`,
      `WiFi пароль: ${wifi.password}`,
      `Скрытая сеть: ${wifi.hidden ? 'да' : 'нет'}`,
    )
  }
  return lines.join('\n')
}

function buildConfigDownloadContent(header: string, commands: string): string {
  return `${header}\n\n${'='.repeat(40)}\n\n${commands}`
}

const MANAGEMENT_NETWORKS = ['192.168.3.0/24', '172.33.11.0/24', '10.33.12.0/24'] as const

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
    `/interface bridge port remove [find]`,
    `/interface wireless set [find default-name=wlan1] disabled=yes mode=station ssid=MikroTik security-profile=default`,
    `/interface wireless security-profiles remove [find where name!=default]`,
    `/interface bridge remove [find]`,
    `/tool mac-server set allowed-interface-list=all`,
    `/tool mac-server mac-winbox set allowed-interface-list=all`,
    `/ip neighbor discovery-settings set discover-interface-list=all`,
    `/ipv6 settings set disable-ipv6=no`,
    `/ip service set telnet disabled=no`,
    `/ip service set ftp disabled=no`,
    `/ip service set www disabled=no`,
    `/ip service set api disabled=no`,
    `/ip service set api-ssl disabled=no`,
    `/ip service set winbox address=""`,
    `/ip service set ssh address=""`,
  ]
}

function buildInputFirewallRules(
  lanAddress: { ip: string; net: string },
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
  lanAddress: { ip: string; net: string },
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

function buildPreviewConfig(options: {
  lanAddress: { ip: string; net: string }
  wifiEnabled: boolean
  wifiSsid: string
  wifiPassword: string
  wifiHidden: boolean
  primaryScript: string
  isManualSetup: boolean
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
    isManualSetup,
    newPassword,
    deviceName,
  } = options

  const base = isManualSetup ? '' : primaryScript.trim()
  if (!isManualSetup && !base) return ''

  const scriptCommands = base ? splitScriptToCommands(base) : []
  const { vpnCommands, inputFirewallRules } = partitionVpnScript(scriptCommands)

  const sections = [
    buildCleanupBlock(scriptCommands).join('\n'),
    buildLanPrefix(lanAddress, wifiEnabled, wifiSsid, wifiPassword, wifiHidden).join('\n'),
    `/ip firewall nat add chain=srcnat out-interface=lte1 action=masquerade`,
    vpnCommands.length > 0 ? vpnCommands.join('\n') : '',
    buildHardeningBlock(lanAddress, wifiEnabled, inputFirewallRules, !isManualSetup).join('\n'),
    [
      deviceName.trim() ? `/system identity set name="${deviceName.trim()}"` : '',
      newPassword ? `/user set admin password=${newPassword}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  ]

  return sections.filter(Boolean).join('\n\n')
}

function MikrotikConfigGenerator() {
  const [deviceId, setDeviceId] = useState<string>(MIKROTIK_CONFIG_DEVICES[0].id)
  const [modalOpen, setModalOpen] = useState(false)
  const [primaryScript, setPrimaryScript] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [owlDigits, setOwlDigits] = useState('')
  const [ipOctets, setIpOctets] = useState<[string, string, string, string]>(['10', '0', '0', '1'])
  const [wifiEnabled, setWifiEnabled] = useState(false)
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiSsidEdited, setWifiSsidEdited] = useState(false)
  const [wifiPassword, setWifiPassword] = useState('')
  const [wifiHidden, setWifiHidden] = useState(false)
  const [step, setStep] = useState<'input' | 'settings' | 'preview'>('input')
  const [isManualSetup, setIsManualSetup] = useState(false)
  const [copied, setCopied] = useState(false)
  const ipInputRefs = useMemo(() => Array.from({ length: 4 }, () => ({ current: null as HTMLInputElement | null })), [])

  const suggestedFromScript = useMemo(() => parseOwlKeyFromScript(primaryScript), [primaryScript])
  const deviceName = /^\d{4}$/.test(owlDigits) ? buildOwlDeviceName(owlDigits) : ''
  const lanAddressFromOwl = useMemo(() => owlDigitsToLanAddress(owlDigits), [owlDigits])
  const lanAddress = useMemo(() => octetsToLanAddress(ipOctets), [ipOctets])

  const applyOwlDigits = useCallback((digits: string) => {
    setOwlDigits(digits)
    const derived = owlDigitsToLanAddress(digits)
    if (derived) {
      const octets = ipToOctets(derived.ip)
      if (octets) setIpOctets(octets)
    }
    if (wifiEnabled && !wifiSsidEdited && /^\d{4}$/.test(digits)) {
      setWifiSsid(`owl${digits}`)
    }
  }, [wifiEnabled, wifiSsidEdited])

  const configHeaderText = useMemo(() => {
    if (!lanAddress || !/^\d{4}$/.test(owlDigits)) return ''
    const wifi =
      wifiEnabled && wifiSsid.trim() && wifiPassword.trim()
        ? { ssid: wifiSsid.trim(), password: wifiPassword.trim(), hidden: wifiHidden }
        : undefined
    return buildConfigHeader(owlDigits, lanAddress, wifi)
  }, [owlDigits, lanAddress, wifiEnabled, wifiSsid, wifiPassword, wifiHidden])

  const previewText = useMemo(() => {
    if (!lanAddress) return ''
    return buildPreviewConfig({
      lanAddress,
      wifiEnabled,
      wifiSsid,
      wifiPassword,
      wifiHidden,
      primaryScript,
      isManualSetup,
      newPassword,
      deviceName,
    })
  }, [primaryScript, lanAddress, newPassword, deviceName, isManualSetup, wifiEnabled, wifiSsid, wifiPassword, wifiHidden])

  const isValidIp = lanAddress !== null
  const canConfirmSettings =
    isValidIp &&
    newPassword.trim().length > 0 &&
    /^\d{4}$/.test(owlDigits) &&
    (!wifiEnabled || (isValidWifiSsid(wifiSsid) && wifiPassword.trim().length > 0))

  const isValidConfig = useMemo(() => {
    const lines = primaryScript.split('\n').filter((l) => l.trim())
    return lines.length > 0 && lines.every((l) => l.trimStart().startsWith('/ip'))
  }, [primaryScript])

  const hasIdentityLine = useMemo(
    () => /\/ip\s+ipsec\s+identity\s+add\b.*\bmy-id=key-id:/m.test(primaryScript),
    [primaryScript]
  )

  const device = MIKROTIK_CONFIG_DEVICES.find((d) => d.id === deviceId)

  const generatePassword = useCallback(() => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const lower = 'abcdefghjkmnpqrstuvwxyz'
    const digits = '23456789'
    const special = '!@#$%&*'
    const all = upper + lower + digits + special
    const pick = (s: string): string => s[Math.floor(Math.random() * s.length)]
    const chars = [pick(upper), pick(lower), pick(digits), pick(special),
      ...Array.from({ length: 8 }, () => pick(all))]
    return chars.sort(() => Math.random() - 0.5).join('')
  }, [])

  const generateAdminPassword = useCallback(() => {
    setNewPassword(generatePassword())
  }, [generatePassword])

  const generateWifiPassword = useCallback(() => {
    setWifiPassword(generatePassword())
  }, [generatePassword])

  const toggleWifi = useCallback(() => {
    setWifiEnabled((enabled) => {
      if (!enabled) {
        setWifiSsidEdited(false)
        if (/^\d{4}$/.test(owlDigits)) {
          setWifiSsid(`owl${owlDigits}`)
        }
        setWifiPassword((pwd) => (pwd.trim() ? pwd : generatePassword()))
      }
      return !enabled
    })
  }, [owlDigits, generatePassword])

  const handleCopy = useCallback(async () => {
    if (!previewText) return
    try {
      await navigator.clipboard.writeText(previewText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }, [previewText])

  const handleSave = useCallback(() => {
    if (!previewText || !configHeaderText || !lanAddress || !/^\d{4}$/.test(owlDigits)) return
    const content = buildConfigDownloadContent(configHeaderText, previewText)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${buildOwlDeviceName(owlDigits)}-config.txt`
    link.click()
    URL.revokeObjectURL(url)
  }, [previewText, configHeaderText, lanAddress, owlDigits])

  const deviceLabel =
    MIKROTIK_CONFIG_DEVICES.find((d) => d.id === deviceId)?.label ?? deviceId

  const resetGeneratorState = useCallback(() => {
    setPrimaryScript('')
    setNewPassword('')
    setOwlDigits('')
    setIpOctets(['10', '0', '0', '1'])
    setIsManualSetup(false)
    setWifiEnabled(false)
    setWifiSsid('')
    setWifiSsidEdited(false)
    setWifiPassword('')
    setWifiHidden(false)
    setStep('input')
    setCopied(false)
  }, [])

  const openForDevice = useCallback((id: string) => {
    setDeviceId(id)
    resetGeneratorState()
    setModalOpen(true)
  }, [resetGeneratorState])

  const goToSettingsStep = useCallback(() => {
    setIsManualSetup(false)
    if (suggestedFromScript) {
      applyOwlDigits(suggestedFromScript.owlDigits)
    }
    generateAdminPassword()
    setStep('settings')
  }, [suggestedFromScript, generateAdminPassword, applyOwlDigits])

  const goToManualSettingsStep = useCallback(() => {
    setIsManualSetup(true)
    if (suggestedFromScript) {
      applyOwlDigits(suggestedFromScript.owlDigits)
    } else {
      setOwlDigits('')
      setIpOctets(['10', '0', '0', '1'])
    }
    if (!newPassword.trim()) generateAdminPassword()
    setStep('settings')
  }, [suggestedFromScript, newPassword, generateAdminPassword, applyOwlDigits])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    resetGeneratorState()
  }, [resetGeneratorState])

  useEffect(() => {
    if (!modalOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [modalOpen])

  useEffect(() => {
    if (!modalOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen, closeModal])

  const modal = modalOpen
    ? createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-[#0b0e16]/75 backdrop-blur-[6px] transition-opacity"
            aria-hidden
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mikrotik-config-modal-title"
            className="relative z-[1] flex max-h-[min(90vh,780px)] w-full max-w-[36rem] flex-col overflow-hidden rounded-[1.25rem] border border-surface-border/90 bg-surface-card shadow-sheet"
          >
            <header className="relative flex shrink-0 items-center gap-3 overflow-hidden border-b border-surface-border/80 px-5 py-4">
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-tint-blue/[0.08] via-transparent to-transparent"
                aria-hidden
              />
              <img
                src={device?.image}
                alt=""
                loading="eager"
                decoding="async"
                className="relative h-11 w-11 shrink-0 object-contain"
                draggable={false}
              />
              <div className="relative min-w-0 flex-1">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-label-tertiary">
                  MikroTik
                </p>
                <h3
                  id="mikrotik-config-modal-title"
                  className="m-0 mt-0.5 text-[16px] font-semibold leading-snug tracking-tight text-label-primary"
                >
                  {deviceLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="no-drag relative shrink-0 rounded-xl border border-transparent p-2 text-label-tertiary transition-colors hover:border-surface-border/80 hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                aria-label="Закрыть"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {step === 'input' ? (
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-2">
                    
                    <span className="text-[12px] leading-relaxed text-label-tertiary">
                    Вставьте команды от для IPsec, полученные от техподдержки. На их основе будет собран полный конфиг.
                    </span>
                    <textarea
                      value={primaryScript}
                      onChange={(e) => setPrimaryScript(e.target.value)}
                      rows={10}
                      spellCheck={false}
                      placeholder={'/ip ipsec profile add dh-group="..." ...\n/ip ipsec peer add ...\n/ip ipsec identity add my-id=key-id:...'}
                      className={`${fieldControlClass} min-h-[10rem] resize-none font-mono text-[12.5px] leading-[1.65] placeholder:text-label-tertiary/40`}
                    />
                  </label>

                  {(primaryScript.trim() && !isValidConfig) || (isValidConfig && !hasIdentityLine) ? (
                    <div className="space-y-2">
                      {primaryScript.trim() && !isValidConfig && (
                        <FormAlert tone="warning">
                          Убедитесь, что все команды введены верно — каждая должна начинаться с{' '}
                          <code className="font-mono text-amber-200/90">/ip</code>
                        </FormAlert>
                      )}
                      {isValidConfig && !hasIdentityLine && (
                        <FormAlert tone="warning">
                          Не найдена команда с{' '}
                          <code className="font-mono text-amber-200/90">key-id</code>. Проверьте, что скопированы все строки.
                        </FormAlert>
                      )}
                    </div>
                  ) : null}

                  <ModalFooter>
                    <div />
                    <div className="flex items-center gap-2">
                      <BtnSecondary onClick={goToManualSettingsStep}>Ручная настройка (без VPN)</BtnSecondary>
                      <BtnPrimary disabled={!isValidConfig || !hasIdentityLine} onClick={goToSettingsStep}>
                        Далее
                      </BtnPrimary>
                    </div>
                  </ModalFooter>
                </div>
              ) : step === 'settings' ? (
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                      <div className="flex w-fit flex-col gap-2">
                        <FieldLabel>OWLGUARD ID</FieldLabel>
                        <div className={`${fieldControlFitClass} flex h-[42px] items-center gap-2 px-2 py-0 focus-within:ring-2 focus-within:ring-tint-blue/45`}>
                          <span className="shrink-0 font-mono text-[13px] font-semibold text-tint-blue select-none">owl</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            autoFocus
                            maxLength={4}
                            value={owlDigits}
                            onChange={(e) => applyOwlDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            placeholder="0000"
                            className="w-[3.25rem] shrink-0 bg-transparent py-0 font-mono text-[15px] tracking-[0.12em] text-label-primary placeholder:text-label-tertiary/40 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="ml-6 flex w-fit flex-col gap-2">
                        <FieldLabel>IP-адрес в локальной сети</FieldLabel>
                        <div className={`${fieldControlFitClass} flex h-[42px] items-center gap-1 px-3 py-0 font-mono focus-within:ring-2 focus-within:ring-tint-blue/45`}>
                          {ipOctets.map((octet, i) => (
                            <span key={i} className="flex items-center gap-1">
                              <IpOctetInput
                                plain
                                compact
                                value={octet}
                                inputRef={(el) => { ipInputRefs[i].current = el }}
                                onChange={(v) => {
                                  setIpOctets((prev) => {
                                    const next = [...prev] as [string, string, string, string]
                                    next[i] = v
                                    return next
                                  })
                                }}
                                onComplete={() => {
                                  if (i < 3) ipInputRefs[i + 1].current?.focus()
                                }}
                              />
                              {i < 3 && <span className="text-[14px] text-label-tertiary/70">.</span>}
                            </span>
                          ))}
                          <span className="ml-1 text-[12px] text-label-tertiary">/24</span>
                        </div>
                      </div>
                    </div>
                    {suggestedFromScript && owlDigits !== suggestedFromScript.owlDigits && (
                      <HintLink onClick={() => applyOwlDigits(suggestedFromScript.owlDigits)}>
                        Подставить из конфига: owl{suggestedFromScript.owlDigits}
                      </HintLink>
                    )}
                    {lanAddressFromOwl && lanAddress?.ip !== lanAddressFromOwl.ip && (
                      <HintLink
                        onClick={() => {
                          const octets = ipToOctets(lanAddressFromOwl.ip)
                          if (octets) setIpOctets(octets)
                        }}
                      >
                        Подставить из имени: {lanAddressFromOwl.ip}
                      </HintLink>
                    )}
                    {ipOctets.some((o) => o.trim() !== '') && !isValidIp && (
                      <FormAlert tone="warning">
                        Введите корректный IP-адрес (каждый октет от 0 до 255)
                      </FormAlert>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <FieldLabel>Новый пароль администратора</FieldLabel>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Сгенерируйте или введите пароль"
                        className={`${fieldControlClass} min-w-0 flex-1 text-[14px] placeholder:text-label-tertiary/40`}
                      />
                      <button
                        type="button"
                        onClick={generateAdminPassword}
                        title="Сгенерировать пароль"
                        className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-surface-input/80 text-label-secondary shadow-chromeTop transition-colors hover:text-tint-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                        aria-label="Сгенерировать пароль"
                      >
                        <DiceIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <ToggleField label="Включить WiFi" checked={wifiEnabled} onChange={toggleWifi} />

                    <div
                      className={`grid transition-[grid-template-rows] duration-300 ease-spring ${
                        wifiEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                      }`}
                    >
                      <div className="min-h-0 overflow-hidden" aria-hidden={!wifiEnabled}>
                        <div className="flex flex-col gap-3 p-1">
                          <div className="grid grid-cols-1 items-end gap-x-3 gap-y-2 sm:grid-cols-2">
                            <div className="flex min-w-0 flex-col gap-2">
                              <FieldLabel>Имя сети (SSID)</FieldLabel>
                              <input
                                type="text"
                                autoComplete="off"
                                value={wifiSsid}
                                onChange={(e) => {
                                  setWifiSsidEdited(true)
                                  setWifiSsid(sanitizeWifiSsidInput(e.target.value))
                                }}
                                onBlur={() => setWifiSsid((ssid) => ssid.trim())}
                                placeholder="owl0000"
                                className={`${fieldControlClass} h-[42px] py-0 text-[14px] placeholder:text-label-tertiary/40`}
                              />
                            </div>

                            <div className="flex min-w-0 flex-col gap-2">
                              <FieldLabel>Пароль WiFi</FieldLabel>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  autoComplete="new-password"
                                  value={wifiPassword}
                                  onChange={(e) => setWifiPassword(e.target.value)}
                                  placeholder="Пароль для подключения"
                                  className={`${fieldControlClass} h-[42px] min-w-0 flex-1 py-0 text-[14px] placeholder:text-label-tertiary/40`}
                                />
                                <button
                                  type="button"
                                  onClick={generateWifiPassword}
                                  title="Сгенерировать пароль"
                                  className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-surface-input/80 text-label-secondary shadow-chromeTop transition-colors hover:text-tint-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                                  aria-label="Сгенерировать пароль WiFi"
                                >
                                  <DiceIcon className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>

                          <ToggleField
                            label="Скрытая сеть"
                            checked={wifiHidden}
                            onChange={() => setWifiHidden((v) => !v)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <ModalFooter>
                    <BtnSecondary onClick={() => { setIsManualSetup(false); setStep('input') }}>Назад</BtnSecondary>
                    <BtnPrimary disabled={!canConfirmSettings} onClick={() => setStep('preview')}>
                      Подтвердить
                    </BtnPrimary>
                  </ModalFooter>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <FieldLabel>Готовый конфиг</FieldLabel>
                    <span className="text-[12px] leading-relaxed text-label-tertiary">
                      Вставьте в терминал через WinBox или SSH.
                    </span>
                    <pre className={`${fieldControlClass} m-0 max-h-[38vh] overflow-auto font-mono text-[12px] leading-[1.7]`}>
                      <code>{previewText || '(пусто — вернитесь назад и заполните параметры)'}</code>
                    </pre>
                    <div className="mt-4 -mb-1 rounded-xl border border-tint-blue/25 bg-tint-blue/[0.06] px-4 py-3">
                      <p className="m-0 text-[12px] leading-relaxed text-label-secondary">
                        После применения конфига перезагрузите устройство командой{' '}
                        <code className="font-mono text-label-primary">/system reboot</code>
                      </p>
                    </div>
                  </div>

                  <ModalFooter>
                    <BtnSecondary onClick={() => setStep('settings')}>Назад</BtnSecondary>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!previewText || !configHeaderText}
                        onClick={handleSave}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-surface-input/80 px-4 py-2.5 text-[13px] font-semibold text-label-secondary shadow-chromeTop transition-colors duration-200 hover:text-label-primary disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
                        Сохранить
                      </button>
                      <button
                        type="button"
                        disabled={!previewText}
                        onClick={handleCopy}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${
                          copied
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : 'bg-surface-input/80 text-label-secondary shadow-chromeTop hover:text-label-primary'
                        }`}
                      >
                        {copied ? (
                          <CheckIcon className="h-4 w-4 shrink-0" />
                        ) : (
                          <ClipboardDocumentIcon className="h-4 w-4 shrink-0" />
                        )}
                        {copied ? 'Скопировано' : 'Копировать'}
                      </button>
                    </div>
                  </ModalFooter>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <section className="border-surface-border pt-10">
      <header className="mb-6">
        <h2 className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-label-tertiary">
          Генератор конфигов
        </h2>
      
      </header>

      <div className="flex w-full flex-nowrap items-start gap-3">
        {MIKROTIK_CONFIG_DEVICES.map((d) => {
          const isActive = modalOpen && deviceId === d.id
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => openForDevice(d.id)}
              aria-label={`Открыть генератор конфига: ${d.label}`}
              className={`no-drag flex aspect-[9/12] min-h-0 min-w-0 max-w-[184px] flex-[1_1_0] flex-col items-center justify-center overflow-hidden rounded-2xl border text-left shadow-chromeTop transition-[border-color,box-shadow,background-color] duration-200 ${
                isActive
                  ? 'border-tint-blue/45 bg-tint-blue/[0.07] ring-1 ring-tint-blue/35'
                  : 'border-surface-border bg-surface-card/90 hover:border-surface-border hover:bg-white/[0.03]'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/55 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-window`}
            >
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 pt-3 pb-1">
                <img
                  src={d.image}
                  alt=""
                  loading="eager"
                  decoding="async"
                  className="max-h-full w-full max-w-full object-contain object-center select-none"
                  draggable={false}
                />
              </div>
              <p className="mt-2.5 text-center text-[12px] font-semibold leading-snug text-label-secondary sm:text-[13px]">
                MikroTik
              </p>
              <span className="shrink-0 px-2 py-2.5 text-center text-[12px] font-semibold leading-snug text-label-primary sm:text-[13px]">
                {d.label}
              </span>
            </button>
          )
        })}
      </div>

      {modal}
    </section>
  )
}

export function WinBox() {
  const {
    checkStatus,
    bundled,
    sidebarOpenError,
    mikrotikOnline,
    bundledExpectedName,
    setChecking,
    setResult,
    setError,
    setSidebarOpenError
  } = useWinboxStore()

  const [openError, setOpenError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const expectedName = bundledExpectedName || 'WinBox'

  const refreshWinboxInfo = useCallback(async () => {
    if (!window.api) return
    const info = await window.api.winboxCheckUpdate()
    setResult({
      bundled: info.bundled,
      hasUpdate: info.hasUpdate,
      latest: info.latest,
      local: info.local,
      mikrotikOnline: info.mikrotikOnline,
      bundledExpectedName: info.bundledExpectedName
    })
  }, [setResult])

  useEffect(() => {
    preloadDeviceImages()
  }, [])

  useEffect(() => {
    if (checkStatus !== 'idle' || !window.api) return
    setChecking()
    window.api
      .winboxCheckUpdate()
      .then((info) =>
        setResult({
          bundled: info.bundled,
          hasUpdate: info.hasUpdate,
          latest: info.latest,
          local: info.local,
          mikrotikOnline: info.mikrotikOnline,
          bundledExpectedName: info.bundledExpectedName
        })
      )
      .catch(() => setError())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrimaryAction = useCallback(async () => {
    if (!window.api) return
    setOpenError(null)
    setDownloadError(null)
    setSidebarOpenError(null)

    if (!bundled && checkStatus === 'done') {
      setDownloading(true)
      const result = await window.api.winboxDownloadBundled()
      setDownloading(false)
      if (!result.ok) {
        setDownloadError(result.error ?? 'Не удалось загрузить WinBox.')
        return
      }
      await refreshWinboxInfo()
      return
    }

    setLaunching(true)
    const result = await window.api.winboxOpen()
    setLaunching(false)
    const name = useWinboxStore.getState().bundledExpectedName || 'WinBox'
    if (!result.ok) {
      setOpenError(
        result.error === 'not-bundled'
          ? `${name} не найден в ресурсах приложения.`
          : `Не удалось запустить WinBox: ${result.error}`
      )
    }
  }, [bundled, checkStatus, refreshWinboxInfo, setSidebarOpenError])

  const handleOpenDownloadPage = useCallback(async () => {
    if (!window.api) return
    setDownloadError(null)
    const { ok } = await window.api.winboxOpenDownloadPage()
    if (!ok) setDownloadError('Не удалось открыть страницу загрузки в браузере.')
  }, [])

  const isChecking = checkStatus === 'checking'
  const disabled = isChecking || launching || downloading

  const needsDownload = !bundled && checkStatus === 'done'
  const primaryLabel = launching
    ? 'Открываю…'
    : downloading
      ? 'Загружаю…'
      : needsDownload
        ? 'Загрузить'
        : 'Открыть'

  return (
    <article style={{ paddingBottom: 50 }} className="max-w-[36rem]">
      {/* header */}
      <header className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <RouterIcon className="h-7 w-7 shrink-0" />
            <h1 className="m-0 text-[1.5rem] font-semibold tracking-tighter text-label-primary">
              WinBox
            </h1>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={handlePrimaryAction}
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-tint-blue px-2.5 py-1 text-[11px] font-semibold tracking-tight text-white shadow-sm transition-colors duration-200
              hover:bg-tint-blue-hover active:scale-[0.98]
              disabled:cursor-not-allowed disabled:opacity-40
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-window"
          >
            {primaryLabel}
          </button>
        </div>
        <p className="text-label-secondary text-[14px] leading-relaxed">
          С помощью WinBox вы можете настроить любой продукт MikroTik.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {/* not bundled warning — та же кнопка: сначала «Загрузить», после — «Открыть» */}
        {!bundled && checkStatus === 'done' && (
          <aside className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
            <p className="m-0 text-[13px] text-amber-400 leading-relaxed">
              {expectedName} не найден
              </p>
           
           
          </aside>
        )}

       

        {/* errors */}
        {((openError ?? sidebarOpenError) || downloadError) && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 space-y-2 text-[13px] text-red-400">
            {(openError ?? sidebarOpenError) && <p className="m-0">{openError ?? sidebarOpenError}</p>}
            {downloadError && <p className="m-0">{downloadError}</p>}
          </div>
        )}
      </div>

      <MikrotikConfigGenerator />
    </article>
  )
}
