/**
 * Zustand store: manifest, selection, article HTML, and tools section
 * (with mock fallback when window.api is unavailable).
 */
import { create } from 'zustand'
import type { ContentManifest, ContentItem, Section } from '@shared/types'
import { flattenManifestItems } from '@shared/manifest'

/** Метки для анимации обновления контента (секция «Инструкции»): endMs = null пока идёт initContentStore. */
export interface InstructionsRefreshTiming {
  startedAtMs: number
  endMs: number | null
}

interface ContentStore {
  manifest: ContentManifest | null
  selectedItem: ContentItem | null
  articleHtml: string | null
  loading: boolean
  /** Не null — показывать прогресс рядом с «Инструкции» */
  instructionsRefresh: InstructionsRefreshTiming | null
  setManifest: (manifest: ContentManifest | null) => void
  setInstructionsRefresh: (timing: InstructionsRefreshTiming | null) => void
  selectItem: (item: ContentItem) => Promise<void>
}

// Tools are defined in code — never in any manifest JSON, so they can't disappear on sync.
const TOOLS_SECTION: Section = {
  id: 'tools',
  title: 'Инструменты',
  icon: 'wrench',
  items: [
    {
      id: 'monitoring',
      title: 'Мониторинг',
      type: 'tool',
      toolId: 'monitoring',
      icon: 'monitoring',
      version: 1
    },
    {
      id: 'winbox',
      title: 'WinBox и конфиги',
      type: 'tool',
      toolId: 'winbox',
      icon: 'router',
      version: 1
    },
    {
      id: 'fuel-calculator',
      title: 'Расчёт расхода топлива',
      type: 'tool',
      toolId: 'fuel-calculator',
      icon: 'fuel',
      version: 1
    }
  ]
}

function withTools(manifest: ContentManifest): ContentManifest {
  const sections = manifest.sections.filter((s) => s.id !== 'tools')
  return { ...manifest, sections: [TOOLS_SECTION, ...sections] }
}

const MOCK_MANIFEST: ContentManifest = {
  version: 1,
  sections: [
    {
      id: 'instructions',
      title: 'Инструкции',
      icon: 'book',
      subsections: [
        {
          id: 'mikrotik',
          title: 'MikroTik',
          items: [
            {
              id: 'onboarding',
              title: 'Онбординг нового сотрудника',
              type: 'article',
              htmlFile: 'onboarding.html',
              version: 1
            }
          ]
        }
      ]
    }
  ]
}


const MIN_INSTRUCTIONS_REFRESH_MS = 3000
const LAST_SELECTED_ITEM_KEY = 'content-last-selected-item-id-v1'

export { MIN_INSTRUCTIONS_REFRESH_MS }

function loadLastSelectedItemId(): string | null {
  try {
    return localStorage.getItem(LAST_SELECTED_ITEM_KEY)
  } catch {
    return null
  }
}

function saveLastSelectedItemId(itemId: string): void {
  try {
    localStorage.setItem(LAST_SELECTED_ITEM_KEY, itemId)
  } catch {
    // storage unavailable - ignore
  }
}

export const useContentStore = create<ContentStore>((set) => ({
  manifest: null,
  selectedItem: null,
  articleHtml: null,
  loading: false,
  instructionsRefresh: null,

  setManifest: (manifest) => set({ manifest }),
  setInstructionsRefresh: (instructionsRefresh) => set({ instructionsRefresh }),

  selectItem: async (item) => {
    const { selectedItem } = useContentStore.getState()
    const isSameItem = selectedItem?.id === item.id
    saveLastSelectedItemId(item.id)

    if (item.type === 'tool') {
      set({ selectedItem: item, articleHtml: null, loading: false })
      return
    }

    if (!item.htmlFile) {
      set({ selectedItem: item, loading: false })
      return
    }

    if (!isSameItem) {
      set({ selectedItem: item, articleHtml: null, loading: true })
    }

    const html = window.api ? await window.api.getArticleHtml(item.htmlFile) : null
    const nextHtml = html ?? '<p>Статья не найдена.</p>'

    set((state) => ({
      selectedItem: item,
      articleHtml: nextHtml === state.articleHtml ? state.articleHtml : nextHtml,
      loading: false
    }))
  }
}))

export async function initContentStore(): Promise<void> {
  let manifest: ContentManifest | null = null

  if (window.api) {
    manifest = await window.api.getManifest()
  }

  if (!manifest) {
    // Browser/test without Electron: show mock. Packaged/Electron: empty catalog.
    if (!window.api) {
      manifest = MOCK_MANIFEST
    } else {
      useContentStore.getState().setManifest(null)
      useContentStore.setState({ selectedItem: null, articleHtml: null, loading: false })
      return
    }
  }

  const manifestWithTools = withTools(manifest)
  useContentStore.getState().setManifest(manifestWithTools)

  const state = useContentStore.getState()
  const items = flattenManifestItems(manifestWithTools)
  const keepCurrent =
    state.selectedItem && items.find((item) => item.id === state.selectedItem!.id)
  const lastSelectedId = loadLastSelectedItemId()
  const lastSelected = lastSelectedId ? items.find((item) => item.id === lastSelectedId) : undefined
  const monitoring = items.find((item) => item.id === 'monitoring')
  const target = keepCurrent ?? lastSelected ?? monitoring ?? items[0]

  if (target) {
    await useContentStore.getState().selectItem(target)
  }
}
