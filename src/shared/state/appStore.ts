import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { AudienceKind } from '../../entities/knowledge/types'

export type ColorTheme = 'auto' | 'light' | 'dark'

type AppState = {
  editorMode: boolean
  editorOpen: boolean
  /** Активный контур: список статей фильтруются по нему */
  audience: AudienceKind
  colorTheme: ColorTheme
  setEditorMode: (enabled: boolean) => void
  setEditorOpen: (open: boolean) => void
  setAudience: (audience: AudienceKind) => void
  setColorTheme: (theme: ColorTheme) => void
}

type LegacyPersisted = {
  moderatorMode?: boolean
  editorMode?: boolean
  audience?: AudienceKind
  colorTheme?: ColorTheme
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      editorMode: false,
      editorOpen: false,
      audience: 'bu',
      colorTheme: 'auto',
      setEditorMode: (enabled) => set({ editorMode: enabled }),
      setEditorOpen: (open) => set({ editorOpen: open }),
      setAudience: (audience) => set({ audience }),
      setColorTheme: (colorTheme) => set({ colorTheme }),
    }),
    {
      name: 'knowhub-app-state',
      version: 2,
      partialize: (state) => ({
        editorMode: state.editorMode,
        audience: state.audience,
        colorTheme: state.colorTheme,
      }),
      migrate: (persisted) => {
        const p = persisted as LegacyPersisted
        return {
          editorMode: p.editorMode ?? p.moderatorMode ?? false,
          audience: p.audience ?? 'bu',
          colorTheme: p.colorTheme ?? 'auto',
        }
      },
    },
  ),
)
