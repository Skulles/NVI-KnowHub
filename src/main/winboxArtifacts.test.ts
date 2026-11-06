import { describe, expect, it } from 'vitest'
import {
  artifactNamesForPlatform,
  bundledCandidateNames,
  pickWindowsExeBasename,
  parseWinboxArtifactNamesFromPage,
  parseWinboxVersionFromPage,
  versionCandidatesForCdn,
  winboxCdnUrls,
  zipEntryBasename
} from './winboxArtifacts'

describe('bundledCandidateNames', () => {
  it('accepts current and legacy Windows exe names', () => {
    expect(bundledCandidateNames('win32')).toEqual(['WinBox64.exe', 'WinBox.exe', 'winbox.exe'])
  })
})

describe('pickWindowsExeBasename', () => {
  it('prefers WinBox64.exe when both exist', () => {
    expect(pickWindowsExeBasename(['WinBox.exe', 'WinBox64.exe'])).toBe('WinBox64.exe')
  })

  it('accepts WinBox.exe from MikroTik 4.3 zip', () => {
    expect(pickWindowsExeBasename(['WinBox.exe', 'assets/img/winbox.png'])).toBe('WinBox.exe')
  })
})

describe('artifactNamesForPlatform', () => {
  const fromPage = ['WinBox_Linux.zip', 'WinBox_Windows.zip', 'WinBox_Windows_arm64.zip']

  it('does not try the ARM64 zip on x64 Windows', () => {
    expect(artifactNamesForPlatform('win32', 'x64', fromPage)).toEqual(['WinBox_Windows.zip'])
  })

  it('prefers the ARM64 zip on arm64 Windows', () => {
    expect(artifactNamesForPlatform('win32', 'arm64', fromPage)[0]).toBe('WinBox_Windows_arm64.zip')
  })
})

describe('parseWinboxVersionFromPage', () => {
  it('reads v4.3 from the current MikroTik heading', () => {
    const html =
      '<img alt="WinBox logo" /><h4 class="font-bold mb-4">v4.3</h4>' +
      '&quot;name&quot;:&quot;WinBox_Windows.zip&quot;'
    expect(parseWinboxVersionFromPage(html)).toBe('4.3')
    expect(parseWinboxArtifactNamesFromPage(html)).toEqual(['WinBox_Windows.zip'])
  })

  it('reads the CDN folder when the heading is missing', () => {
    const html = 'https://download.mikrotik.com/routeros/winbox/4.4/WinBox_Windows.zip'
    expect(parseWinboxVersionFromPage(html)).toBe('4.4')
  })
})

describe('versionCandidatesForCdn', () => {
  it('uses only the live page version when it is known', () => {
    expect(versionCandidatesForCdn('4.4')).toEqual(['4.4'])
  })

  it('falls back to known folders only if the page version is missing', () => {
    expect(versionCandidatesForCdn('')).toEqual(['4.3', '4.2', '4.1'])
  })
})

describe('winboxCdnUrls', () => {
  it('builds x64 windows URLs without arm64 archives', () => {
    const urls = winboxCdnUrls('win32', 'x64', '4.3', ['WinBox_Windows.zip', 'WinBox_Windows_arm64.zip'])
    expect(urls[0]).toBe('https://download.mikrotik.com/routeros/winbox/4.3/WinBox_Windows.zip')
    expect(urls.every((url) => !/arm64/i.test(url))).toBe(true)
  })
})

describe('zipEntryBasename', () => {
  it('strips zip folders', () => {
    expect(zipEntryBasename('folder/WinBox.exe')).toBe('WinBox.exe')
  })
})
