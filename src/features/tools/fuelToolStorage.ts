const STORAGE_KEY = 'knowhub-fuel-tool-form-v1'

export type FuelToolFormSnapshot = {
  kmStart: string
  kmEnd: string
  startL: string
  refuel: string
  preheat: string
  idleH: string
  norm100: string
  normIdle: string
  normPreheat: string
}

/** Поля, которые сохраняются между сеансами. Заправка, подогревы и холостой ход — только на время работы страницы. */
const PERSIST_KEYS = [
  'kmStart',
  'kmEnd',
  'startL',
  'norm100',
  'normIdle',
  'normPreheat',
] as const satisfies readonly (keyof FuelToolFormSnapshot)[]

type FuelToolPersistedSnapshot = Pick<FuelToolFormSnapshot, (typeof PERSIST_KEYS)[number]>

/** Нули в счётчиках/объёмах; нормы — типовые значения из методики. */
export const FUEL_TOOL_DEFAULTS: FuelToolFormSnapshot = {
  kmStart: '0',
  kmEnd: '0',
  startL: '0',
  refuel: '0',
  preheat: '0',
  idleH: '0',
  norm100: '10,4',
  normIdle: '1',
  normPreheat: '0,9',
}

const FIELDS_ZERO_IF_EMPTY: (keyof FuelToolFormSnapshot)[] = [
  'kmStart',
  'kmEnd',
  'startL',
  'refuel',
  'preheat',
  'idleH',
]

const ALL_NUMERIC_KEYS: (keyof FuelToolFormSnapshot)[] = [
  'kmStart',
  'kmEnd',
  'startL',
  'refuel',
  'preheat',
  'idleH',
  'norm100',
  'normIdle',
  'normPreheat',
]

/**
 * Пустое → «0»; точка или запятая как разделитель; лишние ведущие нули в целой части убираются;
 * отображение с запятой.
 */
export function sanitizeFuelNumericInput(raw: string): string {
  const normalized = raw.replace(/\s/g, '')
  if (normalized === '') return '0'

  const sepIdx = normalized.search(/[,.]/)
  let intRaw = sepIdx === -1 ? normalized : normalized.slice(0, sepIdx)
  let fracRaw = sepIdx === -1 ? '' : normalized.slice(sepIdx + 1)

  intRaw = intRaw.replace(/[^\d]/g, '')
  fracRaw = fracRaw.replace(/[^\d]/g, '')

  let intPart = intRaw.replace(/^0+/, '')
  if (intPart === '') intPart = '0'

  if (fracRaw.length > 12) fracRaw = fracRaw.slice(0, 12)

  if (sepIdx === -1) {
    return intPart
  }
  if (fracRaw.length > 0) {
    return `${intPart},${fracRaw}`
  }
  return `${intPart},`
}

function normalizeFuelNumericFields(form: FuelToolFormSnapshot): FuelToolFormSnapshot {
  const next = { ...form }
  for (const key of ALL_NUMERIC_KEYS) {
    next[key] = sanitizeFuelNumericInput(next[key])
  }
  return next
}

function normalizeFuelToolForm(form: FuelToolFormSnapshot): FuelToolFormSnapshot {
  const next = { ...form }
  for (const key of FIELDS_ZERO_IF_EMPTY) {
    if (next[key].trim() === '') {
      next[key] = '0'
    }
  }
  return next
}

function mergeLoadedPersisted(parsed: Partial<FuelToolFormSnapshot>): FuelToolFormSnapshot {
  const next: FuelToolFormSnapshot = { ...FUEL_TOOL_DEFAULTS }
  for (const key of PERSIST_KEYS) {
    const v = parsed[key]
    if (typeof v === 'string') {
      next[key] = v
    }
  }
  return next
}

export function loadFuelToolForm(): FuelToolFormSnapshot {
  const defaultsNormalized = normalizeFuelNumericFields({ ...FUEL_TOOL_DEFAULTS })
  if (typeof localStorage === 'undefined') {
    return defaultsNormalized
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultsNormalized
    }
    const parsed = JSON.parse(raw) as Partial<FuelToolFormSnapshot>
    return normalizeFuelNumericFields(normalizeFuelToolForm(mergeLoadedPersisted(parsed)))
  } catch {
    return defaultsNormalized
  }
}

export function saveFuelToolForm(snapshot: FuelToolFormSnapshot) {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    const persisted: FuelToolPersistedSnapshot = {} as FuelToolPersistedSnapshot
    for (const key of PERSIST_KEYS) {
      persisted[key] = snapshot[key]
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    /* квота / приватный режим */
  }
}
