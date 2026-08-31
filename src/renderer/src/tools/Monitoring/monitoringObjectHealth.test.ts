import { describe, expect, it } from 'vitest'
import {
  groupHealthByObjectKind,
  resolveMonitoringObjectHealth,
  resolveObjectHealthFromProbes
} from './monitoringObjectHealth'
import { DEFAULT_OBJECT_KIND, type MonitoringObject } from './monitoringStorage'

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

describe('resolveMonitoringObjectHealth', () => {
  it('marks missing link as offline', () => {
    expect(resolveMonitoringObjectHealth({ linkOnline: false, serverOnline: false })).toBe('offline')
  })

  it('marks reachable object without issues as online', () => {
    expect(
      resolveMonitoringObjectHealth({
        linkOnline: true,
        serverOnline: true,
        camerasOnline: 4,
        camerasTotal: 4,
        megaphonesOnline: 1,
        megaphonesTotal: 1,
        sensorsStatus: 'ok'
      })
    ).toBe('online')
  })

  it('marks partial cameras as problems', () => {
    expect(
      resolveMonitoringObjectHealth({
        linkOnline: true,
        serverOnline: true,
        camerasOnline: 2,
        camerasTotal: 4
      })
    ).toBe('problems')
  })

  it('does not mark online until cameras, megaphones and sensors are known', () => {
    expect(
      resolveMonitoringObjectHealth({
        linkOnline: true,
        serverOnline: true
      })
    ).toBeNull()
    expect(
      resolveMonitoringObjectHealth({
        linkOnline: true,
        serverOnline: true,
        camerasOnline: 4,
        camerasTotal: 4,
        megaphonesOnline: 1,
        megaphonesTotal: 1,
        sensorsStatus: 'unknown'
      })
    ).toBeNull()
  })

  it('does not mark online while the server ping is still pending', () => {
    expect(resolveMonitoringObjectHealth({ linkOnline: true })).toBeNull()
  })

  it('marks high CPU load as problems', () => {
    expect(
      resolveMonitoringObjectHealth({
        linkOnline: true,
        serverOnline: true,
        cpuLoad: 91
      })
    ).toBe('problems')
  })

  it('marks high GPU temperature as problems', () => {
    expect(
      resolveMonitoringObjectHealth({
        linkOnline: true,
        serverOnline: true,
        gpuTempC: 76
      })
    ).toBe('problems')
  })

  it('marks server down as problems when link is up', () => {
    expect(resolveMonitoringObjectHealth({ linkOnline: true, serverOnline: false })).toBe('problems')
  })

  it('marks OWL.Guard version error as problems when link is up', () => {
    expect(
      resolveMonitoringObjectHealth({
        linkOnline: true,
        serverOnline: true,
        serverVersionError: 'неверный пароль'
      })
    ).toBe('problems')
  })
})

describe('resolveObjectHealthFromProbes', () => {
  it('reads link and server ping results', () => {
    expect(
      resolveObjectHealthFromProbes(object(), {
        'owl1201/:link': { id: 'l', host: '1', label: '', status: 'offline', latencyMs: null, checkedAt: 0 }
      })
    ).toBe('offline')
  })
})

describe('groupHealthByObjectKind', () => {
  it('keeps drilling and tkrs groups and skips empty kinds', () => {
    const groups = groupHealthByObjectKind(
      [
        object({ id: 'a', objectKind: 'drilling' }),
        object({ id: 'b', objectKind: 'drilling' }),
        object({ id: 'c', objectKind: 'tkrs' })
      ],
      { a: 'online', b: 'problems', c: 'offline' }
    )

    expect(groups).toEqual([
      { kind: 'drilling', label: 'Буровые', counts: { online: 1, problems: 1, offline: 0, total: 2 } },
      { kind: 'tkrs', label: 'ТКРС', counts: { online: 0, problems: 0, offline: 1, total: 1 } }
    ])
  })

  it('keeps unclassified objects in the kind total without a status bucket', () => {
    const groups = groupHealthByObjectKind(
      [object({ id: 'a', objectKind: 'drilling' }), object({ id: 'b', objectKind: 'drilling' })],
      { a: 'offline', b: null }
    )

    expect(groups).toEqual([
      { kind: 'drilling', label: 'Буровые', counts: { online: 0, problems: 0, offline: 1, total: 2 } }
    ])
  })
})
