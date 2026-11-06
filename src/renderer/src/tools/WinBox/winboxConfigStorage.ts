export type SavedConfigFlow = 'lte-ipsec' | 'groovea'

export type SavedConfigRole = 'ap' | 'station1' | 'station2'

export interface SavedMikrotikConfig {
  id: string
  owlDigits: string
  deviceId: string
  deviceLabel: string
  fileName: string
  /** Full downloadable .txt (header + all roles / commands). */
  content: string
  /** Credentials block shown above the RouterOS commands. */
  headerText?: string
  /** RouterOS commands shown in the preview pane (LtAP). */
  previewCommands?: string
  /** Per-role preview commands (Groovea / Metal). */
  roleConfigs?: Partial<Record<SavedConfigRole, string>>
  flow?: SavedConfigFlow
  createdAt: number
  updatedAt: number
}

export interface WinboxConfigSnapshot {
  configs: SavedMikrotikConfig[]
}

const STORAGE_KEY = 'winbox-configs-v1'
const ROLE_KEYS: SavedConfigRole[] = ['ap', 'station1', 'station2']

const DEFAULT: WinboxConfigSnapshot = {
  configs: [],
}

function isSavedConfigRole(value: string): value is SavedConfigRole {
  return ROLE_KEYS.includes(value as SavedConfigRole)
}

function normalizeRoleConfigs(value: unknown): Partial<Record<SavedConfigRole, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const next: Partial<Record<SavedConfigRole, string>> = {}
  for (const key of ROLE_KEYS) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      next[key] = record[key]
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function isSavedConfig(value: unknown): value is SavedMikrotikConfig {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.owlDigits === 'string' &&
    /^\d{4}$/.test(item.owlDigits) &&
    typeof item.deviceId === 'string' &&
    typeof item.deviceLabel === 'string' &&
    typeof item.fileName === 'string' &&
    typeof item.content === 'string' &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) &&
    typeof item.updatedAt === 'number' &&
    Number.isFinite(item.updatedAt)
  )
}

/** Recover credentials header from older combined downloads. */
export function parseHeaderTextFromContent(content: string): string | undefined {
  const match = content.match(/^([\s\S]*?)\n={10,}\n/)
  const header = match?.[1]?.trim()
  return header || undefined
}

/** Recover role tabs from older saves that only stored the combined .txt. */
export function parseRoleConfigsFromContent(
  content: string,
): Partial<Record<SavedConfigRole, string>> | undefined {
  const roleByLabel: Record<string, SavedConfigRole> = {
    AP: 'ap',
    Station: 'station1',
    'Station 1': 'station1',
    'Station 2': 'station2',
  }
  const re =
    /===\s*(AP|Station 1|Station 2|Station):\s*[^=\n]+===\s*\n+([\s\S]*?)(?=\n+===\s*(?:AP|Station 1|Station 2|Station):|\s*$)/g
  const next: Partial<Record<SavedConfigRole, string>> = {}
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const role = roleByLabel[match[1]]
    const body = match[2]?.trim()
    if (role && body) next[role] = body
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/** Recover LtAP preview commands from older combined downloads. */
export function parsePreviewCommandsFromContent(content: string): string | undefined {
  const parts = content.split(/\n={10,}\n/)
  if (parts.length >= 2) {
    const commands = parts[1]?.trim()
    if (commands) return commands
  }
  return undefined
}

/** Drop secrets that are generated again on every save. */
function comparableConfigText(value: string | undefined): string {
  if (!value) return ''
  return value
    .replace(/^(Пароль(?: администратора)?|WiFi пароль):\s*.+$/gim, '$1: *')
    .replace(/(\/user set admin password=)\S+/g, '$1*')
    .replace(
      /(nv2-preshared-key|wpa2-pre-shared-key|security\.passphrase|(?<![\w-])password)="(?:\\.|[^"\\])*"/g,
      '$1="*"',
    )
}

function roleConfigsKey(value: Partial<Record<SavedConfigRole, string>> | undefined): string {
  if (!value) return ''
  return ROLE_KEYS.map((role) => comparableConfigText(value[role])).join('\0')
}

/** Same OWL, device, and settings. Generated passwords and link keys are ignored. */
function sameSavedConfigBody(
  a: Pick<
    SavedMikrotikConfig,
    'owlDigits' | 'deviceId' | 'content' | 'flow' | 'headerText' | 'previewCommands' | 'roleConfigs'
  >,
  b: Pick<
    SavedMikrotikConfig,
    'owlDigits' | 'deviceId' | 'content' | 'flow' | 'headerText' | 'previewCommands' | 'roleConfigs'
  >,
): boolean {
  return (
    a.owlDigits === b.owlDigits &&
    a.deviceId === b.deviceId &&
    comparableConfigText(a.content) === comparableConfigText(b.content) &&
    (a.flow ?? '') === (b.flow ?? '') &&
    comparableConfigText(a.headerText) === comparableConfigText(b.headerText) &&
    comparableConfigText(a.previewCommands) === comparableConfigText(b.previewCommands) &&
    roleConfigsKey(a.roleConfigs) === roleConfigsKey(b.roleConfigs)
  )
}

function keepLatestUniqueConfigs(configs: SavedMikrotikConfig[]): SavedMikrotikConfig[] {
  const newestFirst = [...configs].sort((a, b) => b.updatedAt - a.updatedAt)
  const unique: SavedMikrotikConfig[] = []
  for (const config of newestFirst) {
    if (unique.some((item) => sameSavedConfigBody(item, config))) continue
    unique.push(config)
  }
  return unique
}

function normalizeConfigs(value: unknown): SavedMikrotikConfig[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const configs: SavedMikrotikConfig[] = []

  for (const item of value) {
    if (!isSavedConfig(item) || seen.has(item.id)) continue
    seen.add(item.id)

    const flow =
      item.flow === 'lte-ipsec' || item.flow === 'groovea'
        ? item.flow
        : undefined
    const roleConfigs =
      flow === 'lte-ipsec'
        ? undefined
        : normalizeRoleConfigs(item.roleConfigs) ??
          (flow === 'groovea' || !flow ? parseRoleConfigsFromContent(item.content) : undefined)
    const previewCommands =
      typeof item.previewCommands === 'string' && item.previewCommands.trim()
        ? item.previewCommands
        : !roleConfigs
          ? parsePreviewCommandsFromContent(item.content)
          : undefined
    const headerText =
      typeof item.headerText === 'string' && item.headerText.trim()
        ? item.headerText
        : parseHeaderTextFromContent(item.content)
    const resolvedFlow: SavedConfigFlow | undefined =
      flow ?? (roleConfigs ? 'groovea' : previewCommands ? 'lte-ipsec' : undefined)
    const keepRoleConfigs = resolvedFlow !== 'lte-ipsec' ? roleConfigs : undefined

    configs.push({
      id: item.id,
      owlDigits: item.owlDigits,
      deviceId: item.deviceId,
      deviceLabel: item.deviceLabel,
      fileName: item.fileName,
      content: item.content,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(resolvedFlow ? { flow: resolvedFlow } : {}),
      ...(headerText ? { headerText } : {}),
      ...(previewCommands ? { previewCommands } : {}),
      ...(keepRoleConfigs ? { roleConfigs: keepRoleConfigs } : {}),
    })
  }

  return keepLatestUniqueConfigs(configs)
}

export function parseWinboxConfigSnapshot(value: unknown): WinboxConfigSnapshot {
  if (!value || typeof value !== 'object') return { ...DEFAULT, configs: [] }
  return { configs: normalizeConfigs((value as { configs?: unknown }).configs) }
}

export function loadWinboxConfigs(): WinboxConfigSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT, configs: [] }
    return parseWinboxConfigSnapshot(JSON.parse(raw))
  } catch {
    return { ...DEFAULT, configs: [] }
  }
}

export function saveWinboxConfigs(snapshot: WinboxConfigSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ configs: snapshot.configs }))
  } catch {
    // storage unavailable — ignore
  }
}

/** Keep a new version only when it differs. An identical save replaces the previous copy. */
export function appendSavedConfig(
  configs: SavedMikrotikConfig[],
  input: Omit<SavedMikrotikConfig, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): SavedMikrotikConfig[] {
  const now = Date.now()
  const nextEntry: SavedMikrotikConfig = {
    id: input.id ?? crypto.randomUUID(),
    owlDigits: input.owlDigits,
    deviceId: input.deviceId,
    deviceLabel: input.deviceLabel,
    fileName: input.fileName,
    content: input.content,
    createdAt: now,
    updatedAt: now,
    ...(input.flow ? { flow: input.flow } : {}),
    ...(input.headerText ? { headerText: input.headerText } : {}),
    ...(input.previewCommands ? { previewCommands: input.previewCommands } : {}),
    ...(input.roleConfigs ? { roleConfigs: input.roleConfigs } : {}),
  }

  const identical = configs.filter((item) => sameSavedConfigBody(item, nextEntry))
  if (identical.length === 0) return [nextEntry, ...configs]

  const earliest = identical.reduce((left, right) =>
    left.createdAt <= right.createdAt ? left : right,
  )
  return [
    { ...nextEntry, id: earliest.id, createdAt: earliest.createdAt, updatedAt: now },
    ...configs.filter((item) => !sameSavedConfigBody(item, nextEntry)),
  ]
}

export function removeSavedConfig(configs: SavedMikrotikConfig[], id: string): SavedMikrotikConfig[] {
  return configs.filter((item) => item.id !== id)
}

export function groupConfigsByOwlId(
  configs: SavedMikrotikConfig[],
): Array<{ owlDigits: string; configs: SavedMikrotikConfig[] }> {
  const byOwl = new Map<string, SavedMikrotikConfig[]>()

  for (const config of configs) {
    const list = byOwl.get(config.owlDigits)
    if (list) list.push(config)
    else byOwl.set(config.owlDigits, [config])
  }

  return [...byOwl.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owlDigits, items]) => ({
      owlDigits,
      configs: [...items].sort((a, b) => b.updatedAt - a.updatedAt),
    }))
}

export function formatConfigSavedAt(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toLocaleDateString('ru-RU')
  }
}

export function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/** Keep only OWLGUARD ID / login / admin password for the preview UI. */
export function toCredentialsSummary(header: string): string {
  const lines = header
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const owl = lines.find((line) => /^OWLGUARD ID:/i.test(line))
  const login = lines.find((line) => /^Логин:/i.test(line))
  const adminPasswordLine =
    lines.find((line) => /^Пароль администратора:/i.test(line)) ??
    lines.find((line) => /^Пароль:/i.test(line))
  const passwordValue = adminPasswordLine?.replace(/^Пароль(?: администратора)?:\s*/i, '').trim()
  const password = passwordValue ? `Пароль: ${passwordValue}` : undefined

  return [owl, login, password].filter(Boolean).join('\n')
}

export function getSavedConfigHeaderText(config: SavedMikrotikConfig): string {
  const raw = config.headerText?.trim() || parseHeaderTextFromContent(config.content) || ''
  return raw ? toCredentialsSummary(raw) : ''
}

export function getSavedConfigPreviewText(
  config: SavedMikrotikConfig,
  role: SavedConfigRole = 'ap',
): string {
  if (config.roleConfigs) {
    return config.roleConfigs[role] ?? config.roleConfigs.ap ?? config.content
  }
  if (config.previewCommands) return config.previewCommands
  if (isSavedConfigRole(role)) {
    const parsed = parseRoleConfigsFromContent(config.content)
    if (parsed?.[role]) return parsed[role]!
  }
  return parsePreviewCommandsFromContent(config.content) ?? config.content
}

export function getSavedConfigRoles(
  config: SavedMikrotikConfig,
): SavedConfigRole[] {
  // LTE / single-device configs never have AP/Station tabs.
  if (config.flow === 'lte-ipsec') return []

  const fromStored = ROLE_KEYS.filter((role) => Boolean(config.roleConfigs?.[role]))
  if (fromStored.length > 0) return fromStored

  const parsed = parseRoleConfigsFromContent(config.content)
  if (parsed) {
    const fromParsed = ROLE_KEYS.filter((role) => Boolean(parsed[role]))
    if (fromParsed.length > 0) return fromParsed
  }

  return []
}

export function getSavedConfigRoleLabels(
  roles: SavedConfigRole[],
): Partial<Record<SavedConfigRole, string>> {
  const singleStation = roles.includes('station1') && !roles.includes('station2')
  return {
    ap: 'AP',
    station1: singleStation ? 'Station' : 'Station 1',
    station2: 'Station 2',
  }
}

export function savedConfigHasRoleTabs(config: SavedMikrotikConfig): boolean {
  if (config.flow === 'lte-ipsec') return false
  return getSavedConfigRoles(config).length > 1
}
