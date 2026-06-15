import { create } from 'zustand'

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
      appUpdateError: null
    }),
  setAppUpdateError: (message) =>
    set({
      appUpdateError: message,
      appUpdateDownloading: false
    })
}))

export function isAppUpdateBannerVisible(state: UpdatesStore): boolean {
  if (state.appUpdateDownloaded || state.appUpdateDownloading) return true
  return state.appUpdateAvailable && !state.appUpdateDismissed
}
