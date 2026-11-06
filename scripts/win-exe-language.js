/**
 * Windows shows Properties → Details → Language from the exe version resource.
 * Electron ships that resource as English (United States), 1033.
 * Russian (Russia) is LANGID 1049 / 0x0419, Unicode code page 1200.
 *
 * Run this in afterPack, before electron-builder's rcedit. rcedit keeps the
 * language already stored in the version resource and would otherwise leave 1033.
 */

const { readFileSync, writeFileSync } = require('fs')

const RUSSIAN = 1049
const UNICODE = 1200
const RT_VERSION = 16

function isVersionResource(entry) {
  return entry.type === RT_VERSION && (entry.id === 1 || entry.id === '1')
}

function useRussianVersionLanguage(versionInfo) {
  const languages = versionInfo.getAllLanguagesForStringValues()
  if (languages.length === 0) {
    throw new Error('version resource has no string table')
  }

  const values = { ...versionInfo.getStringValues(languages[0]) }
  for (const language of languages) {
    versionInfo.removeAllStringValues(language)
  }

  versionInfo.lang = RUSSIAN
  versionInfo.setStringValues({ lang: RUSSIAN, codepage: UNICODE }, values)
  versionInfo.replaceAvailableLanguages([{ lang: RUSSIAN, codepage: UNICODE }])
  return versionInfo
}

async function setWindowsExeLanguage(exePath) {
  const { NtExecutable, NtExecutableResource, Resource } = await import('resedit')
  const exe = NtExecutable.from(readFileSync(exePath))
  const res = NtExecutableResource.from(exe)
  const infos = Resource.VersionInfo.fromEntries(res.entries)
  if (infos.length !== 1) {
    throw new Error(`${exePath}: expected one version resource, found ${infos.length}`)
  }

  const versionInfo = infos[0]
  useRussianVersionLanguage(versionInfo)

  // outputToResourceEntries only replaces an entry with the same language,
  // so the original English block has to be removed first.
  for (let index = res.entries.length - 1; index >= 0; index -= 1) {
    if (isVersionResource(res.entries[index])) res.entries.splice(index, 1)
  }
  res.entries.push(versionInfo.generateResource())

  res.outputResource(exe)
  writeFileSync(exePath, Buffer.from(exe.generate()))
}

module.exports = {
  RUSSIAN,
  UNICODE,
  useRussianVersionLanguage,
  setWindowsExeLanguage
}
