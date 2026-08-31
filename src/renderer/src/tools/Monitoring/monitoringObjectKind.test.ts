import { describe, expect, it } from 'vitest'
import type { MonitoringGuardDevice } from '@shared/api'
import {
  applyResolvedObjectKind,
  inferMonitoringObjectKind,
  resolveMonitoringObjectKind
} from './monitoringObjectKind'
import { DEFAULT_OBJECT_KIND, type MonitoringObject } from './monitoringStorage'

function mockDevice(id: number, type: string): MonitoringGuardDevice {
  return {
    id,
    type,
    address: null,
    logicalAddress: 0,
    useRtuOverTcp: false,
    startRegister: 0,
    numRegisters: 64,
    login: '',
    password: '',
    wellUid: '',
    wellBoreUid: ''
  }
}

function object(overrides: Partial<MonitoringObject> = {}): MonitoringObject {
  return {
    id: 'owl1201/',
    code: 'owl1201/',
    objectKind: DEFAULT_OBJECT_KIND,
    linkHost: '10.12.1.1',
    serverHost: '10.12.1.252',
    serverLogin: 'Operator',
    serverPassword: '',
    ...overrides
  }
}

describe('inferMonitoringObjectKind', () => {
  it('classifies a typical TKRS site', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          camerasTotal: 4,
          cameraStreams: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
          megaphonesTotal: 1,
          megaphones: [{ id: 1, locationIds: [] }],
          guardDevices: [mockDevice(1, 'ive50')],
          primaryLocationName: 'КРС-3'
        })
      )
    ).toBe('tkrs')
  })

  it('classifies a typical drilling site', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          camerasTotal: 12,
          cameraStreams: Array.from({ length: 12 }, (_, index) => ({ id: index + 1 })),
          megaphonesTotal: 3,
          megaphones: [
            { id: 1, locationIds: [] },
            { id: 2, locationIds: [] },
            { id: 3, locationIds: [] }
          ],
          guardDevices: [mockDevice(1, 'wits')],
          primaryLocationName: 'БУ-12'
        })
      )
    ).toBe('drilling')
  })

  it('stays auto when name and equipment contradict', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          camerasTotal: 3,
          cameraStreams: [{ id: 1 }, { id: 2 }, { id: 3 }],
          megaphonesTotal: 1,
          megaphones: [{ id: 1, locationIds: [] }],
          guardDevices: [mockDevice(1, 'ive50')],
          primaryLocationName: 'БУ-15'
        })
      )
    ).toBe('auto')
  })

  it('stays auto when OWL.Guard cache is missing', () => {
    expect(inferMonitoringObjectKind(object())).toBe('auto')
  })

  it('does not treat ТКРС as КРС substring', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          primaryLocationName: 'ТКРС-1'
        })
      )
    ).toBe('tkrs')
  })

  it('does not treat the word Бурение as БУ', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          primaryLocationName: 'Бурение'
        })
      )
    ).toBe('auto')
  })

  it('treats БУ15 as a drilling name token', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          primaryLocationName: 'БУ15'
        })
      )
    ).toBe('drilling')
  })

  it('treats Буровая as a drilling name token', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          primaryLocationName: 'Буровая 12'
        })
      )
    ).toBe('drilling')
  })

  it('does not treat a generic name without БУ as TKRS', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          primaryLocationName: 'Объект Север'
        })
      )
    ).toBe('auto')
  })

  it('treats WITSML as a drilling sensor sign', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          camerasTotal: 8,
          cameraStreams: Array.from({ length: 8 }, (_, index) => ({ id: index + 1 })),
          guardDevices: [mockDevice(1, 'witsml')]
        })
      )
    ).toBe('drilling')
  })

  it('counts empty loaded sensor list as not-WITS', () => {
    expect(
      inferMonitoringObjectKind(
        object({
          camerasTotal: 2,
          cameraStreams: [{ id: 1 }, { id: 2 }],
          megaphones: [],
          megaphonesTotal: 0,
          guardDevices: []
        })
      )
    ).toBe('tkrs')
  })
})

describe('resolveMonitoringObjectKind', () => {
  it('keeps a manual drilling kind', () => {
    expect(
      resolveMonitoringObjectKind(
        object({
          objectKind: 'drilling',
          camerasTotal: 2,
          cameraStreams: [{ id: 1 }, { id: 2 }],
          megaphones: [{ id: 1, locationIds: [] }],
          guardDevices: []
        })
      )
    ).toBe('drilling')
  })

  it('infers when kind is auto', () => {
    expect(
      resolveMonitoringObjectKind(
        object({
          objectKind: 'auto',
          camerasTotal: 2,
          cameraStreams: [{ id: 1 }, { id: 2 }],
          megaphones: [{ id: 1, locationIds: [] }],
          guardDevices: []
        })
      )
    ).toBe('tkrs')
  })
})

describe('applyResolvedObjectKind', () => {
  it('writes the inferred kind onto an auto object', () => {
    const next = applyResolvedObjectKind(
      object({
        cameraStreams: [{ id: 1 }, { id: 2 }],
        megaphones: [],
        guardDevices: []
      })
    )
    expect(next.objectKind).toBe('tkrs')
  })

  it('returns the same object when kind does not change', () => {
    const current = object({ objectKind: 'tkrs' })
    expect(applyResolvedObjectKind(current)).toBe(current)
  })
})
