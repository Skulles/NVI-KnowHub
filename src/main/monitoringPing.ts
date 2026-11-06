/** ICMP error notices are not echo replies. «bytes from» also appears in Host Unreachable. */
const ICMP_ERROR_LINE_RE =
  /unreachable|time to live exceeded|ttl exceeded|packet filtered|administratively prohibited|узел недоступен|сеть недоступна|хост недоступен/i

export type PingProbeReading = {
  online: boolean
  latencyMs: number | null
  replyCount: number
}

function echoReplyText(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => !ICMP_ERROR_LINE_RE.test(line))
    .join('\n')
}

function countEchoReplies(output: string): number {
  const ttlHits = [...output.matchAll(/\bTTL=/gi)]
  if (ttlHits.length) return ttlHits.length

  // English / partial localized forms when code page mangled Cyrillic.
  const byteHits = [...output.matchAll(/\b(?:bytes\s+from|bytes\s*[=:]|байт\s*[=:])/gi)]
  return byteHits.length
}

/** Packets the target actually echoed, from the ping statistics line. */
export function parsePingPacketsReceived(output: string): number | null {
  const unix = output.match(/\b(\d+)\s+packets?\s+received\b/i)
  if (unix) return Number(unix[1])

  const windows = output.match(/\bReceived\s*=\s*(\d+)/i) ?? output.match(/получено\s*=\s*(\d+)/i)
  if (windows) return Number(windows[1])

  return null
}

export function parseLatencyMs(output: string): number | null {
  const summaryMatch = output.match(/(?:round-trip|rtt)[^=]*=\s*[0-9]+(?:[.,][0-9]+)?\/([0-9]+(?:[.,][0-9]+)?)\//i)
  if (summaryMatch) {
    const latency = Number(summaryMatch[1].replace(',', '.'))
    return Number.isFinite(latency) ? latency : null
  }

  const windowsAverageMatch = output.match(
    /(?:Average|Среднее|Средний|Средняя)\s*=\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:ms|мс|мсек)?/i
  )
  if (windowsAverageMatch) {
    const latency = Number(windowsAverageMatch[1].replace(',', '.'))
    return Number.isFinite(latency) ? latency : null
  }

  // "время=820мс" / "time=820ms" — optional spaces (RU Windows often has none).
  const samples = [
    ...output.matchAll(/(?:time|время)\s*[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:ms|мс|мсек)?/gi)
  ]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter(Number.isFinite)

  if (samples.length) {
    return samples.reduce((sum, value) => sum + value, 0) / samples.length
  }

  // Localized Windows ping often arrives in a legacy code page; match latency before TTL instead.
  const ttlSamples = [...output.matchAll(/[<>=](\d+(?:[.,]\d+)?)[^\d\n\r]*TTL=/gi)]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter(Number.isFinite)

  if (!ttlSamples.length) return null

  return ttlSamples.reduce((sum, value) => sum + value, 0) / ttlSamples.length
}

/** Echo replies only. Gateway «Host Unreachable» does not count as the link being up. */
export function readPingProbe(output: string): PingProbeReading {
  const echo = echoReplyText(output)
  const received = parsePingPacketsReceived(output)
  const replies = countEchoReplies(echo)
  const latencyMs = parseLatencyMs(echo)

  if (received === 0 || (replies === 0 && latencyMs === null)) {
    return { online: false, latencyMs: null, replyCount: 0 }
  }

  return {
    online: true,
    latencyMs,
    replyCount: received ?? replies
  }
}
