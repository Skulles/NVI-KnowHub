export interface FuelToolFormSnapshot {
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

const STORAGE_KEY = 'fuel-tool-form-v2'

const DEFAULT: FuelToolFormSnapshot = {
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

export function loadFuelToolForm(): FuelToolFormSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT }
    return { ...DEFAULT, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT }
  }
}

export function saveFuelToolForm(form: FuelToolFormSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
  } catch {
    // storage unavailable — ignore
  }
}

export function sanitizeFuelNumericInput(value: string): string {
  return value.replace(/[^\d.,\s]/g, '')
}
