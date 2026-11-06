import { describe, expect, it } from 'vitest'
import { readPingProbe } from './monitoringPing'

const MAC_UNREACHABLE = `PING 10.12.1.1 (10.12.1.1): 56 data bytes
92 bytes from 192.168.1.1: Destination Host Unreachable
Vr HL TOS  Len   ID Flg  off TTL Pro  cks      Src      Dst
 4  5  00 5400 0000   0 0000  40  01 0000 192.168.1.1  10.12.1.1

--- 10.12.1.1 ping statistics ---
3 packets transmitted, 0 packets received, 100.0% packet loss
`

const MAC_ONLINE = `PING 10.12.1.1 (10.12.1.1): 56 data bytes
64 bytes from 10.12.1.1: icmp_seq=0 ttl=64 time=42.5 ms
64 bytes from 10.12.1.1: icmp_seq=1 ttl=64 time=40.0 ms

--- 10.12.1.1 ping statistics ---
3 packets transmitted, 2 packets received, 33.3% packet loss
round-trip min/avg/max/stddev = 40.000/41.250/42.500/1.250 ms
`

describe('readPingProbe', () => {
  it('does not treat a gateway unreachable notice as the link being up', () => {
    expect(readPingProbe(MAC_UNREACHABLE)).toEqual({
      online: false,
      latencyMs: null,
      replyCount: 0
    })
  })

  it('reads echo replies and average latency', () => {
    expect(readPingProbe(MAC_ONLINE)).toEqual({
      online: true,
      latencyMs: 41.25,
      replyCount: 2
    })
  })

  it('counts a Windows echo and ignores host unreachable', () => {
    expect(
      readPingProbe('Ответ от 10.12.1.1: число байт=32 время=12мс TTL=128\n')
    ).toMatchObject({ online: true, replyCount: 1 })
    expect(readPingProbe('Ответ от 192.168.1.1: Заданный узел недоступен.\n')).toEqual({
      online: false,
      latencyMs: null,
      replyCount: 0
    })
  })
})
