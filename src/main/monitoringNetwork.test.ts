import { describe, expect, it } from 'vitest'
import {
  parseGatewaysFromIpRoute,
  parseGatewaysFromNetstat,
  parseGatewaysFromWindowsRoute
} from './monitoringNetwork'

describe('parseGatewaysFromNetstat', () => {
  it('extracts IPv4 gateways and skips link# entries', () => {
    const stdout = `
Routing tables

Internet:
Destination        Gateway            Flags           Netif Expire
default            10.12.34.1         UGScg             en0
10.12.34/24        link#11            UCS               en0
10.8.0/24          10.8.0.1           UGSc            utun4
`
    expect(parseGatewaysFromNetstat(stdout).sort()).toEqual(['10.12.34.1', '10.8.0.1'])
  })
})

describe('parseGatewaysFromWindowsRoute', () => {
  it('reads gateway column from route print rows', () => {
    const stdout = `
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0       10.12.34.1      10.12.34.50     25
         10.8.0.0    255.255.255.0         10.8.0.1         10.8.0.2     30
`
    expect(parseGatewaysFromWindowsRoute(stdout).sort()).toEqual(['10.12.34.1', '10.8.0.1'])
  })
})

describe('parseGatewaysFromIpRoute', () => {
  it('parses via gateways', () => {
    const stdout = `
default via 10.12.34.1 dev eth0 proto dhcp
10.8.0.0/24 via 10.8.0.1 dev tun0
`
    expect(parseGatewaysFromIpRoute(stdout).sort()).toEqual(['10.12.34.1', '10.8.0.1'])
  })
})
