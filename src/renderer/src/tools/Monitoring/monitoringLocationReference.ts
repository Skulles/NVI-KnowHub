import reference from './monitoringLocationReference.json'

type MonitoringLocationReferenceData = {
  группы: string[]
  проекты: string[]
  кластеры: string[]
  залежи: string[]
  месторождения: string[]
}

export function normalizeLocationMatchText(value: string): string {
  return value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/-/g, '')
}

function buildReferenceNames(): string[] {
  const data = reference as MonitoringLocationReferenceData
  const seen = new Set<string>()
  const names: string[] = []
  for (const group of Object.values(data)) {
    for (const name of group) {
      const trimmed = name.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      names.push(trimmed)
    }
  }
  return names.sort(
    (a, b) => normalizeLocationMatchText(b).length - normalizeLocationMatchText(a).length
  )
}

const REFERENCE_NAMES = buildReferenceNames()

/** Longest known name (group / project / cluster / deposit / field) found in the label. */
export function findKnownLocationToken(locationLabel: string): string | null {
  if (!locationLabel.trim()) return null

  const haystack = normalizeLocationMatchText(locationLabel)
  let best: string | null = null
  let bestLen = 0

  for (const candidate of REFERENCE_NAMES) {
    const needle = normalizeLocationMatchText(candidate)
    if (needle.length < 3) continue
    if (!haystack.includes(needle)) continue
    if (needle.length > bestLen) {
      best = candidate
      bestLen = needle.length
    }
  }

  return best
}
