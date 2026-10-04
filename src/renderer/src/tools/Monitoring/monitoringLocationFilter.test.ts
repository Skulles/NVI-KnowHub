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
})

describe('findKnownLocationToken', () => {
  it('matches deposits and clusters from the catalog', () => {
    expect(findKnownLocationToken('участок, покурская залежь')).toBe('покурская залежь')
    expect(findKnownLocationToken('БУ Ванкорский кластер')).toBe('Ванкорский кластер')
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
