import { describe, expect, it } from 'vitest'
import { extraRoutesToInstall, netshRouteArgs, createExtraRouteSession } from './discoveryOnlinkRoute'

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

  it('builds an active on-link netsh route with a high metric', () => {
    expect(netshRouteArgs('add', 'Ethernet', '192.168.0.0/24')).toEqual([
      'interface',
      'ipv4',
      'add',
      'route',
      'prefix=192.168.0.0/24',
      'interface=Ethernet',
      'store=active',
      'metric=9000'
    ])
    expect(netshRouteArgs('delete', 'Ethernet', '192.168.0.0/24')).toEqual([
      'interface',
      'ipv4',
      'delete',
      'route',
      'prefix=192.168.0.0/24',
      'interface=Ethernet',
      'store=active'
    ])
  })

  it('keeps the route for the scan and removes only routes this session added', async () => {
    const commands: string[][] = []
    const session = createExtraRouteSession(async (args) => {
      commands.push(args)
    })
    await session.sync([ethernet])
    await session.sync([ethernet])
    expect(commands.filter((args) => args.includes('add'))).toHaveLength(3)
    await session.clear()
    expect(commands.filter((args) => args.includes('delete'))).toHaveLength(3)
    expect(session.has()).toBe(false)
  })

  it('does not remove a route that netsh refused to add', async () => {
    const commands: string[][] = []
    const session = createExtraRouteSession(async (args) => {
      if (args.includes('add')) throw new Error('access denied')
      commands.push(args)
    })
    await session.sync([ethernet])
    await session.clear()
    expect(commands).toEqual([])
    expect(session.has()).toBe(false)
  })
})
