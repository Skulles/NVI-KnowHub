import { describe, expect, it } from 'vitest'
import {
  buildGrooveaAllConfigs,
  buildGrooveaConfigHeader,
  buildGrooveaSaveTxt,
} from './routeros/wirelessLinkConfig'
import {
  appendSavedConfig,
  getSavedConfigHeaderText,
  getSavedConfigPreviewText,
  getSavedConfigRoles,
  parseWinboxConfigSnapshot,
} from './winboxConfigStorage'

describe('legacy WinBox storage compatibility', () => {
  it('normalizes a legacy combined wireless save without localStorage', () => {
    const content = [
      'OWLGUARD ID: 1234',
      'AP: 10.12.34.210/24',
      'Station 1: 10.12.34.211/24',
      'Station 2: 10.12.34.212/24',
      'Логин: admin',
      'Пароль администратора: AdminPass',
      '',
      '================================================',
      '',
      '=== AP: OWL1234-GrooveA52-ap ===',
      '',
      '/interface bridge add name=bridge-lan',
      '',
      '=== Station 1: OWL1234-GrooveA52-station1 ===',
      '',
      '/interface wireless set mode=station',
      '',
      '=== Station 2: OWL1234-GrooveA52-station2 ===',
      '',
      '/interface wireless set mode=station',
    ].join('\n')
    const snapshot = parseWinboxConfigSnapshot({
      configs: [
        {
          id: 'legacy-1',
          owlDigits: '1234',
          deviceId: 'groovea-52-ac',
          deviceLabel: 'GrooveA 52 ac',
          fileName: 'owl1234-GrooveA52-config.txt',
          content,
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    })
    const config = snapshot.configs[0]

    expect(config).toMatchInlineSnapshot(`
      {
        "content": "OWLGUARD ID: 1234
      AP: 10.12.34.210/24
      Station 1: 10.12.34.211/24
      Station 2: 10.12.34.212/24
      Логин: admin
      Пароль администратора: AdminPass

      ================================================

      === AP: OWL1234-GrooveA52-ap ===

      /interface bridge add name=bridge-lan

      === Station 1: OWL1234-GrooveA52-station1 ===

      /interface wireless set mode=station

      === Station 2: OWL1234-GrooveA52-station2 ===

      /interface wireless set mode=station",
        "createdAt": 10,
        "deviceId": "groovea-52-ac",
        "deviceLabel": "GrooveA 52 ac",
        "fileName": "owl1234-GrooveA52-config.txt",
        "flow": "groovea",
        "headerText": "OWLGUARD ID: 1234
      AP: 10.12.34.210/24
      Station 1: 10.12.34.211/24
      Station 2: 10.12.34.212/24
      Логин: admin
      Пароль администратора: AdminPass",
        "id": "legacy-1",
        "owlDigits": "1234",
        "roleConfigs": {
          "ap": "/interface bridge add name=bridge-lan",
          "station1": "/interface wireless set mode=station",
          "station2": "/interface wireless set mode=station",
        },
        "updatedAt": 20,
      }
    `)
    expect(getSavedConfigRoles(config)).toEqual(['ap', 'station1', 'station2'])
    expect(getSavedConfigHeaderText(config)).toBe(
      'OWLGUARD ID: 1234\nЛогин: admin\nПароль: AdminPass',
    )
    expect(getSavedConfigPreviewText(config, 'station1')).toBe(
      '/interface wireless set mode=station',
    )
    expect('localStorage' in globalThis).toBe(false)
  })

  it('keeps only the latest copy when the saved config is unchanged', () => {
    const input = {
      owlDigits: '1234',
      deviceId: 'groovea-52-ac',
      deviceLabel: 'GrooveA 52 ac',
      fileName: 'owl1234-GrooveA52-config.txt',
      content: 'same',
      headerText: 'OWLGUARD ID: 1234',
    }
    const first = appendSavedConfig([], { ...input, id: 'first' })
    const second = appendSavedConfig(first, { ...input, id: 'second' })

    expect(second).toHaveLength(1)
    expect(second[0]?.id).toBe('first')
    expect(second[0]?.content).toBe('same')
    expect(second[0]?.createdAt).toBe(first[0]?.createdAt)
  })

  it('treats a save that differs only by generated passwords as the same config', () => {
    const input = {
      owlDigits: '1234',
      deviceId: 'ltap-mini-lte-kit',
      deviceLabel: 'LtAP mini',
      fileName: 'OWL1234-config.txt',
      flow: 'lte-ipsec' as const,
    }
    const first = appendSavedConfig([], {
      ...input,
      id: 'first',
      headerText: 'OWLGUARD ID: 1234\nПароль: AAA-111\nWiFi пароль: AAA-111',
      previewCommands: '/user set admin password=AAA-111\nwpa2-pre-shared-key="AAA-111"',
      content: 'Пароль: AAA-111\n/user set admin password=AAA-111',
    })
    const second = appendSavedConfig(first, {
      ...input,
      id: 'second',
      headerText: 'OWLGUARD ID: 1234\nПароль: BBB-222\nWiFi пароль: BBB-222',
      previewCommands: '/user set admin password=BBB-222\nwpa2-pre-shared-key="BBB-222"',
      content: 'Пароль: BBB-222\n/user set admin password=BBB-222',
    })

    expect(second).toHaveLength(1)
    expect(second[0]?.id).toBe('first')
    expect(second[0]?.content).toContain('BBB-222')
  })

  it('keeps one GrooveA save when only the generated link key and admin password change', () => {
    const build = (adminPassword: string, linkKey: string) => {
      const hosts = ['10.12.34.210', '10.12.34.211', '10.12.34.212']
      const header = buildGrooveaConfigHeader(
        '1234',
        hosts,
        adminPassword,
        'nv2',
        '5 ГГц',
        linkKey,
        'legacy',
      )
      const roleConfigs = buildGrooveaAllConfigs({
        owlDigits: '1234',
        nameSlug: 'GrooveA52',
        ssid: 'owl1234-GrooveA52',
        hosts,
        net: '10.12.34.0',
        newPassword: adminPassword,
        protocol: 'nv2',
        band: '5 ГГц',
        linkKey,
        wirelessStack: 'legacy',
      })
      return {
        headerText: `OWLGUARD ID: 1234\nЛогин: admin\nПароль: ${adminPassword}`,
        roleConfigs,
        content: buildGrooveaSaveTxt(header, roleConfigs, {
          ap: 'OWL1234-GrooveA52-ap',
          station1: 'OWL1234-GrooveA52-station1',
          station2: 'OWL1234-GrooveA52-station2',
        }),
      }
    }
    const input = {
      owlDigits: '1234',
      deviceId: 'groovea-52-ac',
      deviceLabel: 'GrooveA 52 ac',
      fileName: 'owl1234-GrooveA52-config.txt',
      flow: 'groovea' as const,
    }
    const saved = ['AAA-111', 'BBB-222', 'CCC-333', 'DDD-444'].reduce(
      (configs, secret, index) =>
        appendSavedConfig(configs, {
          ...input,
          ...build(secret, `link-${secret}`),
          id: `save-${index}`,
        }),
      [] as ReturnType<typeof appendSavedConfig>,
    )

    expect(saved).toHaveLength(1)
    expect(saved[0]?.content).toContain('DDD-444')
  })

  it('keeps an earlier save when the same device is saved again', () => {
    const input = {
      owlDigits: '1234',
      deviceId: 'groovea-52-ac',
      deviceLabel: 'GrooveA 52 ac',
      fileName: 'owl1234-GrooveA52-config.txt',
      content: 'first',
    }
    const first = appendSavedConfig([], { ...input, id: 'first' })
    const second = appendSavedConfig(first, { ...input, id: 'second', content: 'second' })

    expect(second.map((config) => config.id)).toEqual(['second', 'first'])
    expect(second.map((config) => config.content)).toEqual(['second', 'first'])
  })

  it('recovers legacy LtAP preview commands and inferred flow', () => {
    const content = [
      'OWLGUARD ID: 5678',
      'Логин: admin',
      'Пароль: Secret',
      '',
      '========================================',
      '',
      '/ip address add address=10.56.78.1/24 network=10.56.78.0 interface=ether1',
      '',
      '========================================',
      '',
      'DHCP отключён. Маску и шлюз на клиентах укажите вручную.',
    ].join('\n')
    const config = parseWinboxConfigSnapshot({
      configs: [
        {
          id: 'legacy-ltap',
          owlDigits: '5678',
          deviceId: 'ltap-mini-lte-kit',
          deviceLabel: 'LtAP mini',
          fileName: 'OWL5678-LTE-config.txt',
          content,
          createdAt: 30,
          updatedAt: 40,
        },
      ],
    }).configs[0]

    expect(config.flow).toBe('lte-ipsec')
    expect(getSavedConfigRoles(config)).toEqual([])
    expect(getSavedConfigPreviewText(config)).toBe(
      '/ip address add address=10.56.78.1/24 network=10.56.78.0 interface=ether1',
    )
  })
})
