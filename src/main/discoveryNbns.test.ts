import { describe, expect, it } from 'vitest'
import { parseNbnsStatus } from './discoveryNbns'

const DESKTOP_STATUS = Buffer.from(
  '81948400000000010000000020434b4141414141414141414141414141414141414141414141414141414141410000210001000000000065034445534b544f502d343750564e51472004004445534b544f502d343750564e5147000400574f524b47524f5550202020202020008400a46b40c7721f00000000000000000000000000000000000000000000000000000000000000000000000000000000',
  'hex'
)

describe('parseNbnsStatus', () => {
  it('reads the workstation name and skips the workgroup', () => {
    expect(parseNbnsStatus(DESKTOP_STATUS)).toBe('DESKTOP-47PVNQG')
  })

  it('reads a cp866 workstation name', () => {
    const packet = Buffer.alloc(64)
    packet.writeUInt16BE(0x8194, 0)
    packet.writeUInt16BE(0x8400, 2)
    packet.writeUInt16BE(1, 6)
    packet.writeUInt16BE(0x0021, 13)
    packet.writeUInt16BE(0x0001, 15)
    packet.writeUInt16BE(19, 21)
    packet[23] = 1
    packet.fill(0x20, 24, 39)
    Buffer.from([0x8a, 0x80, 0x91, 0x91, 0x80]).copy(packet, 24)
    expect(parseNbnsStatus(packet)).toBe('КАССА')
  })

  it('ignores a query packet', () => {
    const query = Buffer.from(DESKTOP_STATUS)
    query.writeUInt16BE(0, 2)
    expect(parseNbnsStatus(query)).toBeNull()
  })
})
