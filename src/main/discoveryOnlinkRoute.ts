/**
 * Temporary on-link routes for 192.168.0.0/24, 192.168.1.0/24, and 192.168.3.152/32.
 * Windows sends ping and ARP for a foreign subnet only through a gateway. On a switch
 * with no gateway, an on-link route (no next hop) makes the NIC ask for those addresses.
 * Adding the route needs administrator rights, so the scan asks Windows once and the
 * elevated helper removes the routes when the scan stops or the app exits.
 */
import { execFile } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { EXTRA_HOST_CIDRS, EXTRA_SCAN_CIDRS, netmaskToPrefix, parseCidr, type OnlinkIface } from './discoveryOnlink'
import { ipv4ToInt, isIPv4 } from './discoveryMndp'
import { logger } from './logger'

const execFileAsync = promisify(execFile)
const ONLINK_ROUTE_METRIC = 9000
const ROUTE_DENIED =
  'Не удалось искать 192.168.0.0, 192.168.1.0 и 192.168.3.152: не подтверждены права администратора.'

const VIRTUAL_IFACE_RE =
  /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Bluetooth|Loopback|Npcap|TAP|Tailscale|ZeroTier|Hamachi|WAN Miniport|Pseudo-Interface|Teredo|isatap/i
const WIRELESS_IFACE_RE = /wi-?fi|wlan|wireless|беспровод/i

export interface ExtraOnlinkRoute {
  iface: string
  cidr: string
}

export function isVirtualInterface(name: string): boolean {
  return VIRTUAL_IFACE_RE.test(name)
}

export function isWirelessInterface(name: string): boolean {
  return WIRELESS_IFACE_RE.test(name)
}

/** Wired LAN wins over Wi-Fi. Virtual adapters are skipped while a real NIC exists. */
export function interfacesForExtraRoutes(ifaces: OnlinkIface[]): OnlinkIface[] {
  const named = ifaces.filter((iface) => iface.name.trim())
  const real = named.filter((iface) => !isVirtualInterface(iface.name))
  const pool = real.length ? real : named
  const wired = pool.filter((iface) => !isWirelessInterface(iface.name))
  return wired.length ? wired : pool
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
  const targets = interfacesForExtraRoutes(ifaces)
  for (const cidr of cidrs) {
    if (!parseCidr(cidr)) continue
    if (ifaces.some((iface) => cidrCoveredByIface(cidr, iface))) continue
    for (const iface of targets) {
      const name = iface.name.trim()
      const key = routeKey({ iface: name, cidr })
      if (seen.has(key)) continue
      seen.add(key)
      routes.push({ iface: name, cidr })
    }
  }
  return routes
}

function routeKey(route: ExtraOnlinkRoute): string {
  return `${route.iface}\0${route.cidr}`
}

function routeListKey(routes: ExtraOnlinkRoute[]): string {
  return routes.map(routeKey).sort().join('\n')
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function windowsRouteScript(
  routes: ExtraOnlinkRoute[],
  parentPid: number,
  readyPath: string,
  stopPath: string,
  donePath: string
): string {
  const entries = routes
    .map((route) => `  @{ Prefix = ${psQuote(route.cidr)}; Alias = ${psQuote(route.iface)} }`)
    .join('\n')
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$parent = ${parentPid}
$ready = ${psQuote(readyPath)}
$stop = ${psQuote(stopPath)}
$done = ${psQuote(donePath)}
$routes = @(
${entries}
)
$added = @()
try {
  foreach ($route in $routes) {
    $adapter = Get-NetAdapter -Name $route.Alias -ErrorAction Stop
    $existing = @(Get-NetRoute -DestinationPrefix $route.Prefix -InterfaceIndex $adapter.ifIndex -PolicyStore ActiveStore -ErrorAction SilentlyContinue |
      Where-Object { $_.NextHop -eq '0.0.0.0' })
    $ours = @($existing | Where-Object { $_.RouteMetric -eq ${ONLINK_ROUTE_METRIC} })
    if ($existing.Count -eq 0) {
      New-NetRoute -DestinationPrefix $route.Prefix -InterfaceIndex $adapter.ifIndex -NextHop 0.0.0.0 -RouteMetric ${ONLINK_ROUTE_METRIC} -PolicyStore ActiveStore | Out-Null
      $added += $route
    } elseif ($ours.Count -gt 0) {
      $added += $route
    }
  }
  Set-Content -LiteralPath $ready -Value 'ok' -Encoding ascii
  while ((Get-Process -Id $parent -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $stop)) {
    Start-Sleep -Milliseconds 400
  }
} catch {
  Set-Content -LiteralPath $ready -Value $_.Exception.Message -Encoding utf8
} finally {
  foreach ($route in $added) {
    Get-NetRoute -DestinationPrefix $route.Prefix -InterfaceAlias $route.Alias -PolicyStore ActiveStore -ErrorAction SilentlyContinue |
      Where-Object { $_.NextHop -eq '0.0.0.0' -and $_.RouteMetric -eq ${ONLINK_ROUTE_METRIC} } |
      Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
  }
  Set-Content -LiteralPath $done -Value 'done' -Encoding ascii
}
`
}

export function starterCommand(scriptPath: string): string {
  const path = scriptPath.replace(/'/g, "''")
  return (
    "$ErrorActionPreference = 'Stop'\n" +
    '$psi = New-Object System.Diagnostics.ProcessStartInfo\n' +
    "$psi.FileName = 'powershell.exe'\n" +
    "$psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File \"" +
    path +
    "\"'\n" +
    '$psi.UseShellExecute = $true\n' +
    "$psi.Verb = 'RunAs'\n" +
    "$psi.WindowStyle = 'Hidden'\n" +
    '[void][Diagnostics.Process]::Start($psi)\n'
  )
}

export function createExtraRouteSession(apply: (routes: ExtraOnlinkRoute[]) => Promise<void>) {
  let installed: ExtraOnlinkRoute[] = []
  let installedKey = ''
  let wantedKey = ''
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

  return {
    has(): boolean {
      return installed.length > 0
    },
    active(): boolean {
      return wantedKey.length === 0 || installedKey === wantedKey
    },
    interfaceNames(): string[] {
      return [...new Set(installed.map((route) => route.iface))]
    },
    sync(ifaces: OnlinkIface[]): Promise<void> {
      const token = ++generation
      return enqueue(async () => {
        if (token !== generation) return
        const wanted = extraRoutesToInstall(ifaces)
        const key = routeListKey(wanted)
        wantedKey = key
        if (key === installedKey) return
        await apply(wanted)
        if (token !== generation) {
          await apply([]).catch(() => undefined)
          installed = []
          installedKey = ''
          return
        }
        installed = wanted
        installedKey = key
      })
    },
    clear(): Promise<void> {
      const token = ++generation
      return enqueue(async () => {
        if (token !== generation) return
        wantedKey = ''
        if (!installedKey) return
        await apply([])
        installed = []
        installedKey = ''
      })
    }
  }
}

interface RouteHelper {
  dir: string
  stopPath: string
  donePath: string
}

let helper: RouteHelper | null = null
let warning: string | null = null

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function routeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/cancel|отмен|1223|denied|отказано|elevation|администратор/i.test(message)) return ROUTE_DENIED
  return 'Не удалось искать 192.168.0.0, 192.168.1.0 и 192.168.3.152 на этом свиче.'
}

async function waitForFile(path: string, timeoutMs: number): Promise<string | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) return readFileSync(path, 'utf8').trim()
    await delay(200)
  }
  return null
}

async function stopHelper(): Promise<void> {
  const current = helper
  helper = null
  if (!current) return
  try {
    writeFileSync(current.stopPath, 'stop', 'utf8')
  } catch {
    // helper directory already gone
  }
  await waitForFile(current.donePath, 8000)
  rmSync(current.dir, { recursive: true, force: true })
}

async function startHelper(routes: ExtraOnlinkRoute[]): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'knowhub-route-'))
  const scriptPath = join(dir, 'routes.ps1')
  const readyPath = join(dir, 'ready.txt')
  const stopPath = join(dir, 'stop')
  const donePath = join(dir, 'done.txt')
  writeFileSync(
    scriptPath,
    `\uFEFF${windowsRouteScript(routes, process.pid, readyPath, stopPath, donePath)}`,
    'utf8'
  )
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', starterCommand(scriptPath)], {
      timeout: 120_000,
      windowsHide: true
    })
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  const ready = await waitForFile(readyPath, 20_000)
  if (ready !== 'ok') {
    await stopHelperFile(stopPath, donePath)
    rmSync(dir, { recursive: true, force: true })
    throw new Error(ready || 'Маршрут не добавлен')
  }
  helper = { dir, stopPath, donePath }
  logger.info(`discovery on-link routes ready: ${routes.map((route) => route.cidr).join(', ')}`)
}

async function stopHelperFile(stopPath: string, donePath: string): Promise<void> {
  try {
    writeFileSync(stopPath, 'stop', 'utf8')
  } catch {
    return
  }
  await waitForFile(donePath, 8000)
}

async function applyWindowsRoutes(routes: ExtraOnlinkRoute[]): Promise<void> {
  await stopHelper()
  if (!routes.length) return
  await startHelper(routes)
}

const session = createExtraRouteSession(async (routes) => {
  if (process.platform !== 'win32') return
  await applyWindowsRoutes(routes)
})

export function extraRouteWarning(): string | null {
  return warning
}

export function extraRoutesActive(): boolean {
  if (process.platform !== 'win32') return true
  return session.active()
}

export function extraRouteInterfaceNames(): string[] {
  return session.interfaceNames()
}

export function ifacesThatAreUp(ifaces: OnlinkIface[], upNames: string[]): OnlinkIface[] {
  const up = new Set(upNames.map((name) => name.trim().toLowerCase()).filter(Boolean))
  if (!up.size) return ifaces
  const live = ifaces.filter((iface) => up.has(iface.name.trim().toLowerCase()))
  return live.length ? live : ifaces
}

async function readUpInterfaceNames(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-NetAdapter | Where-Object Status -eq Up | Select-Object -ExpandProperty Name'
      ],
      { timeout: 8000, windowsHide: true, encoding: 'utf8' }
    )
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  } catch (error) {
    logger.warn('discovery adapter status failed', error)
    return []
  }
}

export async function syncExtraOnlinkRoutes(ifaces: OnlinkIface[]): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const live = ifacesThatAreUp(ifaces, await readUpInterfaceNames())
    await session.sync(live)
    if (session.active()) warning = null
  } catch (error) {
    warning = routeFailureMessage(error)
    logger.warn('discovery on-link route failed', error)
  }
}

export function clearExtraOnlinkRoutes(): Promise<void> {
  return session.clear().catch((error) => {
    logger.warn('discovery on-link route clear failed', error)
  })
}

let quitCleanup: Promise<void> | null = null

export function clearExtraOnlinkRoutesOnQuit(quit: () => void, prevent: () => void): void {
  if (!session.has()) return
  prevent()
  if (quitCleanup) return
  quitCleanup = clearExtraOnlinkRoutes().finally(() => {
    quitCleanup = null
    quit()
  })
}
