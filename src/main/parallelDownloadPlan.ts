/**
 * Pure helpers for parallel HTTP Range downloads.
 * Kept free of Electron/fs so vitest can cover them.
 */

export const UPDATE_DOWNLOAD_CONNECTIONS = 4
export const MIN_PARALLEL_BYTES = 2 * 1024 * 1024

export function headerHasRange(headers?: Record<string, unknown> | null): boolean {
  if (!headers) return false
  return Object.keys(headers).some((key) => {
    if (key.toLowerCase() !== 'range') return false
    const value = headers[key]
    return value != null && String(value).length > 0
  })
}

/** Inclusive byte ranges covering `total`, split across up to `connections` parts. */
export function planByteRanges(total: number, connections: number): Array<[number, number]> {
  if (total <= 0) return []
  const count = Math.max(1, Math.min(Math.floor(connections), total))
  const chunkSize = Math.ceil(total / count)
  const ranges: Array<[number, number]> = []
  for (let start = 0; start < total; start += chunkSize) {
    ranges.push([start, Math.min(total, start + chunkSize) - 1])
  }
  return ranges
}

export function parseContentRangeTotal(header: string | undefined): number {
  const match = String(header || '').match(/\/(\d+)\s*$/)
  const total = match ? Number(match[1]) : 0
  return Number.isFinite(total) ? total : 0
}

export function sha512DigestEncoding(sha512: string): 'hex' | 'base64' {
  return sha512.length === 128 && !sha512.includes('+') && !sha512.includes('Z') && !sha512.includes('=')
    ? 'hex'
    : 'base64'
}
