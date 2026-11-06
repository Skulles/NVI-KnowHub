/**
 * Device names arrive as UTF-8, Windows-1251, CP866 or UTF-16.
 * Blind UTF-8 turns the single-byte Cyrillic pages into replacement characters.
 */

const CP1251 = 'windows-1251'
const CP866 = 'ibm866'
const CP1252 = 'windows-1252'

type LegacyId = 'cp1251' | 'cp866'
type Prefer = LegacyId

const encoderMaps = new Map<string, Map<string, number>>()

function stripTrailingNulls(bytes: Buffer): Buffer {
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end -= 1
  return end === bytes.length ? bytes : bytes.subarray(0, end)
}

function stripUtf8Bom(bytes: Buffer): Buffer {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3)
  }
  return bytes
}

function strictUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function decodeLabel(label: string, bytes: Buffer): string | null {
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return null
  }
}

function canonicalCharset(value: string | null | undefined): 'utf8' | 'utf16le' | LegacyId | null {
  if (!value) return null
  const name = value.trim().toLowerCase().replace(/[_\s]+/g, '-')
  if (name === 'utf-8' || name === 'utf8') return 'utf8'
  if (name === 'utf-16' || name === 'utf-16le' || name === 'utf16') return 'utf16le'
  if (name === 'windows-1251' || name === 'cp1251' || name === 'win-1251' || name === 'x-cp1251') return 'cp1251'
  if (name === 'cp866' || name === 'ibm866' || name === 'csibm866') return 'cp866'
  return null
}

function declaredCharset(bytes: Buffer, contentType = ''): string | null {
  const header = contentType.match(/charset\s*=\s*["']?\s*([a-z0-9._-]+)/i)?.[1]
  if (header) return header
  const head = bytes.subarray(0, 2048).toString('latin1')
  return (
    head.match(/<\?xml[^>]*encoding\s*=\s*["']([a-z0-9._-]+)["']/i)?.[1] ??
    head.match(/charset\s*=\s*["']?\s*([a-z0-9._-]+)/i)?.[1] ??
    null
  )
}

/** Higher means the string looks like a device name rather than a mis-decoded page. */
function readableScore(text: string): number {
  let score = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39)
    ) {
      score += 2
    } else if ((code >= 0x410 && code <= 0x44f) || code === 0x401 || code === 0x451) {
      score += 4
    } else if (code === 0x20 || code === 0x2d || code === 0x5f || code === 0x2e || code === 0x28 || code === 0x29) {
      score += 1
    } else if (code >= 0x2500 && code <= 0x259f) {
      score -= 4
    } else if (code === 0xfffd || code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      score -= 6
    } else if ((code >= 0x400 && code <= 0x40f) || (code >= 0x450 && code <= 0x45f)) {
      score -= 1
    } else {
      score -= 1
    }
  }
  return score
}

function looksLikeUtf16Le(bytes: Buffer): boolean {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return true
  if (bytes.length < 4 || bytes.length % 2 !== 0) return false
  const pairs = Math.floor(Math.min(bytes.length, 80) / 2)
  let matched = 0
  for (let index = 0; index < pairs; index += 1) {
    const lo = bytes[index * 2]
    const hi = bytes[index * 2 + 1]
    const ascii = hi === 0 && lo >= 0x20 && lo < 0x7f
    const cyrillic = hi === 0x04 && lo >= 0x01 && lo <= 0x51
    if (ascii || cyrillic) matched += 1
  }
  return matched / pairs >= 0.75
}

function decodeUtf16Le(bytes: Buffer): string {
  const start = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe ? 2 : 0
  return new TextDecoder('utf-16le').decode(bytes.subarray(start))
}

function cleanControls(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\uFFFD/g, '')
}

function pickLegacy(bytes: Buffer, prefer: Prefer, charset: LegacyId | null): string {
  const options: Array<{ id: LegacyId; text: string }> = []
  const cp1251 = decodeLabel(CP1251, bytes)
  const cp866 = decodeLabel(CP866, bytes)
  if (cp1251 != null) options.push({ id: 'cp1251', text: cp1251 })
  if (cp866 != null) options.push({ id: 'cp866', text: cp866 })
  if (!options.length) return bytes.toString('latin1')

  let best = options[0]
  let bestScore = readableScore(best.text)
  let bestRank = best.id === prefer ? 0 : 1
  for (const option of options.slice(1)) {
    const score = readableScore(option.text)
    const rank = option.id === prefer ? 0 : 1
    if (score > bestScore || (score === bestScore && rank < bestRank)) {
      best = option
      bestScore = score
      bestRank = rank
    }
  }
  if (charset) {
    const forced = options.find((option) => option.id === charset)
    if (forced && readableScore(forced.text) >= bestScore) return forced.text
  }
  return best.text
}

export function decodeDiscoveryBytes(
  bytes: Buffer,
  options?: { charset?: string | null; prefer?: Prefer }
): string {
  if (bytes.length === 0) return ''
  const prefer = options?.prefer ?? 'cp1251'
  const charset = canonicalCharset(options?.charset)
  const single = stripTrailingNulls(stripUtf8Bom(bytes))
  if (single.length === 0) return ''

  const utf8 = strictUtf8(single)
  // Cyrillic UTF-16LE is also valid UTF-8 (every byte is below 0x80), so compare scores first.
  if ((charset === 'utf16le' || looksLikeUtf16Le(bytes)) && charset !== 'cp1251' && charset !== 'cp866') {
    const utf16 = decodeUtf16Le(bytes)
    const utf8Score = utf8 == null ? Number.NEGATIVE_INFINITY : readableScore(utf8)
    if (readableScore(utf16) > utf8Score) return cleanControls(utf16).trim()
  }
  if (utf8 != null && charset !== 'cp1251' && charset !== 'cp866') {
    return cleanControls(utf8).trim()
  }
  if (utf8 != null && (charset === 'cp1251' || charset === 'cp866')) {
    const forced = pickLegacy(single, prefer, charset)
    if (readableScore(forced) > readableScore(utf8)) return cleanControls(forced).trim()
    return cleanControls(utf8).trim()
  }

  return cleanControls(pickLegacy(single, prefer, charset === 'cp1251' || charset === 'cp866' ? charset : null)).trim()
}

export function decodeDiscoveryDocument(bytes: Buffer, contentType = ''): string {
  return decodeDiscoveryBytes(bytes, { charset: declaredCharset(bytes, contentType) })
}

function encoderFor(encoding: string): Map<string, number> {
  const cached = encoderMaps.get(encoding)
  if (cached) return cached
  const map = new Map<string, number>()
  const decoder = new TextDecoder(encoding)
  for (let index = 0; index < 256; index += 1) {
    const ch = decoder.decode(Uint8Array.of(index))
    if (!map.has(ch)) map.set(ch, index)
  }
  encoderMaps.set(encoding, map)
  return map
}

function encodeLegacy(encoding: string, text: string): Buffer | null {
  let map: Map<string, number>
  try {
    map = encoderFor(encoding)
  } catch {
    return null
  }
  const out = Buffer.alloc(text.length)
  for (let index = 0; index < text.length; index += 1) {
    const byte = map.get(text[index] ?? '')
    if (byte === undefined) return null
    out[index] = byte
  }
  return out
}

/** UTF-8 Cyrillic read as Windows-1251 looks like "РљР°РјРµСЂР°"; as Windows-1252, like "ÐšÐ°Ð¼ÐµСЂÐ°". */
function looksMojibake(text: string): boolean {
  if (/[\u00C2\u00C3\u00D0\u00D1]/.test(text)) return true
  return /[РС][\u0400-\u040F\u0450-\u045F\u00A0-\u00BF\u2018-\u2026]/.test(text)
}

function safeChar(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return ''
  if (code >= 0xd800 && code <= 0xdfff) return ''
  if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return ''
  return String.fromCodePoint(code)
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => safeChar(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(Number.parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function normalizeDiscoveryText(text: string): string {
  const decoded = cleanControls(decodeXmlEntities(text)).replace(/\u00A0/g, ' ').trim()
  if (!decoded || !looksMojibake(decoded)) return decoded
  let best = decoded
  let bestScore = readableScore(decoded)
  for (const encoding of [CP1251, CP1252]) {
    const bytes = encodeLegacy(encoding, decoded)
    if (!bytes) continue
    const next = strictUtf8(bytes)
    if (!next || next === decoded) continue
    const score = readableScore(next)
    if (score > bestScore) {
      best = next
      bestScore = score
    }
  }
  return cleanControls(best).replace(/\u00A0/g, ' ').trim()
}
