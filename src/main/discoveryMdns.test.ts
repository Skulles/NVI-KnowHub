import { describe, expect, it } from 'vitest'
import { parseMdnsMessage } from './discoveryMdns'

function dnsName(name: string): Buffer {
  const chunks = name.split('.').filter(Boolean).flatMap((label) => {
    const bytes = Buffer.from(label)
    return [Buffer.from([bytes.length]), bytes]
  })
  return Buffer.concat([...chunks, Buffer.from([0])])
}

describe('parseMdnsMessage', () => {
  it('reads a Trassir Bonjour A record', () => {
    const header = Buffer.alloc(12)
    header.writeUInt16BE(1, 6)
    const name = dnsName('TR-D2251.local')
    const rr = Buffer.alloc(14)
    rr.writeUInt16BE(1, 0)
    rr.writeUInt16BE(1, 2)
    rr.writeUInt32BE(120, 4)
    rr.writeUInt16BE(4, 8)
    rr[10] = 10
    rr[11] = 12
    rr[12] = 34
    rr[13] = 80
    expect(parseMdnsMessage(Buffer.concat([header, name, rr]), '169.254.16.1')[0]).toMatchObject({
      ip: '10.12.34.80',
      vendor: 'Trassir',
      kind: 'cameras'
    })
  })

  it('ignores a laptop advertising only _http._tcp', () => {
    const header = Buffer.alloc(12)
    header.writeUInt16BE(1, 6)
    const name = dnsName('MacBook._http._tcp.local')
    const rr = Buffer.alloc(14)
    rr.writeUInt16BE(1, 0)
    rr.writeUInt16BE(1, 2)
    rr.writeUInt32BE(120, 4)
    rr.writeUInt16BE(4, 8)
    rr[10] = 192
    rr[11] = 168
    rr[12] = 10
    rr[13] = 20
    expect(parseMdnsMessage(Buffer.concat([header, name, rr]), '192.168.10.1')).toEqual([])
  })
})
