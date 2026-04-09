import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { AudienceKind } from '../../entities/knowledge/types'

type AppState = {
  moderatorMode: boolean
  editorOpen: boolean
  /** Активный контур: список статей фильтруются по нему */
  audience: AudienceKind
  setModeratorMode: (enabled: boolean) => void
  setEditorOpen: (open: boolean) => void
  setAudience: (audience: AudienceKind) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      moderatorMode: false,
      editorOpen: false,
      audience: 'bu',
      setModeratorMode: (enabled) => set({ moderatorMode: enabled }),
      setEditorOpen: (open) => set({ editorOpen: open }),
      setAudience: (audience) => set({ audience }),
    }),
    {
      name: 'knowhub-app-state',
      partialize: (state) => ({
        moderatorMode: state.moderatorMode,
        audience: state.audience,
      }),
    },
  ),
)
