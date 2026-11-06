import { describe, expect, it } from 'vitest'
import { applyNeighborMacs, parseNeighborTable } from './discoveryNeighbors'

describe('parseNeighborTable', () => {
  it('reads macOS arp -an lines including short octets', () => {
    const table = parseNeighborTable(
      '? (192.168.10.1) at d4:d:ab:51:65:ac on en0 ifscope [ethernet]\n' +
        '? (10.12.34.211) at 48:8f:5a:1:2:3 on en4 ifscope [ethernet]\n' +
        '? (192.168.10.255) at ff:ff:ff:ff:ff:ff on en0 [ethernet]\n'
    )
    expect(table.get('192.168.10.1')).toBe('D4:0D:AB:51:65:AC')
    expect(table.get('10.12.34.211')).toBe('48:8F:5A:01:02:03')
    expect(table.has('192.168.10.255')).toBe(false)
  })

  it('reads Linux ip neigh lines', () => {
    const table = parseNeighborTable(
      '192.168.10.1 dev eth0 lladdr d4:0d:ab:51:65:ac REACHABLE\n'
    )
    expect(table.get('192.168.10.1')).toBe('D4:0D:AB:51:65:AC')
  })
})

describe('applyNeighborMacs', () => {
  it('fills empty MAC from the neighbor table', () => {
    const devices = applyNeighborMacs(
      [{ ip: '192.168.1.188', mac: '', name: 'TRASSIR', board: null, vendor: 'Trassir', kind: 'cameras' }],
      new Map([['192.168.1.188', 'AA:BB:CC:DD:EE:FF']])
    )
    expect(devices[0]?.mac).toBe('AA:BB:CC:DD:EE:FF')
  })

  it('uses the MAC of the host that sent the reply when the announced IP is absent', () => {
    const devices = applyNeighborMacs(
      [{ ip: '10.1.1.50', mac: '', name: 'TRASSIR', board: null, vendor: 'Trassir', kind: 'cameras' }],
      new Map([['192.168.10.15', '22:DD:3D:74:2D:40']]),
      new Map([['10.1.1.50', '192.168.10.15']])
    )
    expect(devices[0]?.mac).toBe('22:DD:3D:74:2D:40')
  })
})
