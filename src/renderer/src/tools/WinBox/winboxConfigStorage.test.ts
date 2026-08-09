import { describe, expect, it } from 'vitest'
import {
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
