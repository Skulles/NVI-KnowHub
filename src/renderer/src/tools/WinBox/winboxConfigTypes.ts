export type ConfigDeviceFlow = 'lte-ipsec' | 'groovea'

export type WirelessStack = 'legacy' | 'wifi' | 'w60g'

export type GrooveaRole = 'ap' | 'station1' | 'station2'

export type GrooveaWirelessProtocol = 'nv2' | '802.11'

export type GrooveaWirelessBand = '2.4 ГГц' | '5 ГГц'

export interface LanAddress {
  ip: string
  net: string
}
