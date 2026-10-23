/**
 * Off-link extra hosts (192.168.3.152; on a full scan also 10.64-80.*.40-50).
 * ICMP follows the routing table and can leak into a VPN; ARP is bound to the NIC.
 */
import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { collectOfflinkExtraTargets, type OnlinkIface } from './discoveryOnlink'
import { isIPv4 } from './discoveryMndp'
import { normalizeMacString } from './discoveryWs'

const execFileAsync = promisify(execFile)
const ARP_CONCURRENCY = 32

export function parseSendArpLines(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f:]{11,17})$/i)
    if (!match) continue
    found.set(match[1], normalizeMacString(match[2]))
  }
  return found
}

export function parseArpingReply(text: string): Map<string, string> {
  const found = new Map<string, string>()
  const pattern = /(?:Unicast reply from|from)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\[([0-9a-f:]{11,17})\]/gi
  for (const match of text.matchAll(pattern)) {
    const mac = normalizeMacString(match[2])
    if (isIPv4(match[1]) && mac) found.set(match[1], mac)
  }
  return found
}

function sendArpFileScript(srcIp: string, listPath: string): string {
  const escaped = listPath.replace(/'/g, "''")
  return `
$ErrorActionPreference = 'SilentlyContinue'
$src = [BitConverter]::ToUInt32([Net.IPAddress]::Parse('${srcIp}').GetAddressBytes(), 0)
Add-Type -Namespace KnowHub -Name Arp -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("iphlpapi.dll", ExactSpelling=true)]
public static extern int SendARP(uint destIP, uint srcIP, byte[] macAddr, ref uint physicalAddrLen);
'@
Get-Content -LiteralPath '${escaped}' | ForEach-Object {
  $dest = $_.Trim()
  if (-not $dest) { return }
  $mac = New-Object byte[] 6
  $len = [uint32]6
  $destN = [BitConverter]::ToUInt32([Net.IPAddress]::Parse($dest).GetAddressBytes(), 0)
  if ([KnowHub.Arp]::SendARP($destN, $src, $mac, [ref]$len) -eq 0 -and $len -ge 6) {
    $hex = ($mac[0..5] | ForEach-Object { $_.ToString('X2') }) -join ':'
    Write-Output "$dest $hex"
  }
}
`
}

function sendArpParallelScript(srcIp: string, listPath: string): string {
  const src = srcIp.replace(/'/g, "''")
  const list = listPath.replace(/'/g, "''")
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace KnowHubArpSweep -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("iphlpapi.dll", ExactSpelling=true)]
public static extern int SendARP(uint destIP, uint srcIP, byte[] macAddr, ref uint physicalAddrLen);
'@
$src = [BitConverter]::ToUInt32(([Net.IPAddress]::Parse('${src}')).GetAddressBytes(), 0)
$ips = @(Get-Content -LiteralPath '${list}' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($ips.Count -eq 0) { return }
$pool = [runspacefactory]::CreateRunspacePool(1, 48)
$pool.Open()
$jobs = foreach ($dest in $ips) {
  $ps = [powershell]::Create()
  $ps.RunspacePool = $pool
  [void]$ps.AddScript({
    param($dest, $src)
    $mac = New-Object byte[] 6
    $len = [uint32]6
    $destN = [BitConverter]::ToUInt32(([Net.IPAddress]::Parse($dest)).GetAddressBytes(), 0)
    if ([KnowHubArpSweep.Native]::SendARP($destN, $src, $mac, [ref]$len) -eq 0 -and $len -ge 6) {
      $hex = ($mac[0..5] | ForEach-Object { $_.ToString('X2') }) -join ':'
      Write-Output "$dest $hex"
    }
  }).AddArgument($dest).AddArgument($src)
  [pscustomobject]@{ Ps = $ps; Handle = $ps.BeginInvoke() }
}
foreach ($job in @($jobs)) {
  try { $job.Ps.EndInvoke($job.Handle) } catch {}
  $job.Ps.Dispose()
}
$pool.Close()
$pool.Dispose()
`
}

async function probeSendArpOne(srcIp: string, destIps: string[], signal: AbortSignal): Promise<Map<string, string>> {
  if (signal.aborted || !destIps.length) return new Map()
  const dir = mkdtempSync(join(tmpdir(), 'knowhub-arp-'))
  const listPath = join(dir, 'ips.txt')
  writeFileSync(listPath, destIps.join('\n'), 'utf8')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', sendArpParallelScript(srcIp, listPath)],
      { timeout: 90_000, windowsHide: true, encoding: 'utf8', signal }
    )
    return parseSendArpLines(stdout)
  } catch (error) {
    const stdout =
      error && typeof error === 'object' && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : ''
    const found = parseSendArpLines(stdout)
    if (found.size) return found
    throw error
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function probeSendArp(
  sources: string[],
  destIps: string[],
  signal: AbortSignal
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (process.platform !== 'win32' || signal.aborted) return found
  let remaining = [...new Set(destIps.filter((ip) => isIPv4(ip)))]
  for (const src of sources) {
    if (signal.aborted || !remaining.length || !isIPv4(src)) break
    try {
      for (const [ip, mac] of await probeSendArpOne(src, remaining, signal)) found.set(ip, mac)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (signal.aborted) break
      throw new Error(message)
    }
    remaining = remaining.filter((ip) => !found.has(ip))
  }
  return found
}

async function probeWindowsArp(
  ifaces: OnlinkIface[],
  destIps: string[],
  signal: AbortSignal
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (signal.aborted || !destIps.length) return found
  const dir = mkdtempSync(join(tmpdir(), 'knowhub-arp-'))
  const listPath = join(dir, 'ips.txt')
  writeFileSync(listPath, destIps.join('\n'), 'utf8')
  const timeout = destIps.length > 32 ? 120_000 : 8_000
  try {
    for (const iface of ifaces) {
      if (signal.aborted) return found
      try {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', sendArpFileScript(iface.address, listPath)],
          { timeout, windowsHide: true }
        )
        for (const [ip, mac] of parseSendArpLines(stdout)) found.set(ip, mac)
      } catch {
        // fall through to the OS neighbor table
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return found
}

async function arpingOne(iface: string, ip: string, signal: AbortSignal): Promise<Map<string, string>> {
  if (signal.aborted) return new Map()
  return new Promise((resolve) => {
    const child = execFile(
      'arping',
      ['-c', '1', '-w', '1', '-I', iface, ip],
      { timeout: 1500, windowsHide: true },
      (_error, stdout, stderr) => {
        resolve(parseArpingReply(`${stdout ?? ''}\n${stderr ?? ''}`))
      }
    )
    const onAbort = (): void => {
      child.kill()
      resolve(new Map())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.once('close', () => signal.removeEventListener('abort', onAbort))
  })
}

async function probePosixArp(
  ifaces: OnlinkIface[],
  destIps: string[],
  signal: AbortSignal
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  let next = 0
  async function worker(ifaceName: string): Promise<void> {
    while (next < destIps.length && !signal.aborted) {
      const index = next
      next += 1
      const ip = destIps[index]
      if (!ip || !isIPv4(ip)) continue
      for (const [foundIp, mac] of await arpingOne(ifaceName, ip, signal)) found.set(foundIp, mac)
    }
  }

  for (const iface of ifaces) {
    if (signal.aborted) return found
    next = 0
    const workers = Array.from({ length: Math.min(ARP_CONCURRENCY, destIps.length) }, () => worker(iface.name))
    await Promise.all(workers)
  }
  return found
}

async function arpingAvailable(): Promise<boolean> {
  try {
    await execFileAsync('arping', ['-h'], { timeout: 800 })
    return true
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
    return code !== 'ENOENT'
  }
}

export async function probeOfflinkArp(
  ifaces: OnlinkIface[],
  signal: AbortSignal,
  options: { includeGrid?: boolean } = {}
): Promise<Map<string, string>> {
  const destIps = collectOfflinkExtraTargets(ifaces, options)
  if (!destIps.length || !ifaces.length || signal.aborted) return new Map()

  if (process.platform === 'win32') {
    return probeWindowsArp(ifaces, destIps, signal)
  }

  if (destIps.length <= 16 && (await arpingAvailable())) {
    return probePosixArp(ifaces, destIps, signal)
  }
  return new Map()
}
