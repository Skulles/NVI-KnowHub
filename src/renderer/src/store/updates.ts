/**
 * Zustand store: app-update download/install toast state and postpone flag.
 */
import { create } from 'zustand'

const APP_UPDATE_POSTPONE_KEY = 'knowhub-app-update-install-next-launch'

export function markAppUpdateInstallOnNextLaunch(): void {
  try {
    localStorage.setItem(APP_UPDATE_POSTPONE_KEY, '1')
  } catch {
    // storage unavailable
  }
}

export function peekAppUpdateInstallOnNextLaunch(): boolean {
  try {
    return localStorage.getItem(APP_UPDATE_POSTPONE_KEY) === '1'
  } catch {
    return false
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
  /** Тихая загрузка после «Позже» — без углового индикатора. */
  appUpdateSilentDownload: boolean
  appUpdateProgress: number | null
  appUpdateDownloaded: boolean
  appUpdateError: string | null
  dismissContentUpdate: () => void
  dismissAppUpdate: () => void
  setAppUpdateAvailable: () => void
  beginAppUpdateDownload: (opts?: { silent?: boolean }) => void
  setAppUpdateProgress: (percent: number) => void
  setAppUpdateDownloaded: () => void
  setAppUpdateError: (message: string | null) => void
}

export const useUpdatesStore = create<UpdatesStore>((set) => ({
  contentUpdated: false,
  appUpdateAvailable: false,
  appUpdateDismissed: false,
  appUpdateDownloading: false,
  appUpdateSilentDownload: false,
  appUpdateProgress: null,
  appUpdateDownloaded: false,
  appUpdateError: null,

  dismissContentUpdate: () => set({ contentUpdated: false }),
  dismissAppUpdate: () => set({ appUpdateDismissed: true }),
  setAppUpdateAvailable: () =>
    set({
      appUpdateAvailable: true,
      appUpdateDismissed: false,
      appUpdateDownloading: false,
      appUpdateSilentDownload: false,
      appUpdateProgress: null,
      appUpdateDownloaded: false,
      appUpdateError: null
    }),
  beginAppUpdateDownload: (opts) =>
    set({
      appUpdateDownloading: true,
      appUpdateSilentDownload: opts?.silent === true,
      appUpdateProgress: 0,
      appUpdateDismissed: false,
      appUpdateError: null
    }),
  setAppUpdateProgress: (percent) => set({ appUpdateProgress: percent }),
  setAppUpdateDownloaded: () =>
    set({
      appUpdateDownloaded: true,
      appUpdateDownloading: false,
      appUpdateSilentDownload: false,
      appUpdateProgress: 100,
      appUpdateDismissed: false,
      appUpdateError: null
    }),
  setAppUpdateError: (message) =>
    set(
      message
        ? {
            appUpdateError: message,
            appUpdateDownloading: false,
            appUpdateSilentDownload: false,
            appUpdateDismissed: false
          }
        : {
            appUpdateError: null,
            appUpdateDownloading: false,
            appUpdateSilentDownload: false
          }
    )
}))

/** Центральный тост (доступно / готово / ошибка) — для стека с другими тостами. */
export function isAppUpdateToastVisible(state: UpdatesStore): boolean {
  if (state.appUpdateDismissed) return false
  if (state.appUpdateError) return true
  if (state.appUpdateDownloaded) return true
  if (state.appUpdateAvailable && !state.appUpdateDownloading) return true
  return false
}
