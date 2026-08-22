/**
 * Zustand store: WinBox availability / update check UI state.
 */
import { create } from 'zustand'

type CheckStatus = 'idle' | 'checking' | 'done' | 'error'

interface WinboxStore {
  checkStatus: CheckStatus
  /** Локальный exe/app уже проверен (без сети). */
  localReady: boolean
  bundled: boolean
  hasUpdate: boolean
  latestVersion: string
  localVersion: string
  toastDismissed: boolean
  mikrotikOnline: boolean
  bundledExpectedName: string
  /** После ошибки запуска из сайдбара (очищается при смене пункта / повторной попытке) */
  sidebarOpenError: string | null
  setChecking: () => void
  setLocalStatus: (info: { bundled: boolean; bundledExpectedName: string }) => void
  setResult: (info: {
    bundled: boolean
    hasUpdate: boolean
    latest: string
    local: string
    mikrotikOnline: boolean
    bundledExpectedName: string
  }) => void
  setError: () => void
  dismissToast: () => void
  setSidebarOpenError: (msg: string | null) => void
}

export const useWinboxStore = create<WinboxStore>((set) => ({
  checkStatus: 'idle',
  localReady: false,
  bundled: false,
  hasUpdate: false,
  latestVersion: '',
  localVersion: '',
  toastDismissed: false,
  mikrotikOnline: false,
  bundledExpectedName: '',
  sidebarOpenError: null,

  setChecking: () => set({ checkStatus: 'checking' }),
  setLocalStatus: ({ bundled, bundledExpectedName }) =>
    set({
      localReady: true,
      bundled,
      bundledExpectedName
    }),
  setResult: ({ bundled, hasUpdate, latest, local, mikrotikOnline, bundledExpectedName }) =>
    set({
      checkStatus: 'done',
      localReady: true,
      bundled,
      hasUpdate,
      latestVersion: latest,
      localVersion: local,
      toastDismissed: false,
      mikrotikOnline,
      bundledExpectedName
    }),
  setError: () => set({ checkStatus: 'error', localReady: true }),
  dismissToast: () => set({ toastDismissed: true }),
  setSidebarOpenError: (msg) => set({ sidebarOpenError: msg })
}))
