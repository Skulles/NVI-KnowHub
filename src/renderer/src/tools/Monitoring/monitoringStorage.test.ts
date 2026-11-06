import { describe, expect, it } from 'vitest'
import { resolvePrimaryLocationName } from './monitoringStorage'

describe('resolvePrimaryLocationName', () => {
  it('uses the most referenced parent', () => {
    expect(
      resolvePrimaryLocationName([
        { id: 1, localizedName: 'Месторождение', parentId: null },
        { id: 2, localizedName: 'Лебёдка', parentId: 1 },
        { id: 3, localizedName: 'Насос', parentId: 1 },
        { id: 4, localizedName: 'Кран', parentId: 9 }
      ])
    ).toBe('Месторождение')
  })

  it('uses the smallest id when no location has a parent', () => {
    expect(
      resolvePrimaryLocationName([
        { id: 30, localizedName: 'Насос', parentId: null },
        { id: 12, localizedName: 'Западно Усть Балыкское' },
        { id: 18, localizedName: 'Воронка', parentId: null }
      ])
    ).toBe('Западно Усть Балыкское')
  })
})
