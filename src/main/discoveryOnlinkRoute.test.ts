import { describe, expect, it } from 'vitest'
import {
  createExtraRouteSession,
  extraRoutesToInstall,
  ifacesThatAreUp,
  interfacesForExtraRoutes,
  starterCommand,
  windowsRouteScript
} from './discoveryOnlinkRoute'

const ethernet = { name: 'Ethernet', address: '192.168.10.236', netmask: '255.255.255.0' }

describe('temporary on-link routes', () => {
  it('adds 192.168.0.0/24 and 192.168.1.0/24 when the NIC is elsewhere', () => {
    expect(extraRoutesToInstall([ethernet])).toEqual([
      { iface: 'Ethernet', cidr: '192.168.0.0/24' },
      { iface: 'Ethernet', cidr: '192.168.1.0/24' },
      { iface: 'Ethernet', cidr: '192.168.3.152/32' }
    ])
  })

  it('skips a prefix the NIC already covers', () => {
    const ifaces = [{ name: 'Ethernet', address: '192.168.0.20', netmask: '255.255.255.0' }]
    expect(extraRoutesToInstall(ifaces)).toEqual([
      { iface: 'Ethernet', cidr: '192.168.1.0/24' },
      { iface: 'Ethernet', cidr: '192.168.3.152/32' }
    ])
  })

  it('adds a host route for 192.168.3.152 until the NIC is in that subnet', () => {
    const there = [{ name: 'Ethernet', address: '192.168.3.20', netmask: '255.255.255.0' }]
    expect(extraRoutesToInstall(there).some((route) => route.cidr === '192.168.3.152/32')).toBe(false)
    expect(extraRoutesToInstall(there).map((route) => route.cidr)).toEqual(['192.168.0.0/24', '192.168.1.0/24'])
  })

  it('adds nothing when a wide mask already contains both prefixes', () => {
    const ifaces = [{ name: 'Ethernet', address: '192.168.0.20', netmask: '255.255.0.0' }]
    expect(extraRoutesToInstall(ifaces)).toEqual([])
  })

  it('prefers the wired NIC and skips virtual adapters', () => {
    const ifaces = [
      { name: 'vEthernet (WSL)', address: '172.22.0.1', netmask: '255.255.240.0' },
      { name: 'Wi-Fi', address: '10.0.0.8', netmask: '255.255.255.0' },
      ethernet
    ]
    expect(interfacesForExtraRoutes(ifaces).map((iface) => iface.name)).toEqual(['Ethernet'])
    expect(extraRoutesToInstall(ifaces).every((route) => route.iface === 'Ethernet')).toBe(true)
  })

  it('keeps only adapters that are link-up', () => {
    const wifi = { name: 'Wi-Fi', address: '10.0.0.8', netmask: '255.255.255.0' }
    expect(ifacesThatAreUp([ethernet, wifi], ['Wi-Fi']).map((iface) => iface.name)).toEqual(['Wi-Fi'])
    expect(ifacesThatAreUp([ethernet], ['Неизвестный']).map((iface) => iface.name)).toEqual(['Ethernet'])
  })

  it('uses Wi-Fi when it is the only real NIC', () => {
    const wifi = { name: 'Беспроводная сеть', address: '10.0.0.8', netmask: '255.255.255.0' }
    expect(interfacesForExtraRoutes([wifi]).map((iface) => iface.name)).toEqual(['Беспроводная сеть'])
  })

  it('builds an elevated on-link route script', () => {
    const script = windowsRouteScript(
      [{ iface: "Ethernet'", cidr: '192.168.0.0/24' }],
      42,
      'C:\\ready.txt',
      'C:\\stop',
      'C:\\done.txt'
    )
    expect(script).toContain("$parent = 42")
    expect(script).toContain("Prefix = '192.168.0.0/24'")
    expect(script).toContain("Alias = 'Ethernet'''")
    expect(script).toContain('New-NetRoute')
    expect(script).toContain('-RouteMetric 9000')
    expect(script).toContain('Remove-NetRoute -Confirm:$false')
    const starter = starterCommand('C:\\Users\\A B\\routes.ps1')
    expect(starter).toContain("$psi.Verb = 'RunAs'")
    expect(starter).toContain('-File "C:\\Users\\A B\\routes.ps1"')
  })

  it('installs the wanted routes once and removes them when the scan stops', async () => {
    const applied: string[][] = []
    const session = createExtraRouteSession(async (routes) => {
      applied.push(routes.map((route) => route.cidr))
    })
    await session.sync([ethernet])
    await session.sync([ethernet])
    expect(applied).toEqual([['192.168.0.0/24', '192.168.1.0/24', '192.168.3.152/32']])
    expect(session.has()).toBe(true)
    await session.clear()
    expect(applied[1]).toEqual([])
    expect(session.has()).toBe(false)
  })

  it('does not remove routes when install fails', async () => {
    const applied: number[] = []
    const session = createExtraRouteSession(async (routes) => {
      applied.push(routes.length)
      if (routes.length) throw new Error('access denied')
    })
    await expect(session.sync([ethernet])).rejects.toThrow('access denied')
    await session.clear()
    expect(applied).toEqual([3])
    expect(session.has()).toBe(false)
  })
})
