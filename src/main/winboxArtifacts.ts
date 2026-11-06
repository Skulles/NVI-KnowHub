/**
 * Pure WinBox artifact helpers (names, page parsing, CDN URL matrix).
 * Kept free of Electron/fs so vitest can cover them.
 */

export const WINBOX_DOWNLOAD_URL = 'https://mikrotik.com/download/winbox'
export const WINBOX_CDN_BASE = 'https://download.mikrotik.com/routeros/winbox'

/**
 * Last-resort CDN folders if mikrotik.com/download/winbox cannot be parsed.
 * Live downloads always prefer the version advertised on that page.
 */
export const WINBOX_CDN_VERSION_FALLBACKS = ['4.3', '4.2', '4.1']

export function bundledCandidateNames(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return ['WinBox64.exe', 'WinBox.exe', 'winbox.exe']
  if (platform === 'darwin') return ['WinBox.app']
  return ['WinBox', 'winbox']
}

/** Canonical filename we write on install / package into extraResources. */
export function getBundledExpectedName(platform: NodeJS.Platform = process.platform): string {
  return bundledCandidateNames(platform)[0]
}

export function zipEntryBasename(entryName: string): string {
  return entryName.replace(/\\/g, '/').split('/').pop() ?? ''
}

export function pickWindowsExeBasename(basenames: string[]): string | null {
  const lower = basenames.map((name) => name.toLowerCase())
  const byName = (want: string) => {
    const idx = lower.indexOf(want.toLowerCase())
    return idx === -1 ? null : basenames[idx]
  }
  return (
    byName('winbox64.exe') ||
    byName('WinBox.exe') ||
    byName('winbox.exe') ||
    basenames.find((name) => /\.exe$/i.test(name) && /winbox/i.test(name)) ||
    null
  )
}

export function decodeWinboxPageHtml(html: string): string {
  return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\\//g, '/')
}

export function parseWinboxVersionFromPage(html: string): string {
  const data = decodeWinboxPageHtml(html)
  const anchor = data.indexOf('alt="WinBox logo"')
  const slice = anchor === -1 ? data : data.slice(anchor, anchor + 24000)
  const fromHeading = slice.match(/<h4 class="font-bold mb-4">v([\d.]+)</)
  if (fromHeading) return fromHeading[1]

  const fromComponent = data.match(/components\.software\.winbox[^]*?"version":"([\d.]+)"/)
  if (fromComponent) return fromComponent[1]

  const fromCdn = data.match(/routeros\/winbox\/([\d.]+)\//)
  if (fromCdn) return fromCdn[1]

  return ''
}

export function parseWinboxArtifactNamesFromPage(html: string): string[] {
  const data = decodeWinboxPageHtml(html)
  const names: string[] = []
  const re = /"name":"(WinBox[^"]+\.(?:zip|dmg))"/g
  for (let m = re.exec(data); m; m = re.exec(data)) {
    names.push(m[1])
  }
  return [...new Set(names)]
}

export function artifactNamesForPlatform(
  platform: NodeJS.Platform,
  arch: string,
  fromPage: string[]
): string[] {
  const pageMatches = fromPage.filter((name) => {
    if (platform === 'win32') {
      if (!/windows/i.test(name)) return false
      if (arch !== 'arm64' && /arm64|aarch64/i.test(name)) return false
      return true
    }
    if (platform === 'darwin') return name.endsWith('.dmg') || /macos|darwin/i.test(name)
    return /linux/i.test(name)
  })

  const fallback =
    platform === 'win32'
      ? arch === 'arm64'
        ? ['WinBox_Windows_arm64.zip', 'WinBox_Windows.zip']
        : ['WinBox_Windows.zip']
      : platform === 'darwin'
        ? ['WinBox.dmg', 'WinBox_macOS.zip', 'WinBox_macos.zip', 'WinBox_Darwin.zip']
        : ['WinBox_Linux.zip', 'WinBox_linux.zip', 'WinBox_Linux_x64.zip']

  if (platform === 'win32' && arch === 'arm64') {
    const arm = pageMatches.filter((name) => /arm64|aarch64/i.test(name))
    const rest = pageMatches.filter((name) => !/arm64|aarch64/i.test(name))
    return [...new Set([...arm, ...rest, ...fallback])]
  }

  return [...new Set([...pageMatches, ...fallback])]
}

export function versionCandidatesForCdn(pageVersion: string): string[] {
  if (pageVersion) return [pageVersion]
  return [...WINBOX_CDN_VERSION_FALLBACKS]
}

export function winboxCdnUrls(
  platform: NodeJS.Platform,
  arch: string,
  pageVersion: string,
  artifactNamesFromPage: string[]
): string[] {
  const versions = versionCandidatesForCdn(pageVersion)
  const names = artifactNamesForPlatform(platform, arch, artifactNamesFromPage)
  const urls: string[] = []
  for (const ver of versions) {
    for (const name of names) {
      urls.push(`${WINBOX_CDN_BASE}/${ver}/${name}`)
    }
  }
  return urls
}
