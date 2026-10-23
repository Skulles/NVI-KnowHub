import { attachLeadingDirection, findKnownLocationToken } from './monitoringLocationReference'
import {
  resolveObjectCardLocationName,
  type MonitoringObject
} from './monitoringStorage'

/** Filter list entry for objects without a card location or without a matched token. */
export const MONITORING_UNDETERMINED_LOCATION_FILTER = 'Не определено'

/** Cyrillic token ending in «ое», optional hyphens inside (e.g. «Покров-ское»). No lookbehind — older WebKit. */
const OE_WORD_RE = /(?:^|[^\p{L}-])([\p{L}]+(?:-[\p{L}]+)*ое)(?=[^\p{L}-]|$)/giu

export function normalizeOeLocationToken(word: string): string {
  return word.toLocaleLowerCase('ru').replace(/-/g, '')
}

export function locationFilterTokenKey(label: string): string {
  return normalizeOeLocationToken(label).replace(/\s+/g, '')
}

export function extractOeEndingWords(locationLabel: string): string[] {
  if (!locationLabel.trim()) return []
  const seen = new Set<string>()
  const words: string[] = []
  for (const match of locationLabel.matchAll(OE_WORD_RE)) {
    const word = match[1]
    if (!word || match.index === undefined) continue
    const wordStart = match.index + match[0].length - word.length
    const token = attachLeadingDirection(locationLabel, wordStart, word)
    const key = locationFilterTokenKey(token)
    if (seen.has(key)) continue
    seen.add(key)
    words.push(token)
  }
  return words
}

/** Settlement «-ое» tokens first; otherwise longest match from the reference catalog. */
export function extractLocationFilterTokens(locationLabel: string): string[] {
  const oe = extractOeEndingWords(locationLabel)
  if (oe.length > 0) return oe
  const known = findKnownLocationToken(locationLabel)
  return known ? [known] : []
}

export function isUndeterminedMonitoringLocation(object: MonitoringObject): boolean {
  const location = resolveObjectCardLocationName(object)
  if (!location) return true
  return extractLocationFilterTokens(location).length === 0
}

export type OeLocationFilterOption = {
  label: string
  count: number
}

export function buildOeLocationFilterOptions(objects: MonitoringObject[]): OeLocationFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>()
  let undeterminedCount = 0

  for (const object of objects) {
    if (isUndeterminedMonitoringLocation(object)) {
      undeterminedCount += 1
      continue
    }
    const location = resolveObjectCardLocationName(object)
    if (!location) continue
    for (const token of extractLocationFilterTokens(location)) {
      const key = locationFilterTokenKey(token)
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { label: token, count: 1 })
    }
  }

  const options = [...counts.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  if (undeterminedCount > 0) {
    options.push({ label: MONITORING_UNDETERMINED_LOCATION_FILTER, count: undeterminedCount })
  }
  return options
}

export function objectMatchesOeLocationFilter(
  object: MonitoringObject,
  selectedLabel: string | null
): boolean {
  if (!selectedLabel) return true
  if (selectedLabel === MONITORING_UNDETERMINED_LOCATION_FILTER) {
    return isUndeterminedMonitoringLocation(object)
  }
  const location = resolveObjectCardLocationName(object)
  if (!location) return false
  const key = locationFilterTokenKey(selectedLabel)
  return extractLocationFilterTokens(location).some(
    (token) => locationFilterTokenKey(token) === key
  )
}
