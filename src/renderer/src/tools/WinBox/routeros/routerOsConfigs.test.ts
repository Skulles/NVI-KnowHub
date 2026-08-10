import { describe, expect, it } from 'vitest'
import {
  CONFIG_FOOTER_NOTE,
  buildConfigHeader,
  buildOwlDeviceName,
  buildPreviewConfig,
} from './lteIpsecConfig'
import { buildConfigDownloadContent } from './routerOsShared'
import {
  buildGrooveaAllConfigs,
  buildGrooveaConfigHeader,
  buildGrooveaDeviceName,
  buildGrooveaSaveTxt,
  getLinkRoles,
} from './wirelessLinkConfig'
import type { WirelessStack } from '../winboxConfigTypes'

describe('RouterOS config golden outputs', () => {
  it('preserves the LtAP script, download framing, and filename', () => {
    const lanAddress = { ip: '10.12.34.1', net: '10.12.34.0' }
    const commands = buildPreviewConfig({
      lanAddress,
      wifiEnabled: true,
      wifiSsid: 'OWL "field"',
      wifiPassword: 'back\\slash',
      wifiHidden: true,
      primaryScript: [
        '/ip ipsec profile add name=owl-profile',
        '/ip ipsec peer add name=owl-peer profile=owl-profile',
        '/ip ipsec proposal add name=owl-proposal',
        '/ip ipsec policy add peer=owl-peer proposal=owl-proposal',
        '/ip firewall filter add chain=input action=accept src-address-list=lan-moscow comment="legacy"',
        '/ip firewall filter add chain=input action=accept protocol=udp dst-port=4500,500 place-before=2',
        '/ip firewall filter add chain=forward action=drop',
      ].join('\n'),
      newPassword: 'AdminPass',
      deviceName: buildOwlDeviceName('1234'),
    })
    const header = buildConfigHeader('1234', lanAddress, 'AdminPass', {
      ssid: 'OWL "field"',
      password: 'back\\slash',
    })

    expect({
      fileName: `${buildOwlDeviceName('1234')}-config.txt`,
      content: buildConfigDownloadContent(header, commands, CONFIG_FOOTER_NOTE),
    }).toMatchInlineSnapshot(`
      {
        "content": "OWLGUARD ID: 1234
      IP адрес Mikrotik роутера: 10.12.34.1/24
      Логин: admin
      Пароль: AdminPass
      WiFi SSID: OWL "field"
      WiFi пароль: back\\slash

      ========================================

      /ip firewall filter remove [find]
      /ip firewall nat remove [find]
      /ip firewall mangle remove [find]
      /ip firewall raw remove [find]
      /ip firewall address-list remove [find]
      /ip ipsec active-peers remove [find]
      /ip ipsec installed-sa remove [find]
      /ip ipsec policy remove [find where proposal=owl-proposal]
      /ip ipsec policy remove [find where !default]
      /ip ipsec identity remove [find]
      /ip ipsec peer remove [find where name=owl-peer]
      /ip ipsec peer remove [find]
      /ip ipsec proposal remove [find where name=owl-proposal]
      /ip ipsec proposal remove [find where name!=default]
      /ip ipsec profile remove [find where name=owl-profile]
      /ip ipsec profile remove [find where name!=default]
      /ip ipsec mode-config remove [find where name!=default]
      /ip dhcp-server remove [find]
      /ip dhcp-server network remove [find]
      /ip dhcp-client remove [find interface!=lte1]
      /ip address remove [find]
      /ip route remove [find where !dynamic]
      /ip dns static remove [find]
      /ip pool remove [find]
      /interface list member remove [find]
      /interface list remove [find]
      /tool mac-server set allowed-interface-list=all
      /tool mac-server mac-winbox set allowed-interface-list=all
      /ip neighbor discovery-settings set discover-interface-list=all
      /ip service set winbox address=""
      /ip service set ssh address=""

      /interface bridge add name=bridge-lan
      /interface bridge port add bridge=bridge-lan interface=ether1
      /interface bridge port add bridge=bridge-lan interface=wlan1
      /interface wireless security-profiles add name=ltap-wifi mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key="back\\\\slash"
      /interface wireless set [find default-name=wlan1] disabled=no mode=ap-bridge band=2ghz-b/g/n ssid="OWL \\"field\\"" security-profile=ltap-wifi hide-ssid=yes
      /ip address add address=10.12.34.1/24 network=10.12.34.0 interface=bridge-lan

      /ip firewall nat add chain=srcnat out-interface=lte1 action=masquerade

      /ip ipsec profile add name=owl-profile
      /ip ipsec peer add name=owl-peer profile=owl-profile
      /ip ipsec proposal add name=owl-proposal
      /ip ipsec policy add peer=owl-peer proposal=owl-proposal

      /interface list add name=LAN
      /interface list member add list=LAN interface=bridge-lan
      /tool mac-server set allowed-interface-list=LAN
      /tool mac-server mac-winbox set allowed-interface-list=LAN
      /ip neighbor discovery-settings set discover-interface-list=LAN
      /ipv6 settings set disable-ipv6=yes
      /ip service set telnet disabled=yes
      /ip service set ftp disabled=yes
      /ip service set www disabled=yes
      /ip service set api disabled=yes
      /ip service set api-ssl disabled=yes
      /ip service set winbox address=10.12.34.0/24,10.33.12.0/24
      /ip service set ssh address=10.12.34.0/24,10.33.12.0/24
      /ip firewall filter add chain=input action=accept connection-state=established,related
      /ip firewall filter add chain=input action=drop connection-state=invalid
      /ip firewall filter add chain=input action=accept src-address-list=lan-moscow
      /ip firewall filter add chain=input action=accept src-address=10.12.34.0/24
      /ip firewall filter add chain=input action=accept protocol=udp dst-port=4500,500
      /ip firewall filter add chain=input action=accept protocol=ipsec-esp
      /ip firewall filter add chain=input action=drop
      /ip firewall filter add chain=forward action=accept connection-state=established,related
      /ip firewall filter add chain=forward action=drop connection-state=invalid

      /system identity set name="OWL1234-LTE"
      /user set admin password=AdminPass
      /log info message="done"

      ========================================

      DHCP отключён. Маску и шлюз на клиентах укажите вручную.",
        "fileName": "OWL1234-LTE-config.txt",
      }
    `)
  })

  it.each([
    ['legacy', 'GrooveA52', ['10.12.34.210', '10.12.34.211', '10.12.34.212']],
    ['wifi', 'mANTBoxAx15s', ['10.12.34.210', '10.12.34.211']],
    ['w60g', 'nRAY', ['10.12.34.210', '10.12.34.211']],
  ] as const)('preserves %s link configs and combined download', (wirelessStack, nameSlug, hosts) => {
    const stack: WirelessStack = wirelessStack
    const configs = buildGrooveaAllConfigs({
      owlDigits: '1234',
      nameSlug,
      ssid: `owl1234-${nameSlug}`,
      hosts: [...hosts],
      net: '10.12.34.0',
      newPassword: 'AdminPass',
      protocol: 'nv2',
      band: '5 ГГц',
      linkKey: 'LinkPass',
      wirelessStack: stack,
    })
    const names = Object.fromEntries(
      getLinkRoles(stack).map((role) => [
        role,
        buildGrooveaDeviceName('1234', role, nameSlug, stack),
      ]),
    )
    const header = buildGrooveaConfigHeader(
      '1234',
      [...hosts],
      'AdminPass',
      'nv2',
      '5 ГГц',
      'LinkPass',
      stack,
    )

    expect({
      fileName: `owl1234-${nameSlug}-config.txt`,
      content: buildGrooveaSaveTxt(header, configs, names, stack),
    }).toMatchSnapshot()
  })
})
