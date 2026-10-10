import { describe, expect, it } from 'vitest'
import {
  buildDahuaSearch,
  ipFromXaddrs,
  isOnvifCameraXml,
  isSsdpBye,
  macFromSsdpText,
  normalizeMacString,
  parseDahuaDiscovery,
  parseOnvifScopes,
  parseSadpMessage,
  parseSsdpResponse,
  parseUpnpDeviceDescription,
  parseWsDiscoveryMessage,
  ssdpMaxAgeSec,
  vendorFromOnvifText
} from './discoveryWs'

const HIKVISION_MATCH = `
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <SOAP-ENV:Body>
    <d:ProbeMatches>
      <d:ProbeMatch>
        <d:Types>dn:NetworkVideoTransmitter tds:Device</d:Types>
        <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/hardware/DS-2CD2143G0-I onvif://www.onvif.org/name/HIKVISION%20Lobby onvif://www.onvif.org/MAC/00:12:34:ab:cd:ef</d:Scopes>
        <d:XAddrs>http://10.12.34.80/onvif/device_service</d:XAddrs>
      </d:ProbeMatch>
    </d:ProbeMatches>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>
`

const PRINTER_MATCH = `
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <wsd:ProbeMatches xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery">
      <wsd:ProbeMatch>
        <wsd:Types>http://schemas.microsoft.com/windows/2006/08/wdp/print/PrintDeviceType</wsd:Types>
        <wsd:XAddrs>http://192.168.10.20:5357/printer</wsd:XAddrs>
      </wsd:ProbeMatch>
    </wsd:ProbeMatches>
  </soap:Body>
</soap:Envelope>
`

describe('parseOnvifScopes', () => {
  it('reads name, hardware and MAC', () => {
    expect(
      parseOnvifScopes(
        'onvif://www.onvif.org/hardware/IPC-HFW2431S onvif://www.onvif.org/name/Dahua%20Gate onvif://www.onvif.org/MAC/AABBCCDDEEFF'
      )
    ).toEqual({
      name: 'Dahua Gate',
      hardware: 'IPC-HFW2431S',
      mac: 'AA:BB:CC:DD:EE:FF'
    })
  })

  it('decodes a windows-1251 percent-encoded name', () => {
    expect(parseOnvifScopes('onvif://www.onvif.org/name/%CA%E0%EC%E5%F0%E0').name).toBe('Камера')
    expect(parseOnvifScopes('onvif://www.onvif.org/name/%D0%9A%D0%B0%D0%BC%D0%B5%D1%80%D0%B0').name).toBe('Камера')
  })

  it('ignores a UPnP device class advertised as ONVIF hardware', () => {
    expect(
      parseOnvifScopes(
        'onvif://www.onvif.org/hardware/DigitalSecurityCamera onvif://www.onvif.org/hardware/TR-D2251WDIR4W onvif://www.onvif.org/name/TRASSIR'
      )
    ).toMatchObject({
      name: 'TRASSIR',
      hardware: 'TR-D2251WDIR4W'
    })
  })
})

describe('vendorFromOnvifText', () => {
  it('recognizes common camera vendors', () => {
    expect(vendorFromOnvifText('HIKVISION Lobby', 'DS-2CD2143G0-I')).toBe('Hikvision')
    expect(vendorFromOnvifText(null, 'IPC-HFW2431S')).toBe('Dahua')
    expect(vendorFromOnvifText('cam-gate', 'TR-D2251WDIR4W')).toBe('Trassir')
    expect(vendorFromOnvifText('cam-1', null)).toBe('ONVIF')
  })
})

describe('parseWsDiscoveryMessage', () => {
  it('maps an ONVIF ProbeMatch to the cameras group', () => {
    expect(parseWsDiscoveryMessage(HIKVISION_MATCH, '192.168.10.1')).toEqual([
      {
        ip: '10.12.34.80',
        mac: '00:12:34:AB:CD:EF',
        name: 'HIKVISION Lobby',
        board: 'DS-2CD2143G0-I',
        vendor: 'Hikvision',
        kind: 'cameras'
      }
    ])
  })

  it('uses the UDP source IP when XAddrs has no IPv4 host', () => {
    const xml = HIKVISION_MATCH.replace(
      'http://10.12.34.80/onvif/device_service',
      'http://camera.local/onvif/device_service'
    )
    expect(parseWsDiscoveryMessage(xml, '10.12.34.81')[0]?.ip).toBe('10.12.34.81')
  })

  it('ignores Windows printer WS-Discovery', () => {
    expect(isOnvifCameraXml(PRINTER_MATCH)).toBe(false)
    expect(parseWsDiscoveryMessage(PRINTER_MATCH, '192.168.10.20')).toEqual([])
  })
})

describe('parseSadpMessage', () => {
  it('reads IP, MAC and board from a Hikvision inquiry reply', () => {
    const xml = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<ProbeMatch><Uuid>u</Uuid><Types>inquiry</Types>' +
        '<DeviceDescription>DS-2CD2143G0-I</DeviceDescription>' +
        '<MAC>c0-56-e3-fe-42-92</MAC>' +
        '<IPv4Address>10.12.34.80</IPv4Address></ProbeMatch>'
    )
    expect(parseSadpMessage(xml, '192.168.10.1')).toEqual([
      {
        ip: '10.12.34.80',
        mac: 'C0:56:E3:FE:42:92',
        name: 'DS-2CD2143G0-I',
        board: 'DS-2CD2143G0-I',
        vendor: 'Hikvision',
        kind: 'cameras'
      }
    ])
  })
})

describe('buildDahuaSearch', () => {
  it('uses the ConfigTool / IPC Manager header Trassir waits for', () => {
    const packet = buildDahuaSearch()
    expect(packet[0]).toBe(0xa3)
    expect(packet.readUInt32LE(4)).toBe(packet.length - 32)
    expect(packet.subarray(32).toString('utf8')).toBe(
      '{"method":"DHDiscover.search","params":{"mac":"","uni":1}}'
    )
  })
})

describe('parseDahuaDiscovery', () => {
  it('ignores the search probe echo', () => {
    expect(parseDahuaDiscovery(buildDahuaSearch(), '10.12.34.90')).toEqual([])
  })

  it('labels a TR-D notify as Trassir', () => {
    const json = {
      mac: '00:18:ae:12:34:56',
      method: 'client.notifyDevInfo',
      params: {
        deviceInfo: {
          DeviceClass: 'IPC',
          DeviceType: 'TR-D2251WDIR4W',
          MachineName: 'cam-gate',
          Vendor: 'General',
          IPv4Address: { IPAddress: '10.12.34.90' }
        }
      }
    }
    const packet = Buffer.concat([buildDahuaSearch().subarray(0, 32), Buffer.from(JSON.stringify(json))])
    expect(parseDahuaDiscovery(packet, '169.254.16.1')[0]).toMatchObject({
      ip: '10.12.34.90',
      vendor: 'Trassir',
      board: 'TR-D2251WDIR4W',
      kind: 'cameras'
    })
  })

  it('reads a windows-1251 machine name', () => {
    const packet = Buffer.concat([
      Buffer.from('{"method":"client.notifyDevInfo","params":{"deviceInfo":{"MachineName":"'),
      Buffer.from([0xca, 0xe0, 0xec, 0xe5, 0xf0, 0xe0]),
      Buffer.from('","DeviceType":"IPC-HDW","IPv4Address":{"IPAddress":"10.0.0.5"}}}}')
    ])
    expect(parseDahuaDiscovery(packet, '10.0.0.5')[0]?.name).toBe('Камера')
  })

  it('reads deviceInfo from a DHIP notify on another subnet', () => {
    const json = {
      mac: '4c:11:bf:c2:0b:9d',
      method: 'client.notifyDevInfo',
      params: {
        deviceInfo: {
          DeviceClass: 'IPC',
          DeviceType: 'IPC-HDW5421S',
          MachineName: 'cam-gate',
          Vendor: 'Dahua',
          IPv4Address: { IPAddress: '10.12.34.90' }
        }
      }
    }
    const packet = Buffer.concat([buildDahuaSearch().subarray(0, 32), Buffer.from(JSON.stringify(json))])
    const devices = parseDahuaDiscovery(packet, '169.254.16.1')
    expect(devices[0]).toMatchObject({
      ip: '10.12.34.90',
      mac: '4C:11:BF:C2:0B:9D',
      name: 'cam-gate',
      board: 'IPC-HDW5421S',
      vendor: 'Dahua',
      kind: 'cameras'
    })
  })
})

describe('parseSsdpResponse', () => {
  it('maps a Trassir UPnP reply to the cameras group', () => {
    const packet = Buffer.from(
      'HTTP/1.1 200 OK\r\n' +
        'LOCATION: http://10.12.34.91:80/upnpdevicedesc.xml\r\n' +
        'SERVER: Linux/3.0 UPnP/1.0 IpCamera/1.0 TRASSIR\r\n' +
        'ST: upnp:rootdevice\r\n\r\n'
    )
    expect(parseSsdpResponse(packet, '169.254.16.1')[0]).toMatchObject({
      ip: '10.12.34.91',
      vendor: 'Trassir',
      kind: 'cameras'
    })
  })

  it('maps a factory-default Trassir NOTIFY on another subnet', () => {
    const packet = Buffer.from(
      'NOTIFY * HTTP/1.1\r\n' +
        'HOST: 239.255.255.250:1900\r\n' +
        'LOCATION: http://192.168.1.188:49152/ipcam.xml\r\n' +
        'NT: urn:schemas-upnp-org:device:DigitalSecurityCamera:1\r\n' +
        'NTS: ssdp:alive\r\n' +
        'SERVER: Linux/5.10.61, UPnP/1.0, Portable SDK for UPnP devices/1.14.0\r\n' +
        'USN: uuid:8f368a51-c830-4c45-aa87-f023b9841535::urn:schemas-upnp-org:device:DigitalSecurityCamera:1\r\n\r\n'
    )
    expect(parseSsdpResponse(packet, '169.254.16.236')[0]).toMatchObject({
      ip: '192.168.1.188',
      mac: '',
      name: 'TRASSIR',
      board: null,
      vendor: 'Trassir',
      kind: 'cameras'
    })
  })

  it('detects byebye and max-age', () => {
    const bye = Buffer.from(
      'NOTIFY * HTTP/1.1\r\nNTS: ssdp:byebye\r\nLOCATION: http://192.168.1.188:49152/ipcam.xml\r\nNT: urn:schemas-upnp-org:device:DigitalSecurityCamera:1\r\n\r\n'
    )
    expect(isSsdpBye(bye)).toBe(true)
    expect(parseSsdpResponse(bye, '169.254.16.1')[0]?.ip).toBe('192.168.1.188')
    expect(ssdpMaxAgeSec(Buffer.from('CACHE-CONTROL: max-age=150\r\n'))).toBe(150)
  })

  it('reads MAC when UPnP puts it in the advertisement', () => {
    const packet = Buffer.from(
      'NOTIFY * HTTP/1.1\r\n' +
        'LOCATION: http://10.12.34.90:80/ipcam.xml\r\n' +
        'NT: urn:schemas-upnp-org:device:DigitalSecurityCamera:1\r\n' +
        'MAC: 00-18-ae-12-34-56\r\n\r\n'
    )
    expect(parseSsdpResponse(packet, '169.254.16.1')[0]?.mac).toBe('00:18:AE:12:34:56')
  })
})

describe('parseUpnpDeviceDescription', () => {
  it('reads model, name and MAC from a DigitalSecurityCamera description', () => {
    const xml = `
      <root><device>
        <friendlyName>Gate</friendlyName>
        <manufacturer>TRASSIR</manufacturer>
        <modelName>TR-D2251WDIR4W</modelName>
        <serialNumber>0018AE123456</serialNumber>
      </device></root>
    `
    expect(parseUpnpDeviceDescription(xml)).toEqual({
      name: 'Gate',
      board: 'TR-D2251WDIR4W',
      mac: '00:18:AE:12:34:56',
      vendor: 'Trassir'
    })
  })

  it('skips a UPnP device class in modelName and keeps the model number', () => {
    const xml = `
      <root><device>
        <deviceType>urn:schemas-upnp-org:device:DigitalSecurityCamera:1</deviceType>
        <modelName>DigitalSecurityCamera</modelName>
        <modelNumber>TR-D2251WDIR4W</modelNumber>
      </device></root>
    `
    expect(parseUpnpDeviceDescription(xml).board).toBe('TR-D2251WDIR4W')
  })
})

describe('macFromSsdpText', () => {
  it('takes the node from a version-1 UUID', () => {
    expect(macFromSsdpText('', 'uuid:0018ae12-3456-11ed-8000-0018ae123456')).toBe('00:18:AE:12:34:56')
  })

  it('does not treat a random UUID as a MAC', () => {
    expect(macFromSsdpText('', 'uuid:8f368a51-c830-4c45-aa87-f023b9841535')).toBe('')
  })
})

describe('ipFromXaddrs / normalizeMacString', () => {
  it('takes the first IPv4 from XAddrs', () => {
    expect(ipFromXaddrs('http://[fe80::1]/onvif http://10.1.2.3:8080/onvif/device_service', '1.1.1.1')).toBe(
      '10.1.2.3'
    )
  })

  it('formats 12 hex digits', () => {
    expect(normalizeMacString('00-12-34-ab-cd-ef')).toBe('00:12:34:AB:CD:EF')
  })

  it('pads short arp octets', () => {
    expect(normalizeMacString('d4:d:ab:51:65:ac')).toBe('D4:0D:AB:51:65:AC')
  })
})
