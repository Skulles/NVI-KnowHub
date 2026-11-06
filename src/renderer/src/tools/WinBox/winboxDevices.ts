import ltapMiniLteKitImage from '../../assets/devices/mikrotik-ltap-mini-lte-kit.png'
import groovea52AcImage from '../../assets/devices/mikrotik-groovea-52-ac.png'
import metal52AcImage from '../../assets/devices/mikrotik-metal-52-ac.png'
import mantboxAxImage from '../../assets/devices/mikrotik-mANTBox-ax.png'
import wirelessWireNrayImage from '../../assets/devices/mikrotik-Wireless-Wire-nRAY.png'
import type { ConfigDeviceFlow, WirelessStack } from './winboxConfigTypes'

export const MIKROTIK_CONFIG_DEVICES = [
  {
    id: 'ltap-mini-lte-kit',
    label: 'LtAP mini',
    image: ltapMiniLteKitImage,
    flow: 'lte-ipsec' as const,
    nameSlug: '',
    wirelessStack: 'legacy' as const,
    disabled: false,
  },
  {
    id: 'groovea-52-ac',
    label: 'GrooveA 52 ac',
    image: groovea52AcImage,
    flow: 'groovea' as const,
    nameSlug: 'GrooveA52',
    wirelessStack: 'legacy' as const,
    disabled: false,
  },
  {
    id: 'metal-52-ac',
    label: 'Metal 52 ac',
    image: metal52AcImage,
    flow: 'groovea' as const,
    nameSlug: 'Metal52',
    wirelessStack: 'legacy' as const,
    disabled: false,
  },
  {
    id: 'mantbox-ax-15s',
    label: 'mANTBox ax 15s',
    image: mantboxAxImage,
    flow: 'groovea' as const,
    nameSlug: 'mANTBoxAx15s',
    wirelessStack: 'wifi' as const,
    disabled: false,
  },
  {
    id: 'wireless-wire-nray',
    label: 'Wireless Wire nRAY',
    image: wirelessWireNrayImage,
    flow: 'groovea' as const,
    nameSlug: 'nRAY',
    wirelessStack: 'w60g' as const,
    disabled: false,
  },
] as const

export function getDeviceFlow(deviceId: string): ConfigDeviceFlow {
  return MIKROTIK_CONFIG_DEVICES.find((d) => d.id === deviceId)?.flow ?? 'lte-ipsec'
}

export function getDeviceNameSlug(deviceId: string): string {
  return MIKROTIK_CONFIG_DEVICES.find((d) => d.id === deviceId)?.nameSlug ?? ''
}

export function getDeviceWirelessStack(deviceId: string): WirelessStack {
  return MIKROTIK_CONFIG_DEVICES.find((d) => d.id === deviceId)?.wirelessStack ?? 'legacy'
}

export function preloadDeviceImages(): void {
  for (const device of MIKROTIK_CONFIG_DEVICES) {
    const img = new Image()
    img.src = device.image
  }
}
