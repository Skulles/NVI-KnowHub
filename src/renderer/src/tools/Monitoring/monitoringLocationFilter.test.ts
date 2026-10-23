import { describe, expect, it } from 'vitest'
import {
  buildOeLocationFilterOptions,
  extractLocationFilterTokens,
  extractOeEndingWords,
  isUndeterminedMonitoringLocation,
  MONITORING_UNDETERMINED_LOCATION_FILTER,
  objectMatchesOeLocationFilter
} from './monitoringLocationFilter'
import { findKnownLocationToken } from './monitoringLocationReference'
import { DEFAULT_OBJECT_KIND, type MonitoringObject } from './monitoringStorage'

function stubObject(overrides: Partial<MonitoringObject> = {}): MonitoringObject {
  return {
    id: 'owl1/',
    code: 'owl1/',
    objectKind: DEFAULT_OBJECT_KIND,
    linkHost: '10.0.0.1',
    serverHost: '10.0.0.2',
    serverLogin: 'a',
    serverPassword: 'b',
    ...overrides
  }
}

describe('extractOeEndingWords', () => {
  it('finds words ending in ое', () => {
    expect(extractOeEndingWords('БУ-12 Покровское месторождение')).toEqual(['Покровское'])
    expect(extractOeEndingWords('участок покурское')).toEqual(['покурское'])
  })

  it('deduplicates within one label', () => {
    expect(extractOeEndingWords('Покровское и Покровское')).toEqual(['Покровское'])
  })

  it('ignores labels without matching words', () => {
    expect(extractOeEndingWords('КРС-3')).toEqual([])
  })

  it('supports hyphenated settlement names', () => {
    expect(extractOeEndingWords('БУ Покров-ское')).toEqual(['Покров-ское'])
  })

  it('treats hyphenated and plain spellings as one token per label', () => {
    expect(extractOeEndingWords('Покров-ское / Покровское')).toEqual(['Покров-ское'])
  })

  it('keeps a direction word that stands before the field name', () => {
    expect(extractOeEndingWords('БУ Западно Мессояхское месторождение')).toEqual([
      'Западно Мессояхское'
    ])
    expect(extractOeEndingWords('Восточно Покровское')).toEqual(['Восточно Покровское'])
    expect(extractOeEndingWords('Северно Новое')).toEqual(['Северно Новое'])
    expect(extractOeEndingWords('Южно Покровское')).toEqual(['Южно Покровское'])
    expect(extractOeEndingWords('Северо Покровское')).toEqual(['Северо Покровское'])
    expect(extractOeEndingWords('Северо-Западно Покровское')).toEqual(['Северо-Западно Покровское'])
    expect(extractOeEndingWords('Юго Восточно Покровское')).toEqual(['Юго Восточно Покровское'])
  })

  it('leaves a hyphenated direction inside the field name', () => {
    expect(extractOeEndingWords('Западно-Мессояхское месторождение')).toEqual(['Западно-Мессояхское'])
  })

  it('keeps words that sit between a direction and the field name', () => {
    expect(extractOeEndingWords('западно усть балыкское')).toEqual(['западно усть балыкское'])
    expect(extractOeEndingWords('Западно Усть Балыкское месторождение')).toEqual([
      'Западно Усть Балыкское'
    ])
    expect(extractOeEndingWords('Западно-Усть Балыкское')).toEqual(['Западно-Усть Балыкское'])
    expect(extractOeEndingWords('Западно от Покровское')).toEqual(['Западно от Покровское'])
  })
})

describe('buildOeLocationFilterOptions', () => {
  it('aggregates counts by settlement word', () => {
    const options = buildOeLocationFilterOptions([
      stubObject({ id: 'owl1/', primaryLocationName: 'БУ Покровское' }),
      stubObject({ id: 'owl2/', primaryLocationName: 'БУ-2 Покровское' }),
      stubObject({ id: 'owl3/', primaryLocationName: 'ТКРС Новое' })
    ])
    expect(options).toEqual([
      { label: 'Новое', count: 1 },
      { label: 'Покровское', count: 2 }
    ])
  })

  it('merges hyphenated and plain spellings in counts', () => {
    const options = buildOeLocationFilterOptions([
      stubObject({ id: 'owl1/', primaryLocationName: 'Покров-ское' }),
      stubObject({ id: 'owl2/', primaryLocationName: 'Покровское' })
    ])
    expect(options).toEqual([{ label: 'Покров-ское', count: 2 }])
  })

  it('adds «Не определено» for objects without settlement token', () => {
    const options = buildOeLocationFilterOptions([
      stubObject({ id: 'owl1/', primaryLocationName: 'КРС-3' }),
      stubObject({ id: 'owl2/' }),
      stubObject({ id: 'owl3/', primaryLocationName: 'БУ Покровское' })
    ])
    expect(options).toEqual([
      { label: 'Покровское', count: 1 },
      { label: MONITORING_UNDETERMINED_LOCATION_FILTER, count: 2 }
    ])
  })

  it('uses reference catalog when «-ое» token is missing', () => {
    const options = buildOeLocationFilterOptions([
      stubObject({ id: 'owl1/', primaryLocationName: 'БУ, покурская залежь' }),
      stubObject({ id: 'owl2/', primaryLocationName: 'Мессояхский кластер' })
    ])
    expect(options).toEqual([
      { label: 'Мессояхский кластер', count: 1 },
      { label: 'покурская залежь', count: 1 }
    ])
  })

  it('merges a direction with words between it and the field across hyphen spelling', () => {
    const options = buildOeLocationFilterOptions([
      stubObject({ id: 'owl1/', primaryLocationName: 'БУ Западно Усть Балыкское' }),
      stubObject({ id: 'owl2/', primaryLocationName: 'Западно-Усть-Балыкское месторождение' }),
      stubObject({ id: 'owl3/', primaryLocationName: 'Балыкское месторождение' })
    ])
    expect(options).toEqual([
      { label: 'Балыкское', count: 1 },
      { label: 'Западно Усть Балыкское', count: 2 }
    ])
  })

  it('keeps a spaced direction as its own location and merges it with the hyphenated spelling', () => {
    const options = buildOeLocationFilterOptions([
      stubObject({ id: 'owl1/', primaryLocationName: 'БУ Западно Мессояхское' }),
      stubObject({ id: 'owl2/', primaryLocationName: 'Западно-Мессояхское месторождение' }),
      stubObject({ id: 'owl3/', primaryLocationName: 'Мессояхское месторождение' })
    ])
    expect(options).toEqual([
      { label: 'Западно Мессояхское', count: 2 },
      { label: 'Мессояхское', count: 1 }
    ])
  })
})

describe('findKnownLocationToken', () => {
  it('matches deposits and clusters from the catalog', () => {
    expect(findKnownLocationToken('участок, покурская залежь')).toBe('покурская залежь')
    expect(findKnownLocationToken('БУ Ванкорский кластер')).toBe('Ванкорский кластер')
  })

  it('keeps words between a direction and a catalog name', () => {
    expect(findKnownLocationToken('Западно Усть Медвежье месторождение')).toBe(
      'Западно Усть Медвежье'
    )
  })

  it('keeps a direction written with a space or a hyphen before the catalog name', () => {
    expect(findKnownLocationToken('Западно Медвежье месторождение')).toBe('Западно Медвежье')
    expect(findKnownLocationToken('Восточно-Чайво')).toBe('Восточно-Чайво')
    expect(findKnownLocationToken('Северо Комсомольская группа')).toBe('Северо Комсомольская группа')
    expect(findKnownLocationToken('Западно-Мессояхская группа')).toBe('Западно-Мессояхская группа')
  })
})

describe('extractLocationFilterTokens', () => {
  it('prefers «-ое» tokens over reference', () => {
    expect(extractLocationFilterTokens('Покровское, покурская залежь')).toEqual(['Покровское'])
  })
})

describe('isUndeterminedMonitoringLocation', () => {
  it('treats missing or unrecognized labels as undetermined', () => {
    expect(isUndeterminedMonitoringLocation(stubObject())).toBe(true)
    expect(isUndeterminedMonitoringLocation(stubObject({ primaryLocationName: 'КРС-3' }))).toBe(true)
    expect(
      isUndeterminedMonitoringLocation(stubObject({ primaryLocationName: 'БУ Покровское' }))
    ).toBe(false)
  })
})

describe('objectMatchesOeLocationFilter', () => {
  const object = stubObject({ primaryLocationName: 'БУ Покровское' })
  const hyphenObject = stubObject({ primaryLocationName: 'БУ Покров-ское' })

  it('matches selected word', () => {
    expect(objectMatchesOeLocationFilter(object, 'Покровское')).toBe(true)
    expect(objectMatchesOeLocationFilter(object, 'покровское')).toBe(true)
  })

  it('matches across hyphen spelling', () => {
    expect(objectMatchesOeLocationFilter(hyphenObject, 'Покровское')).toBe(true)
    expect(objectMatchesOeLocationFilter(object, 'Покров-ское')).toBe(true)
  })

  it('matches a direction with words between it against the hyphenated field name', () => {
    const spaced = stubObject({ primaryLocationName: 'БУ Западно Усть Балыкское' })
    const hyphenated = stubObject({ primaryLocationName: 'Западно-Усть-Балыкское месторождение' })
    expect(objectMatchesOeLocationFilter(spaced, 'Западно-Усть-Балыкское')).toBe(true)
    expect(objectMatchesOeLocationFilter(hyphenated, 'Западно Усть Балыкское')).toBe(true)
    expect(objectMatchesOeLocationFilter(spaced, 'Балыкское')).toBe(false)
  })

  it('matches a spaced direction against the hyphenated field name', () => {
    const spaced = stubObject({ primaryLocationName: 'БУ Западно Мессояхское' })
    const hyphenated = stubObject({ primaryLocationName: 'Западно-Мессояхское месторождение' })
    expect(objectMatchesOeLocationFilter(spaced, 'Западно-Мессояхское')).toBe(true)
    expect(objectMatchesOeLocationFilter(hyphenated, 'Западно Мессояхское')).toBe(true)
    expect(objectMatchesOeLocationFilter(spaced, 'Мессояхское')).toBe(false)
  })

  it('passes through when filter is cleared', () => {
    expect(objectMatchesOeLocationFilter(object, null)).toBe(true)
  })

  it('filters undetermined locations', () => {
    const undetermined = stubObject({ primaryLocationName: 'КРС-3' })
    expect(objectMatchesOeLocationFilter(undetermined, MONITORING_UNDETERMINED_LOCATION_FILTER)).toBe(
      true
    )
    expect(objectMatchesOeLocationFilter(object, MONITORING_UNDETERMINED_LOCATION_FILTER)).toBe(false)
  })
})
