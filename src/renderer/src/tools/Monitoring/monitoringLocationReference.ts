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

/**
 * Direction immediately before a determined place name.
 * «Западно Мессояхское», «Северо-Западно Покровское», «Западно-Медвежье».
 */
const LEADING_DIRECTION_RE =
  /(?:^|[^\p{L}])((?:северо|юго)[-\s]+(?:западно|восточно)|западно|восточно|северно|южно|северо|юго)([-\s]+)$/iu

/** Prepends a spaced or hyphenated direction that sits immediately before `tokenStart`. */
export function attachLeadingDirection(label: string, tokenStart: number, token: string): string {
  const match = label.slice(0, tokenStart).match(LEADING_DIRECTION_RE)
  const direction = match?.[1]
  if (!direction) return token
  const separator = match[2] ?? ' '
  const joiner = separator.includes('-') && !/\s/.test(separator) ? '-' : ' '
  return `${direction}${joiner}${token}`
}

function findNormalizedMatchSpan(
  label: string,
  candidate: string
): { start: number; end: number } | null {
  const needle = normalizeLocationMatchText(candidate)
  if (!needle) return null

  const folded: string[] = []
  const origins: number[] = []
  for (let index = 0; index < label.length; index += 1) {
    const ch = label[index]
    if (ch === '-') continue
    const norm = ch.toLocaleLowerCase('ru').replace(/ё/g, 'е')
    for (const piece of norm) {
      folded.push(piece)
      origins.push(index)
    }
  }

  const at = folded.join('').indexOf(needle)
  if (at < 0) return null
  const start = origins[at]
  const end = origins[at + needle.length - 1]
  if (start === undefined || end === undefined) return null
  return { start, end: end + 1 }
}

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

  if (!best) return null
  const span = findNormalizedMatchSpan(locationLabel, best)
  if (!span) return best
  return attachLeadingDirection(locationLabel, span.start, best)
}
