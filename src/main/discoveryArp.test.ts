import { describe, expect, it } from 'vitest'
import { parseArpingReply, parseSendArpLines } from './discoveryArp'

describe('ARP probe parsers', () => {
  it('parses SendARP ip-mac lines', () => {
    const found = parseSendArpLines('192.168.3.152 02:07:B0:3F:EA:D1\n192.168.3.1\n')
    expect(found.get('192.168.3.152')).toBe('02:07:B0:3F:EA:D1')
    expect(found.has('192.168.3.1')).toBe(false)
  })

  it('parses arping unicast replies', () => {
    const found = parseArpingReply(
      'Unicast reply from 192.168.3.152 [02:07:B0:3F:EA:D1]  0.700ms\n'
    )
    expect(found.get('192.168.3.152')).toBe('02:07:B0:3F:EA:D1')
  })
})
