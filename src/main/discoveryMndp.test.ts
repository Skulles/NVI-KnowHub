import { describe, expect, it } from 'vitest'
import {
  compareIpv4,
  directedBroadcast,
  formatMac,
  isTunnelInterface,
  mergeDiscoveryDevice,
  neighborToDevice,
  parseMndpPacket,
  sortDiscoveryDevices
} from './discoveryMndp'

function tlv(type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header.writeUInt16BE(type, 0)
  header.writeUInt16BE(payload.length, 2)
  return Buffer.concat([header, payload])
}

function packet(...parts: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 1]), ...parts])
}

describe('directedBroadcast', () => {
  it('computes /24 broadcast', () => {
    expect(directedBroadcast('192.168.10.236', '255.255.255.0')).toBe('192.168.10.255')
  })

  it('rejects invalid addresses', () => {
    expect(directedBroadcast('192.168.10.236', 'mask')).toBeNull()
  })
})

describe('isTunnelInterface', () => {
  it('skips VPN and awdl', () => {
    expect(isTunnelInterface('utun4')).toBe(true)
    expect(isTunnelInterface('awdl0')).toBe(true)
    expect(isTunnelInterface('en0')).toBe(false)
  })
})

describe('parseMndpPacket', () => {
  it('reads identity, MAC, IPv4 and board', () => {
    const parsed = parseMndpPacket(
      packet(
        tlv(1, Buffer.from([0x48, 0x8f, 0x5a, 0x01, 0x02, 0x03])),
        tlv(5, Buffer.from('OfficeGW')),
        tlv(8, Buffer.from('MikroTik')),
        tlv(12, Buffer.from('hAP ac2')),
        tlv(17, Buffer.from([10, 12, 34, 50]))
      ),
      '192.168.10.1'
    )

    expect(parsed).toEqual({
      ip: '10.12.34.50',
      mac: '48:8F:5A:01:02:03',
      identity: 'OfficeGW',
      platform: 'MikroTik',
      board: 'hAP ac2',
      version: null
    })
  })

  it('reads a windows-1251 identity and keeps utf-8 cyrillic', () => {
    const cp1251 = parseMndpPacket(
      packet(tlv(5, Buffer.from([0xca, 0xe0, 0xec, 0xe5, 0xf0, 0xe0]))),
      '10.0.0.1'
    )
    expect(cp1251?.identity).toBe('Камера')

    const utf8 = parseMndpPacket(packet(tlv(5, Buffer.from('Роутер', 'utf8'))), '10.0.0.1')
    expect(utf8?.identity).toBe('Роутер')

    const mojibake = new TextDecoder('windows-1251').decode(Buffer.from('Камера', 'utf8'))
    const repaired = parseMndpPacket(packet(tlv(5, Buffer.from(mojibake, 'utf8'))), '10.0.0.1')
    expect(repaired?.identity).toBe('Камера')
  })

  it('falls back to UDP source IP when IPv4 TLV is missing', () => {
    const parsed = parseMndpPacket(
      packet(tlv(5, Buffer.from('core'))),
      '192.168.10.8'
    )
    expect(parsed?.ip).toBe('192.168.10.8')
    expect(parsed?.identity).toBe('core')
  })

  it('reads board from a real RouterOS 7 announcement', () => {
    const packet = Buffer.from(
      '000000450001000604f41cf32030000500184f574c313233342d4d6574616c35322d73746174696f6e3100070023372e31392e362028737461626c652920323032352d30392d31322030393a30323a3432000800084d696b726f54696b000a00049d040000000b00095735444d2d53545950000c001152424d6574616c472d353253485061636e000e000101000f0010fe8000000000000006f41cfffef32030001000116272696467652d6c616e2f657468657231001100040a0c22d3',
      'hex'
    )
    const parsed = parseMndpPacket(packet, '192.168.10.1')
    expect(parsed?.board).toBe('RBMetalG-52SHPacn')
    expect(parsed?.identity).toBe('OWL1234-Metal52-station1')
    expect(parsed?.ip).toBe('10.12.34.211')
    expect(neighborToDevice(parsed!).board).toBe('RBMetalG-52SHPacn')
  })

  it('ignores request echoes and truncated packets', () => {
    expect(parseMndpPacket(Buffer.from([0, 0, 0, 0]), '192.168.10.1')).toBeNull()
    expect(parseMndpPacket(packet(tlv(1, Buffer.from([1, 2, 3]))), '192.168.10.1')).toBeNull()
  })
})

describe('neighborToDevice', () => {
  it('maps a neighbor to the MikroTik group', () => {
    expect(
      neighborToDevice({
        ip: '10.12.34.50',
        mac: '48:8F:5A:01:02:03',
        identity: 'OfficeGW',
        platform: 'MikroTik',
        board: 'hAP ac2',
        version: '7.16'
      })
    ).toEqual({
      ip: '10.12.34.50',
      mac: '48:8F:5A:01:02:03',
      name: 'OfficeGW',
      board: 'hAP ac2',
      vendor: 'MikroTik',
      kind: 'mikrotik'
    })
  })
})

describe('sortDiscoveryDevices', () => {
  it('orders by IPv4', () => {
    const sorted = sortDiscoveryDevices([
      { ip: '192.168.10.20', mac: '', name: null, board: null, vendor: 'MikroTik', kind: 'mikrotik' },
      { ip: '192.168.10.2', mac: '', name: null, board: null, vendor: 'MikroTik', kind: 'mikrotik' }
    ])
    expect(sorted.map((device) => device.ip)).toEqual(['192.168.10.2', '192.168.10.20'])
  })
})

describe('mergeDiscoveryDevice', () => {
  it('keeps MAC and fills name from a later reply', () => {
    const merged = mergeDiscoveryDevice(
      { ip: '10.0.0.1', mac: '48:8F:5A:01:02:03', name: null, board: 'hAP ac2', vendor: 'MikroTik', kind: 'mikrotik' },
      { ip: '10.0.0.1', mac: '', name: 'core', board: null, vendor: 'MikroTik', kind: 'mikrotik' }
    )
    expect(merged).toEqual({
      ip: '10.0.0.1',
      mac: '48:8F:5A:01:02:03',
      name: 'core',
      board: 'hAP ac2',
      vendor: 'MikroTik',
      kind: 'mikrotik'
    })
  })

  it('keeps a camera model when a later UPnP type arrives', () => {
    const merged = mergeDiscoveryDevice(
      {
        ip: '192.168.1.188',
        mac: '',
        name: 'Gate',
        board: 'TR-D2251WDIR4W',
        vendor: 'Trassir',
        kind: 'cameras'
      },
      {
        ip: '192.168.1.188',
        mac: '',
        name: 'TRASSIR',
        board: 'DigitalSecurityCamera',
        vendor: 'Trassir',
        kind: 'cameras'
      }
    )
    expect(merged.board).toBe('TR-D2251WDIR4W')
  })

  it('drops a stored UPnP type so the description can fill the model', () => {
    const merged = mergeDiscoveryDevice(
      {
        ip: '192.168.1.188',
        mac: '',
        name: 'TRASSIR',
        board: 'DigitalSecurityCamera',
        vendor: 'Trassir',
        kind: 'cameras'
      },
      {
        ip: '192.168.1.188',
        mac: '',
        name: 'TRASSIR',
        board: null,
        vendor: 'Trassir',
        kind: 'cameras'
      }
    )
    expect(merged.board).toBeNull()
  })
})

describe('formatMac / compareIpv4', () => {
  it('formats six octets', () => {
    expect(formatMac(Buffer.from([0, 12, 66, 255, 1, 2]))).toBe('00:0C:42:FF:01:02')
  })

  it('compares dotted IPv4 numerically', () => {
    expect(compareIpv4('10.0.0.9', '10.0.0.10')).toBeLessThan(0)
  })
})
