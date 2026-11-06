import { describe, expect, it } from 'vitest'
import {
  LAN_ENTER_LATENCY_MS,
  objectMatchesLanSubnet,
  resolveLanActiveObjectId,
  sameSubnet24
} from './monitoringLanScope'

describe('sameSubnet24', () => {
  it('compares first three octets', () => {
    expect(sameSubnet24('10.12.34.252', '10.12.34.1')).toBe(true)
    expect(sameSubnet24('10.12.34.252', '10.12.35.1')).toBe(false)
  })
})

describe('objectMatchesLanSubnet', () => {
  const object = { serverHost: '10.12.34.252', linkHost: '10.12.34.1' }

  it('matches gateway in object subnet', () => {
    expect(
      objectMatchesLanSubnet(object, {
        localAddresses: ['192.168.1.10'],
        gateways: ['10.12.34.1']
      })
    ).toBe(true)
  })

  it('matches local address in object subnet (on-link)', () => {
    expect(
      objectMatchesLanSubnet(object, {
        localAddresses: ['10.12.34.50'],
        gateways: ['192.168.1.1']
      })
    ).toBe(true)
  })

  it('rejects unrelated networks', () => {
    expect(
      objectMatchesLanSubnet(object, {
        localAddresses: ['192.168.1.10'],
        gateways: ['192.168.1.1', '10.8.0.1']
      })
    ).toBe(false)
  })
})

describe('resolveLanActiveObjectId', () => {
  const objects = [
    { id: 'owl1201/', serverHost: '10.12.1.252', linkHost: '10.12.1.1' },
    { id: 'owl1234/', serverHost: '10.12.34.252', linkHost: '10.12.34.1' }
  ]

  it('enters LAN when exactly one object matches subnet + low RTT', () => {
    expect(
      resolveLanActiveObjectId({
        objects,
        hints: { localAddresses: ['10.12.34.50'], gateways: ['10.12.34.1'] },
        serverOnlineByObjectId: { 'owl1201/': true, 'owl1234/': true },
        serverLatencyByObjectId: { 'owl1201/': 40, 'owl1234/': LAN_ENTER_LATENCY_MS - 1 },
        currentLanObjectId: null
      })
    ).toBe('owl1234/')
  })

  it('does not enter when RTT is too high', () => {
    expect(
      resolveLanActiveObjectId({
        objects,
        hints: { localAddresses: ['10.12.34.50'], gateways: ['10.12.34.1'] },
        serverOnlineByObjectId: { 'owl1234/': true },
        serverLatencyByObjectId: { 'owl1234/': 25 },
        currentLanObjectId: null
      })
    ).toBe(null)
  })

  it('keeps LAN with hysteresis below exit threshold', () => {
    expect(
      resolveLanActiveObjectId({
        objects,
        hints: { localAddresses: ['10.12.34.50'], gateways: ['10.12.34.1'] },
        serverOnlineByObjectId: { 'owl1234/': true },
        serverLatencyByObjectId: { 'owl1234/': 15 },
        currentLanObjectId: 'owl1234/'
      })
    ).toBe('owl1234/')
  })

  it('exits LAN when subnet no longer matches', () => {
    expect(
      resolveLanActiveObjectId({
        objects,
        hints: { localAddresses: ['192.168.1.10'], gateways: ['192.168.1.1'] },
        serverOnlineByObjectId: { 'owl1234/': true },
        serverLatencyByObjectId: { 'owl1234/': 3 },
        currentLanObjectId: 'owl1234/'
      })
    ).toBe(null)
  })
})
