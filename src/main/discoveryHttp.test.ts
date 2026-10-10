import { describe, expect, it } from 'vitest'
import { httpDeviceTitle, httpRefreshPath } from './discoveryHttp'
import { decodeDiscoveryDocument } from './discoveryText'

const CUDY_ROOT =
  '<meta http-equiv="refresh" content="0; URL=cgi-bin/luci/" />'

const CUDY_LOGIN = '<html><head><title>WR1300S</title></head><body></body></html>'

describe('http device title', () => {
  it('reads the model from the login page', () => {
    expect(httpDeviceTitle(CUDY_LOGIN)).toBe('WR1300S')
  })

  it('follows the Cudy refresh to the login page', () => {
    expect(httpRefreshPath(CUDY_ROOT)).toBe('/cgi-bin/luci/')
  })

  it('reads a windows-1251 title and repairs utf-8 mojibake', () => {
    const html = Buffer.concat([
      Buffer.from('<html><head><title>'),
      Buffer.from([0xca, 0xe0, 0xec, 0xe5, 0xf0, 0xe0]),
      Buffer.from('</title></head></html>')
    ])
    expect(httpDeviceTitle(decodeDiscoveryDocument(html))).toBe('Камера')

    const mojibake = new TextDecoder('windows-1251').decode(Buffer.from('Камера', 'utf8'))
    expect(httpDeviceTitle(`<title>${mojibake}</title>`)).toBe('Камера')
  })

  it('skips a generic title and an off-box refresh', () => {
    expect(httpDeviceTitle('<title>Login</title>')).toBeNull()
    expect(httpRefreshPath('<meta http-equiv="refresh" content="0; URL=https://example.com/a" />')).toBeNull()
  })
})
