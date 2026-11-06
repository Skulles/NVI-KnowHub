import { describe, expect, it } from 'vitest'
import {
  MIN_PARALLEL_BYTES,
  headerHasRange,
  parseContentRangeTotal,
  planByteRanges,
  sha512DigestEncoding
} from './parallelDownloadPlan'

describe('planByteRanges', () => {
  it('splits a file into inclusive ranges that cover every byte', () => {
    const ranges = planByteRanges(1000, 4)
    expect(ranges).toEqual([
      [0, 249],
      [250, 499],
      [500, 749],
      [750, 999]
    ])
  })

  it('keeps a leftover tail on the last range', () => {
    expect(planByteRanges(10, 3)).toEqual([
      [0, 3],
      [4, 7],
      [8, 9]
    ])
  })

  it('does not create more ranges than bytes', () => {
    expect(planByteRanges(2, 8)).toEqual([
      [0, 0],
      [1, 1]
    ])
  })

  it('returns nothing for an empty file', () => {
    expect(planByteRanges(0, 4)).toEqual([])
  })
})

describe('parseContentRangeTotal', () => {
  it('reads the total size from a 206 Content-Range header', () => {
    expect(parseContentRangeTotal('bytes 0-0/184320000')).toBe(184320000)
  })

  it('returns 0 when the header is missing', () => {
    expect(parseContentRangeTotal(undefined)).toBe(0)
  })
})

describe('headerHasRange', () => {
  it('detects Range regardless of header case', () => {
    expect(headerHasRange({ Range: 'bytes=0-1' })).toBe(true)
    expect(headerHasRange({ range: 'bytes=0-1' })).toBe(true)
    expect(headerHasRange({ Accept: '*/*' })).toBe(false)
    expect(headerHasRange(null)).toBe(false)
  })
})

describe('sha512DigestEncoding', () => {
  it('uses hex for a 128-char digest without base64 alphabet', () => {
    expect(sha512DigestEncoding('a'.repeat(128))).toBe('hex')
  })

  it('uses base64 for electron-updater checksums', () => {
    expect(sha512DigestEncoding('abc+def=')).toBe('base64')
  })
})

describe('MIN_PARALLEL_BYTES', () => {
  it('skips tiny metadata files', () => {
    expect(MIN_PARALLEL_BYTES).toBeGreaterThan(1024 * 1024)
  })
})
