import { describe, expect, it } from 'vitest'
import {
  createExtraRouteSession,
  extraRoutesToInstall,
  ifacesThatAreUp,
  interfacesForExtraRoutes,
  launchVbsScript,
  registerTaskScript,
  ROUTE_TASK_NAME,
  routeHelperScript,
  starterCommand
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

  it('asks for administrator rights only while saving the scheduled task', () => {
    const helper = routeHelperScript()
    expect(helper).toContain('job.json')
    expect(helper).toContain('New-NetRoute')
    expect(helper).toContain('$metric = 9000')
    expect(helper).toContain('-RouteMetric $metric')
    expect(helper).toContain('Remove-NetRoute -Confirm:$false')
    const register = registerTaskScript('C:\\Users\\A B\\launch.vbs', 'C:\\Users\\A B\\result.txt')
    expect(register).toContain(`-TaskName '${ROUTE_TASK_NAME}'`)
    expect(register).toContain('-RunLevel Highest')
    expect(register).toContain("-Execute 'wscript.exe'")
    expect(register).toContain("$launch = 'C:\\Users\\A B\\launch.vbs'")
    expect(launchVbsScript()).toContain('helper.ps1')
    expect(launchVbsScript()).toContain('Run cmd, 0, False')
    const starter = starterCommand('C:\\Users\\A B\\register.ps1')
    expect(starter).toContain("$psi.Verb = 'RunAs'")
    expect(starter).toContain('-File "C:\\Users\\A B\\register.ps1"')
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
