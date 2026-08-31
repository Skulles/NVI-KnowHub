import {
  normalizeMonitoringObjectKind,
  type MonitoringObject,
  type MonitoringObjectKind
} from './monitoringStorage'

export const MONITORING_OBJECT_KIND_LABELS: Record<MonitoringObjectKind, string> = {
  auto: 'Тип не определён',
  drilling: 'Буровая',
  tkrs: 'ТКРС'
}

export const MONITORING_OBJECT_KIND_SUMMARY_LABELS: Record<MonitoringObjectKind, string> = {
  auto: 'Тип не определён',
  drilling: 'Буровые',
  tkrs: 'ТКРС'
}

export const MONITORING_OBJECT_KIND_EDITOR_LABELS: Record<MonitoringObjectKind, string> = {
  auto: 'Авто',
  drilling: 'Буровая',
  tkrs: 'ТКРС'
}

function objectNoun(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'объект'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'объекта'
  return 'объектов'
}

export function formatUndeterminedObjectKindTitle(count: number): string {
  return `${count} ${objectNoun(count)} без типа`
}

export const UNDETERMINED_OBJECT_KIND_HINT =
  'Не удалось определить тип или объект ещё не появлялся в сети.\n[Можно указать вручную в свойствах объекта]'

export function formatUndeterminedObjectKindHint(count: number): string {
  return `${formatUndeterminedObjectKindTitle(count)} — ${UNDETERMINED_OBJECT_KIND_HINT}`
}

const NAME_SCORE = 3
const GEAR_SCORE = 1
const MIN_MARGIN = 2

const WITS_DEVICE_TYPES = new Set(['wits', 'witsml'])
const TKRS_NAME_TOKENS = new Set(['ТКРС', 'КРС', 'ПРС'])

function normalizeName(value: string): string {
  return value.trim().toUpperCase().replace(/Ё/g, 'Е')
}

function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(/[^0-9A-ZА-Я]+/)
    .filter(Boolean)
}

function isDrillingNameToken(token: string): boolean {
  return token === 'БУ' || token === 'БУРОВАЯ' || /^БУ\d+$/.test(token)
}

function collectObjectNames(object: MonitoringObject): string[] {
  const names: string[] = []
  if (object.primaryLocationName?.trim()) names.push(object.primaryLocationName)
  for (const location of object.locations ?? []) {
    if (location.localizedName.trim()) names.push(location.localizedName)
  }
  return names
}

function scoreName(object: MonitoringObject): { drilling: number; tkrs: number } {
  let drilling = 0
  let tkrs = 0

  for (const name of collectObjectNames(object)) {
    for (const token of nameTokens(name)) {
      if (TKRS_NAME_TOKENS.has(token)) tkrs = NAME_SCORE
      if (isDrillingNameToken(token)) drilling = NAME_SCORE
    }
  }

  return { drilling, tkrs }
}

function knownCameraCount(object: MonitoringObject): number | null {
  if (object.cameraStreams) return object.cameraStreams.length
  if (typeof object.camerasTotal === 'number' && Number.isFinite(object.camerasTotal)) {
    return Math.max(0, Math.round(object.camerasTotal))
  }
  return null
}

function knownMegaphoneCount(object: MonitoringObject): number | null {
  if (object.megaphones) return object.megaphones.length
  if (typeof object.megaphonesTotal === 'number' && Number.isFinite(object.megaphonesTotal)) {
    return Math.max(0, Math.round(object.megaphonesTotal))
  }
  return null
}

function hasWitsSensors(object: MonitoringObject): boolean | null {
  if (!object.guardDevices) return null
  return object.guardDevices.some((device) => WITS_DEVICE_TYPES.has(device.type.trim().toLowerCase()))
}

/** Scores cached OWL.Guard signs. Ignores a locked (non-auto) kind. */
export function inferMonitoringObjectKind(object: MonitoringObject): MonitoringObjectKind {
  let drilling = 0
  let tkrs = 0

  const name = scoreName(object)
  drilling += name.drilling
  tkrs += name.tkrs

  const cameras = knownCameraCount(object)
  if (cameras !== null) {
    if (cameras <= 6) tkrs += GEAR_SCORE
    else drilling += GEAR_SCORE
  }

  const megaphones = knownMegaphoneCount(object)
  if (megaphones !== null) {
    if (megaphones <= 1) tkrs += GEAR_SCORE
    else drilling += GEAR_SCORE
  }

  const wits = hasWitsSensors(object)
  if (wits !== null) {
    if (wits) drilling += GEAR_SCORE
    else tkrs += GEAR_SCORE
  }

  const margin = Math.abs(drilling - tkrs)
  if (margin < MIN_MARGIN) return 'auto'
  return drilling > tkrs ? 'drilling' : 'tkrs'
}

/** Keeps a manual Буровая/ТКРС; otherwise infers from cached signs. */
export function resolveMonitoringObjectKind(object: MonitoringObject): MonitoringObjectKind {
  const current = normalizeMonitoringObjectKind(object.objectKind)
  if (current !== 'auto') return current
  return inferMonitoringObjectKind(object)
}

export function applyResolvedObjectKind(object: MonitoringObject): MonitoringObject {
  const resolved = resolveMonitoringObjectKind(object)
  if (object.objectKind === resolved) return object
  return { ...object, objectKind: resolved }
}
