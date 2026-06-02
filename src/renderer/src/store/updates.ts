import { create } from 'zustand'

interface UpdatesStore {
  contentUpdated: boolean
  appUpdateVersion: string | null
  appUpdateDownloaded: boolean
  dismissContentUpdate: () => void
  setAppUpdateAvailable: (version: string) => void
  setAppUpdateDownloaded: () => void
}

export const useUpdatesStore = create<UpdatesStore>((set) => ({
  contentUpdated: false,
  appUpdateVersion: null,
  appUpdateDownloaded: false,

  dismissContentUpdate: () => set({ contentUpdated: false }),
  setAppUpdateAvailable: (version) => set({ appUpdateVersion: version }),
  setAppUpdateDownloaded: () => set({ appUpdateDownloaded: true })
}))
