import { describe, expect, it } from 'vitest'
import { decodeDiscoveryBytes, decodeDiscoveryDocument, normalizeDiscoveryText } from './discoveryText'

describe('decodeDiscoveryBytes', () => {
  it('keeps utf-8 and ascii', () => {
    expect(decodeDiscoveryBytes(Buffer.from('Роутер 1', 'utf8'))).toBe('Роутер 1')
    expect(decodeDiscoveryBytes(Buffer.from('OfficeGW'))).toBe('OfficeGW')
  })

  it('reads windows-1251 and cp866', () => {
    expect(decodeDiscoveryBytes(Buffer.from([0xca, 0xe0, 0xec, 0xe5, 0xf0, 0xe0]))).toBe('Камера')
    expect(decodeDiscoveryBytes(Buffer.from([0x8a, 0x80, 0x91, 0x91, 0x80]), { prefer: 'cp866' })).toBe('КАССА')
  })

  it('reads utf-16le names', () => {
    expect(decodeDiscoveryBytes(Buffer.from('Камера', 'utf16le'))).toBe('Камера')
  })

  it('honors a declared windows-1251 page', () => {
    const html = Buffer.concat([
      Buffer.from('<meta charset="windows-1251"><title>'),
      Buffer.from([0xca, 0xe0, 0xec, 0xe5, 0xf0, 0xe0]),
      Buffer.from('</title>')
    ])
    expect(decodeDiscoveryDocument(html)).toContain('Камера')
  })
})

describe('normalizeDiscoveryText', () => {
  it('repairs mojibake and leaves real names', () => {
    const mojibake = new TextDecoder('windows-1251').decode(Buffer.from('Камера', 'utf8'))
    expect(normalizeDiscoveryText(mojibake)).toBe('Камера')
    expect(normalizeDiscoveryText('Роутер на складе')).toBe('Роутер на складе')
    expect(normalizeDiscoveryText('OWL1234-Metal52-station1')).toBe('OWL1234-Metal52-station1')
    expect(normalizeDiscoveryText('&#1050;&#1072;&#1084;&#1077;&#1088;&#1072;')).toBe('Камера')
  })
})
