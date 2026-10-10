/**
 * WS-Discovery / ONVIF ProbeMatch helpers for camera discovery.
 */
import { randomUUID } from 'crypto'
import http from 'http'
import https from 'https'
import type { DiscoveryDevice } from '../shared/api'
import { isIPv4, isPlaceholderBoard } from './discoveryMndp'
import { decodeDiscoveryBytes, decodeDiscoveryDocument, normalizeDiscoveryText } from './discoveryText'

export const WS_DISCOVERY_PORT = 3702
export const WS_DISCOVERY_ADDR = '239.255.255.250'

export const SADP_PORT = 37020
export const SADP_ADDR = '239.255.255.250'
export const DAHUA_DISCOVERY_PORT = 37810
export const DAHUA_DISCOVERY_ADDR = '239.255.255.251'
export const DVRIP_DISCOVERY_PORT = 5050
export const SSDP_PORT = 1900
export const SSDP_ADDR = '239.255.255.250'

const DAHUA_SEARCH_JSON = '{"method":"DHDiscover.search","params":{"mac":"","uni":1}}'

const VENDOR_HINTS: Array<[RegExp, string]> = [
  [/trassir|activecam|\bdssl\b|\btr-d|\bac-d|\bac-e/i, 'Trassir'],
  [/hikvision|hiwatch|ezviz|ds-2c[dpt]/i, 'Hikvision'],
  [/dahua|dh-ipc|ipc-hfw|ipc-hdw|ipc-hum/i, 'Dahua'],
  [/uniview|\bunv\b|ipc[_-]?g[xl]/i, 'Uniview'],
  [/\baxis\b/i, 'Axis'],
  [/tiandy/i, 'Tiandy'],
  [/hanwha|wisenet/i, 'Hanwha'],
  [/\bbosch\b/i, 'Bosch'],
  [/reolink/i, 'Reolink'],
  [/amcrest/i, 'Amcrest'],
  [/foscam/i, 'Foscam'],
  [/milesight/i, 'Milesight'],
  [/sunell/i, 'Sunell'],
  [/tvt|provision-isr/i, 'TVT'],
  [/tp-?link|tapo/i, 'TP-Link']
]

function xmlText(xml: string, localName: string): string | null {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`,
    'i'
  )
  const match = xml.match(pattern)
  return match ? match[1].trim() : null
}

function percentEncodedBytes(value: string): Buffer | null {
  if (!/%[0-9a-f]{2}/i.test(value)) return null
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index]
    if (ch === '%' && index + 2 < value.length && /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16))
      index += 2
      continue
    }
    const code = value.charCodeAt(index)
    if (code > 0x7f) return null
    bytes.push(code)
  }
  return Buffer.from(bytes)
}

function decodeValue(value: string): string {
  const encoded = percentEncodedBytes(value)
  const text = encoded ? decodeDiscoveryBytes(encoded) : value
  return normalizeDiscoveryText(text)
}

function deviceLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const text = normalizeDiscoveryText(value)
  return text || null
}

export function ipFromXaddrs(xaddrs: string, fallbackIp: string): string | null {
  const urls = xaddrs.split(/\s+/).filter(Boolean)
  for (const url of urls) {
    const fromUrl = url.match(/https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})/i)
    if (fromUrl && isIPv4(fromUrl[1])) return fromUrl[1]
  }
  return isIPv4(fallbackIp) ? fallbackIp : null
}

export function normalizeMacString(value: string): string {
  const parts = value.trim().split(/[:.-]/)
  if (parts.length === 6 && parts.every((part) => /^[0-9a-f]{1,2}$/i.test(part))) {
    return parts.map((part) => part.padStart(2, '0').toUpperCase()).join(':')
  }
  const hex = value.replace(/[^0-9a-f]/gi, '')
  if (hex.length !== 12) return ''
  return hex
    .toUpperCase()
    .match(/.{2}/g)
    ?.join(':') ?? ''
}

export function parseOnvifScopes(scopes: string): {
  name: string | null
  hardware: string | null
  mac: string
} {
  let name: string | null = null
  let hardware: string | null = null
  let mac = ''

  for (const part of scopes.split(/\s+/)) {
    const nameMatch = part.match(/onvif:\/\/www\.onvif\.org\/name\/(.+)/i)
    if (nameMatch) name = decodeValue(nameMatch[1])
    const hardwareMatch = part.match(/onvif:\/\/www\.onvif\.org\/hardware\/(.+)/i)
    if (hardwareMatch) {
      const next = decodeValue(hardwareMatch[1])
      if (!isPlaceholderBoard(next)) hardware = next
    }
    const macMatch = part.match(/onvif:\/\/www\.onvif\.org\/mac\/(.+)/i)
    if (macMatch) mac = normalizeMacString(decodeValue(macMatch[1]))
  }

  return { name, hardware, mac }
}

export function vendorFromOnvifText(name: string | null, hardware: string | null): string {
  const text = `${name ?? ''} ${hardware ?? ''}`
  for (const [pattern, vendor] of VENDOR_HINTS) {
    if (pattern.test(text)) return vendor
  }
  return 'ONVIF'
}

export function isOnvifCameraXml(xml: string): boolean {
  const blob = `${xmlText(xml, 'Types') ?? ''} ${xmlText(xml, 'Scopes') ?? ''} ${xmlText(xml, 'XAddrs') ?? ''}`.toLowerCase()
  return (
    blob.includes('onvif') ||
    blob.includes('networkvideotransmitter') ||
    blob.includes('video_encoder') ||
    blob.includes('networkvideodisplay')
  )
}

function matchBlocks(xml: string): string[] {
  const blocks = xml.match(
    /<(?:[\w.-]+:)?(?:ProbeMatch|Hello)\b[\s\S]*?<\/(?:[\w.-]+:)?(?:ProbeMatch|Hello)>/gi
  )
  return blocks?.length ? blocks : [xml]
}

export function parseWsDiscoveryMessage(xml: string, sourceIp: string): DiscoveryDevice[] {
  if (!/<(?:[\w.-]+:)?(?:ProbeMatch|Hello|ProbeMatches)\b/i.test(xml)) return []

  const devices: DiscoveryDevice[] = []
  for (const block of matchBlocks(xml)) {
    if (!isOnvifCameraXml(block) && !isOnvifCameraXml(xml)) continue
    const xaddrs = xmlText(block, 'XAddrs') ?? xmlText(xml, 'XAddrs') ?? ''
    const ip = ipFromXaddrs(xaddrs, sourceIp)
    if (!ip) continue

    const scopes = xmlText(block, 'Scopes') ?? xmlText(xml, 'Scopes') ?? ''
    const parsed = parseOnvifScopes(scopes)
    devices.push({
      ip,
      mac: parsed.mac,
      name: parsed.name,
      board: parsed.hardware,
      vendor: vendorFromOnvifText(parsed.name, parsed.hardware),
      kind: 'cameras'
    })
  }
  return devices
}

export function buildWsDiscoveryProbe(messageId = `uuid:${randomUUID()}`): Buffer {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"' +
    ' xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">' +
    '<s:Header>' +
    '<a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>' +
    `<a:MessageID>${messageId}</a:MessageID>` +
    '<a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>' +
    '<a:To s:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>' +
    '</s:Header>' +
    '<s:Body>' +
    '<Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">' +
    '<d:Types xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"' +
    ' xmlns:dp0="http://www.onvif.org/ver10/network/wsdl">dp0:NetworkVideoTransmitter</d:Types>' +
    '</Probe>' +
    '</s:Body>' +
    '</s:Envelope>'
  return Buffer.from(body)
}

export function buildSadpInquiry(uuid = randomUUID()): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry</Types></Probe>`
  )
}

export function parseSadpMessage(packet: Buffer, sourceIp: string): DiscoveryDevice[] {
  const xmlStart = Math.max(packet.indexOf('<?xml'), packet.indexOf('<ProbeMatch'))
  if (xmlStart < 0) return []
  const xml = decodeDiscoveryDocument(packet.subarray(xmlStart))
  if (!/<ProbeMatch\b/i.test(xml)) return []

  const ip = xmlText(xml, 'IPv4Address')
  const address = ip && isIPv4(ip) ? ip : isIPv4(sourceIp) ? sourceIp : null
  if (!address) return []
  const hardware = deviceLabel(xmlText(xml, 'DeviceDescription'))
  const name = hardware ?? deviceLabel(xmlText(xml, 'DeviceSN'))
  return [
    {
      ip: address,
      mac: normalizeMacString(xmlText(xml, 'MAC') ?? ''),
      name,
      board: hardware,
      vendor: vendorFromOnvifText(name, hardware) === 'ONVIF' ? 'Hikvision' : vendorFromOnvifText(name, hardware),
      kind: 'cameras'
    }
  ]
}

function dahuaSearchBody(): Buffer {
  return Buffer.from(DAHUA_SEARCH_JSON)
}

/** ConfigTool / IPC Manager header — Trassir cameras ignore the DHIP form. */
export function buildDahuaSearch(): Buffer {
  const json = dahuaSearchBody()
  const header = Buffer.alloc(32)
  header[0] = 0xa3
  header.writeUInt32LE(json.length, 4)
  return Buffer.concat([header, json])
}

export function buildDahuaSearchDhip(requestId = 1): Buffer {
  const json = dahuaSearchBody()
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0x20, 0)
  header.write('DHIP', 4, 4, 'ascii')
  header.writeUInt32LE(0, 8)
  header.writeUInt32LE(requestId, 12)
  header.writeUInt32LE(json.length, 16)
  header.writeUInt32LE(0, 20)
  header.writeUInt32LE(json.length, 24)
  header.writeUInt32LE(0, 28)
  return Buffer.concat([header, json])
}

export function buildDahuaSearchPing(): Buffer {
  return Buffer.from([0xff])
}

/** Older ConfigTool / DVRIP search used by IPC Manager on UDP 5050. */
export function buildDvripSearch(): Buffer {
  const packet = Buffer.alloc(32)
  packet.writeUInt32BE(0xa3010001, 0)
  packet.writeUInt32BE(0x02000000, 16)
  return packet
}

export function buildSsdpProbe(st = 'ssdp:all'): Buffer {
  return Buffer.from(
    'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      `ST: ${st}\r\n` +
      '\r\n'
  )
}

export function buildSsdpProbes(): Buffer[] {
  return [
    buildSsdpProbe('ssdp:all'),
    buildSsdpProbe('upnp:rootdevice'),
    buildSsdpProbe('urn:schemas-upnp-org:device:Basic:1'),
    buildSsdpProbe('urn:schemas-upnp-org:device:DigitalSecurityCamera:1')
  ]
}

const CAMERA_SSDP =
  /trassir|activecam|\bdssl\b|onvif|networkvideo|ipcamera|ip.?cam|\btr-d|\bipc\b|digitalsecuritycamera/i

export function parseSsdpResponse(packet: Buffer, sourceIp: string): DiscoveryDevice[] {
  const text = decodeDiscoveryDocument(packet)
  if (!/^HTTP\/1\.1\s+200/im.test(text) && !/^NOTIFY/im.test(text)) return []
  const blob = text.toLowerCase()
  if (!CAMERA_SSDP.test(blob)) return []
  if (/printer|internetgatewaydevice|mediarenderer/.test(blob) && !CAMERA_SSDP.test(blob)) {
    return []
  }
  const location = text.match(/^location:\s*(.+)$/im)?.[1]?.trim() ?? ''
  const ip = ipFromXaddrs(location, sourceIp)
  if (!ip) return []
  const server = text.match(/^server:\s*(.+)$/im)?.[1]?.trim() ?? null
  const nt = text.match(/^nt:\s*(.+)$/im)?.[1]?.trim() ?? ''
  const usn = text.match(/^usn:\s*(.+)$/im)?.[1]?.trim() ?? ''
  const vendor = vendorFromOnvifText(server, `${location} ${nt}`)
  const trassirUpnp = /digitalsecuritycamera|ipcam\.xml/i.test(blob)
  return [
    {
      ip,
      mac: macFromSsdpText(text, usn),
      name: trassirUpnp ? 'TRASSIR' : deviceLabel(server),
      board: null,
      vendor: vendor === 'ONVIF' && trassirUpnp ? 'Trassir' : vendor === 'ONVIF' ? 'UPnP' : vendor,
      kind: 'cameras'
    }
  ]
}

export function ssdpLocation(packet: Buffer): string {
  return decodeDiscoveryDocument(packet).match(/^location:\s*(.+)$/im)?.[1]?.trim() ?? ''
}

export function isSsdpBye(packet: Buffer): boolean {
  return /^nts:\s*ssdp:byebye/im.test(decodeDiscoveryDocument(packet))
}

export function ssdpMaxAgeSec(packet: Buffer): number | null {
  const match = decodeDiscoveryDocument(packet).match(/max-age\s*=\s*(\d+)/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

export function parseUpnpDeviceDescription(xml: string): Partial<Pick<DiscoveryDevice, 'name' | 'board' | 'mac' | 'vendor'>> {
  if (!/<device\b/i.test(xml)) return {}
  const model =
    [xmlText(xml, 'modelName'), xmlText(xml, 'modelNumber')]
      .map((value) => deviceLabel(value))
      .find((value) => value && !isPlaceholderBoard(value)) ?? null
  const name = deviceLabel(xmlText(xml, 'friendlyName') ?? xmlText(xml, 'modelDescription'))
  const manufacturer = deviceLabel(xmlText(xml, 'manufacturer'))
  const serial = xmlText(xml, 'serialNumber')
  const mac = normalizeMacString(
    xmlText(xml, 'MACAddress') ?? xmlText(xml, 'macAddress') ?? xmlText(xml, 'MAC') ?? serial ?? ''
  )
  const vendor = vendorFromOnvifText(manufacturer, model)
  return {
    ...(name ? { name } : {}),
    ...(model ? { board: model } : {}),
    ...(mac ? { mac } : {}),
    ...(vendor !== 'ONVIF' ? { vendor } : {})
  }
}

export function macFromSsdpText(text: string, usn = ''): string {
  const header = text.match(/^(?:mac|hwaddr|macaddress|mac-address):\s*([0-9a-f:.-]{11,17})$/im)?.[1]
  if (header) return normalizeMacString(header)
  const inline = text.match(/\b(?:mac|hwaddr)\b[=:\s]+([0-9a-f]{2}(?:[:.-][0-9a-f]{2}){5})\b/i)?.[1]
  if (inline) return normalizeMacString(inline)
  const uuid = `${usn} ${text}`.match(/uuid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
  if (uuid && uuid.charAt(14) === '1') {
    return normalizeMacString(uuid.slice(-12))
  }
  return ''
}

function jsonValueBytes(packet: Buffer, start: number): Buffer {
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < packet.length; index += 1) {
    const byte = packet[index]
    if (inString) {
      if (escape) escape = false
      else if (byte === 0x5c) escape = true
      else if (byte === 0x22) inString = false
      continue
    }
    if (byte === 0x22) inString = true
    else if (byte === 0x7b) depth += 1
    else if (byte === 0x7d) {
      depth -= 1
      if (depth === 0) return packet.subarray(start, index + 1)
    }
  }
  return packet.subarray(start)
}

function readJsonObject(packet: Buffer): Record<string, unknown> | null {
  const start = packet.indexOf(0x7b)
  if (start < 0) return null
  const text = decodeDiscoveryDocument(jsonValueBytes(packet, start))
  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    try {
      const value = JSON.parse(text.slice(index).trim()) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const rec = value as Record<string, unknown>
      const params = rec.params && typeof rec.params === 'object' ? (rec.params as Record<string, unknown>) : null
      if (rec.method === 'client.notifyDevInfo' || params?.deviceInfo || rec.deviceInfo) return rec
    } catch {
      // trailing bytes after an inner object — try an earlier '{'
    }
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseDahuaDiscovery(packet: Buffer, sourceIp: string): DiscoveryDevice[] {
  const jsonStart = packet.indexOf(0x7b)
  const raw =
    jsonStart < 0 ? decodeDiscoveryDocument(packet) : decodeDiscoveryDocument(jsonValueBytes(packet, jsonStart))
  if (raw.includes('DHDiscover.search')) return []

  const json = readJsonObject(packet)
  if (!json) {
    const ipMatch = raw.match(/"IPAddress"\s*:\s*"(\d{1,3}(?:\.\d{1,3}){3})"/)
    const ip = ipMatch?.[1] && isIPv4(ipMatch[1]) ? ipMatch[1] : isIPv4(sourceIp) ? sourceIp : null
    if (!ip || !/"deviceInfo"|"DeviceType"|"notifyDevInfo"/i.test(raw)) return []
    const hardware = deviceLabel(raw.match(/"DeviceType"\s*:\s*"([^"]+)"/)?.[1] ?? null)
    const name = deviceLabel(raw.match(/"MachineName"\s*:\s*"([^"]+)"/)?.[1] ?? null) ?? hardware
    return [
      {
        ip,
        mac: normalizeMacString(raw.match(/"mac"\s*:\s*"([^"]+)"/)?.[1] ?? ''),
        name,
        board: hardware,
        vendor: vendorFromOnvifText(name, hardware) === 'ONVIF' ? 'Dahua' : vendorFromOnvifText(name, hardware),
        kind: 'cameras'
      }
    ]
  }
  const params = json.params && typeof json.params === 'object' ? (json.params as Record<string, unknown>) : null
  const info = (params?.deviceInfo && typeof params.deviceInfo === 'object'
    ? params.deviceInfo
    : json.deviceInfo && typeof json.deviceInfo === 'object'
      ? json.deviceInfo
      : null) as Record<string, unknown> | null
  if (!info) return []

  const ipv4 = info?.IPv4Address && typeof info.IPv4Address === 'object'
    ? (info.IPv4Address as Record<string, unknown>)
    : null
  const ip = readString(ipv4?.IPAddress) ?? (isIPv4(sourceIp) ? sourceIp : null)
  if (!ip || !isIPv4(ip)) return []

  const hardware = deviceLabel(readString(info?.DeviceType) ?? readString(info?.DeviceClass))
  const name = deviceLabel(readString(info?.MachineName)) ?? hardware
  const vendorText = deviceLabel(readString(info?.Vendor) ?? readString(info?.Manufacturer)) ?? hardware
  return [
    {
      ip,
      mac: normalizeMacString(readString(json.mac) ?? ''),
      name,
      board: hardware,
      vendor:
        vendorFromOnvifText(vendorText, hardware) === 'ONVIF'
          ? 'Dahua'
          : vendorFromOnvifText(vendorText, hardware),
      kind: 'cameras'
    }
  ]
}

export function buildWsDiscoveryGenericProbe(messageId = `uuid:${randomUUID()}`): Buffer {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"' +
    ' xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">' +
    '<s:Header>' +
    '<a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>' +
    `<a:MessageID>${messageId}</a:MessageID>` +
    '<a:To s:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>' +
    '</s:Header>' +
    '<s:Body>' +
    '<Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery" />' +
    '</s:Body>' +
    '</s:Envelope>'
  return Buffer.from(body)
}

export function fetchUpnpDescription(url: string, timeoutMs = 800): Promise<string | null> {
  return new Promise((resolve) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      resolve(null)
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      resolve(null)
      return
    }
    const transport = parsed.protocol === 'https:' ? https : http
    const request = transport.get(
      parsed,
      { timeout: timeoutMs, headers: { Accept: 'text/xml, application/xml, */*' } },
      (response) => {
        if ((response.statusCode ?? 0) >= 400) {
          response.resume()
          resolve(null)
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        const header = response.headers['content-type']
        const contentType = Array.isArray(header) ? (header[0] ?? '') : (header ?? '')
        const bodyText = (): string => decodeDiscoveryDocument(Buffer.concat(chunks), contentType)
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 16_384) {
            request.destroy()
            resolve(bodyText())
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve(bodyText()))
        response.on('error', () => resolve(null))
      }
    )
    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
  })
}
