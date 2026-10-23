import { describe, expect, it } from 'vitest'
import { Resource } from 'resedit'
import { RUSSIAN, UNICODE, useRussianVersionLanguage } from './win-exe-language.js'

describe('useRussianVersionLanguage', () => {
  it('replaces the English version block with Russian and keeps the strings', () => {
    const versionInfo = Resource.VersionInfo.create(1033, {}, [
      {
        lang: 1033,
        codepage: UNICODE,
        values: {
          FileDescription: 'NVI KnowHub',
          ProductName: 'NVI KnowHub',
          LegalCopyright: 'Copyright © NVI'
        }
      }
    ])

    useRussianVersionLanguage(versionInfo)

    const entry = versionInfo.generateResource()
    expect(entry.lang).toBe(RUSSIAN)

    const readBack = Resource.VersionInfo.fromEntries([entry])
    expect(readBack).toHaveLength(1)
    expect(readBack[0].lang).toBe(RUSSIAN)
    expect(readBack[0].getAvailableLanguages()).toEqual([{ lang: RUSSIAN, codepage: UNICODE }])
    expect(readBack[0].getAllLanguagesForStringValues()).toEqual([
      { lang: RUSSIAN, codepage: UNICODE }
    ])
    expect(readBack[0].getStringValues({ lang: RUSSIAN, codepage: UNICODE })).toMatchObject({
      FileDescription: 'NVI KnowHub',
      ProductName: 'NVI KnowHub',
      LegalCopyright: 'Copyright © NVI'
    })
  })
})
