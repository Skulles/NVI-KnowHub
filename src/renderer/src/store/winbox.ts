import { create } from 'zustand'

type CheckStatus = 'idle' | 'checking' | 'done' | 'error'

interface WinboxStore {
  checkStatus: CheckStatus
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
  bundled: false,
  hasUpdate: false,
  latestVersion: '',
  localVersion: '',
  toastDismissed: false,
  mikrotikOnline: false,
  bundledExpectedName: '',
  sidebarOpenError: null,

  setChecking: () => set({ checkStatus: 'checking' }),
  setResult: ({ bundled, hasUpdate, latest, local, mikrotikOnline, bundledExpectedName }) =>
    set({
      checkStatus: 'done',
      bundled,
      hasUpdate,
      latestVersion: latest,
      localVersion: local,
      toastDismissed: false,
      mikrotikOnline,
      bundledExpectedName
    }),
  setError: () => set({ checkStatus: 'error' }),
  dismissToast: () => set({ toastDismissed: true }),
  setSidebarOpenError: (msg) => set({ sidebarOpenError: msg })
}))
