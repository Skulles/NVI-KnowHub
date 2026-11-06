import { describe, expect, it } from 'vitest'
import { isPlaceholderDiscoveryBoard } from './discoveryBoard'

describe('isPlaceholderDiscoveryBoard', () => {
  it('recognizes the UPnP camera class in any wrapping', () => {
    expect(isPlaceholderDiscoveryBoard('DigitalSecurityCamera')).toBe(true)
    expect(isPlaceholderDiscoveryBoard('Digital Security Camera')).toBe(true)
    expect(isPlaceholderDiscoveryBoard('urn:schemas-upnp-org:device:DigitalSecurityCamera:1')).toBe(true)
    expect(isPlaceholderDiscoveryBoard('TR-D2251WDIR4W')).toBe(false)
    expect(isPlaceholderDiscoveryBoard('hAP ac2')).toBe(false)
  })
})
