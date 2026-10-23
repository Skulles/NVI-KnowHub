import { describe, expect, it } from 'vitest'
import {
  collectExtraCidrTargets,
  collectOfflinkExtraTargets,
  collectOnlinkPingTargets,
  collectPingTargets,
  hostsInCidr,
  listRepkaFieldGrid,
  netmaskToPrefix,
  parseCidr,
  scanPrefixForAddress
} from './discoveryOnlink'
import {
  dedupeDiscoveryDevices,
  isRepkaMac,
  otherFromAlive,
  repkaFromAlive,
  repkaFromNeighbor
} from './discoveryFingerprint'

describe('on-link scan ranges', () => {
  it('expands 192.168.3.0/24 to 254 hosts', () => {
    expect(parseCidr('192.168.3.0/24')?.prefix).toBe(24)
    const hosts = hostsInCidr('192.168.3.0/24', new Set(['192.168.3.123']))
    expect(hosts).toHaveLength(253)
    expect(hosts).toContain('192.168.3.152')
    expect(hosts).not.toContain('192.168.3.0')
    expect(hosts).not.toContain('192.168.3.255')
    expect(hosts).not.toContain('192.168.3.123')
  })

  it('reads a /24 netmask and keeps it', () => {
    expect(netmaskToPrefix('255.255.255.0')).toBe(24)
    expect(scanPrefixForAddress('10.64.11.76', '255.255.254.0')).toBe(23)
  })

  it('does not widen a /16 into 65k pings', () => {
    expect(scanPrefixForAddress('10.64.11.76', '255.255.0.0')).toBe(22)
  })

  it('does not ICMP-ping 192.168.3.0/24 when it is off-link', () => {
    const ifaces = [{ name: 'en0', address: '192.168.10.236', netmask: '255.255.255.0' }]
    const onlink = collectOnlinkPingTargets(ifaces)
    expect(onlink).toContain('192.168.10.1')
    expect(onlink).not.toContain('192.168.3.152')
    expect(collectOfflinkExtraTargets(ifaces)).toContain('192.168.3.152')
    expect(collectOfflinkExtraTargets(ifaces)).not.toContain('192.168.3.1')
    expect(collectExtraCidrTargets(ifaces)).toContain('192.168.3.152')
    expect(collectExtraCidrTargets(ifaces)).not.toContain('192.168.3.1')
    expect(collectPingTargets(ifaces)).toContain('192.168.3.152')
  })

  it('ICMP-pings 192.168.0.0/24 and 192.168.1.0/24 when the NIC is elsewhere', () => {
    const ifaces = [{ name: 'en0', address: '192.168.10.236', netmask: '255.255.255.0' }]
    const extra = collectExtraCidrTargets(ifaces)
    expect(extra).toHaveLength(254 * 2 + 1)
    expect(extra).toContain('192.168.3.152')
    expect(extra).toContain('192.168.0.1')
    expect(extra).toContain('192.168.1.254')
    expect(extra).not.toContain('192.168.0.0')
    expect(extra).not.toContain('192.168.1.255')
    expect(extra).not.toContain('192.168.10.1')
    expect(collectPingTargets(ifaces)).toContain('192.168.0.10')
    expect(collectPingTargets(ifaces)).toContain('192.168.1.10')
  })

  it('does not repeat 192.168.0.0/24 when the NIC is already there', () => {
    const ifaces = [{ name: 'en0', address: '192.168.0.20', netmask: '255.255.255.0' }]
    const extra = collectExtraCidrTargets(ifaces)
    expect(extra.some((ip) => ip.startsWith('192.168.0.'))).toBe(false)
    expect(extra).toContain('192.168.1.1')
    expect(extra).toContain('192.168.3.152')
    expect(extra).toHaveLength(255)
  })

  it('does not treat 192.168.3.152 as off-link when the NIC is already there', () => {
    expect(
      collectOfflinkExtraTargets([{ name: 'en4', address: '192.168.3.123', netmask: '255.255.255.0' }])
    ).not.toContain('192.168.3.152')
    expect(
      collectExtraCidrTargets([{ name: 'en4', address: '192.168.3.123', netmask: '255.255.255.0' }])
    ).not.toContain('192.168.3.152')
  })

  it('builds 10.{64-80}.{0-99}.{40-50}', () => {
    const grid = listRepkaFieldGrid()
    expect(grid).toHaveLength(17 * 100 * 11)
    expect(grid).toContain('10.64.0.40')
    expect(grid).toContain('10.80.99.50')
    expect(grid).not.toContain('10.63.0.40')
    expect(grid).not.toContain('10.64.0.39')
    expect(grid).not.toContain('10.81.0.40')
    expect(grid).not.toContain('10.64.100.40')
  })

  it('adds the field grid only on a full extra scan', () => {
    const ifaces = [{ name: 'en4', address: '192.168.65.123', netmask: '255.255.255.0' }]
    expect(collectOfflinkExtraTargets(ifaces)).toEqual(['192.168.3.152'])
    const full = collectOfflinkExtraTargets(ifaces, { includeGrid: true })
    expect(full).toContain('192.168.3.152')
    expect(full).toContain('10.70.12.45')
    expect(full).toHaveLength(1 + 17 * 100 * 11)
  })
})

describe('Repka fingerprint', () => {
  it('matches the Repka ethernet MAC prefix', () => {
    expect(isRepkaMac('02:07:b0:3f:ea:d1')).toBe(true)
    expect(isRepkaMac('40:fd:f3:22:98:ea')).toBe(false)
    expect(repkaFromNeighbor('192.168.3.152', '02:07:b0:3f:ea:d1')?.kind).toBe('repka')
  })

  it('classifies only ARP hits with the Repka prefix', () => {
    const devices = repkaFromAlive(
      ['192.168.3.152', '192.168.3.1'],
      new Map([
        ['192.168.3.152', '02:07:B0:3F:EA:D1'],
        ['192.168.3.1', 'D4:0D:AB:51:65:AC']
      ])
    )
    expect(devices).toEqual([
      {
        ip: '192.168.3.152',
        mac: '02:07:B0:3F:EA:D1',
        name: null,
        board: null,
        vendor: 'Repka Pi',
        kind: 'repka'
      }
    ])
  })
})

describe('L3 hosts in the other table', () => {
  const neighbors = new Map([
    ['192.168.10.1', 'D4:0D:AB:51:65:AC'],
    ['192.168.10.20', '48:8F:5A:01:02:03'],
    ['192.168.10.50', '02:07:B0:3F:EA:D1'],
    ['192.168.10.51', '02:07:b0:11:22:33']
  ])

  it('keeps every local ICMP answer that did not announce on L2', () => {
    const devices = otherFromAlive(['192.168.10.1', '192.168.10.20', '192.168.10.50', '192.168.10.77'], neighbors, {
      ips: new Set(['192.168.10.20']),
      macs: new Set(['48:8f:5a:01:02:03'])
    })
    expect(devices.map((device) => device.ip)).toEqual(['192.168.10.1', '192.168.10.50', '192.168.10.77'])
    expect(devices.every((device) => device.kind === 'other')).toBe(true)
    expect(devices[1]).toMatchObject({ vendor: 'Repka Pi', mac: '02:07:B0:3F:EA:D1' })
    expect(devices[2]).toMatchObject({ mac: '', vendor: '' })
  })

  it('collapses the same MAC and prefers an L2 announcement over L3', () => {
    const devices = dedupeDiscoveryDevices([
      {
        ip: '192.168.10.1',
        mac: 'D4:0D:AB:51:65:AC',
        name: null,
        board: null,
        vendor: '',
        kind: 'other'
      },
      {
        ip: '192.168.10.20',
        mac: '48:8F:5A:01:02:03',
        name: 'bridge',
        board: 'hAP ac2',
        vendor: 'MikroTik',
        kind: 'mikrotik'
      },
      {
        ip: '192.168.10.20',
        mac: '48:8F:5A:01:02:03',
        name: null,
        board: null,
        vendor: '',
        kind: 'other'
      },
      {
        ip: '192.168.10.21',
        mac: '48:8F:5A:01:02:03',
        name: null,
        board: null,
        vendor: '',
        kind: 'other'
      }
    ])
    expect(devices.map((device) => `${device.kind}:${device.ip}`)).toEqual([
      'mikrotik:192.168.10.20',
      'other:192.168.10.1'
    ])
  })

  it('keeps every device that shares an IP when the MACs differ', () => {
    const devices = dedupeDiscoveryDevices([
      {
        ip: '192.168.10.20',
        mac: '48:8F:5A:01:02:03',
        name: 'bridge',
        board: 'hAP ac2',
        vendor: 'MikroTik',
        kind: 'mikrotik'
      },
      {
        ip: '192.168.10.20',
        mac: 'AA:BB:CC:DD:EE:01',
        name: 'cam-a',
        board: null,
        vendor: 'Hikvision',
        kind: 'cameras'
      },
      {
        ip: '192.168.10.20',
        mac: 'AA:BB:CC:DD:EE:02',
        name: 'cam-b',
        board: null,
        vendor: 'Hikvision',
        kind: 'cameras'
      },
      {
        ip: '192.168.10.20',
        mac: '',
        name: null,
        board: null,
        vendor: '',
        kind: 'other'
      }
    ])
    expect(devices.map((device) => `${device.kind}:${device.mac}`)).toEqual([
      'mikrotik:48:8F:5A:01:02:03',
      'cameras:AA:BB:CC:DD:EE:01',
      'cameras:AA:BB:CC:DD:EE:02'
    ])
  })
})
