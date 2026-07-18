import { create } from 'zustand'

const APP_UPDATE_POSTPONE_KEY = 'knowhub-app-update-install-next-launch'

export function markAppUpdateInstallOnNextLaunch(): void {
  try {
    localStorage.setItem(APP_UPDATE_POSTPONE_KEY, '1')
  } catch {
    // storage unavailable
  }
}

export function consumeAppUpdateInstallOnNextLaunch(): boolean {
  try {
    if (localStorage.getItem(APP_UPDATE_POSTPONE_KEY) !== '1') return false
    localStorage.removeItem(APP_UPDATE_POSTPONE_KEY)
    return true
  } catch {
    return false
  }
}

export function clearAppUpdateInstallOnNextLaunch(): void {
  try {
    localStorage.removeItem(APP_UPDATE_POSTPONE_KEY)
  } catch {
    // storage unavailable
  }
}

interface UpdatesStore {
  contentUpdated: boolean
  appUpdateAvailable: boolean
  appUpdateDismissed: boolean
  appUpdateDownloading: boolean
  appUpdateProgress: number | null
  appUpdateDownloaded: boolean
  appUpdateError: string | null
  dismissContentUpdate: () => void
  dismissAppUpdate: () => void
  setAppUpdateAvailable: () => void
  setAppUpdateDownloading: (downloading: boolean) => void
  setAppUpdateProgress: (percent: number) => void
  setAppUpdateDownloaded: () => void
  setAppUpdateError: (message: string | null) => void
}

export const useUpdatesStore = create<UpdatesStore>((set) => ({
  contentUpdated: false,
  appUpdateAvailable: false,
  appUpdateDismissed: false,
  appUpdateDownloading: false,
  appUpdateProgress: null,
  appUpdateDownloaded: false,
  appUpdateError: null,

  dismissContentUpdate: () => set({ contentUpdated: false }),
  dismissAppUpdate: () => set({ appUpdateDismissed: true }),
  setAppUpdateAvailable: () =>
    set({
      appUpdateAvailable: true,
      appUpdateDismissed: false,
      appUpdateDownloading: true,
      appUpdateProgress: 0,
      appUpdateError: null
    }),
  setAppUpdateDownloading: (downloading) =>
    set({
      appUpdateDownloading: downloading,
      appUpdateProgress: downloading ? 0 : null,
      appUpdateError: downloading ? null : null
    }),
  setAppUpdateProgress: (percent) => set({ appUpdateProgress: percent }),
  setAppUpdateDownloaded: () =>
    set({
      appUpdateDownloaded: true,
      appUpdateDownloading: false,
      appUpdateProgress: 100,
      appUpdateDismissed: false,
      appUpdateError: null
    }),
  setAppUpdateError: (message) =>
    set({
      appUpdateError: message,
      appUpdateDownloading: false
    })
}))

/** Тост «обновление готово» / ошибка — для стека с другими тостами. */
export function isAppUpdateToastVisible(state: UpdatesStore): boolean {
  if (state.appUpdateDismissed) return false
  return state.appUpdateDownloaded || !!state.appUpdateError
}
