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
      id: 'fuel-calculator',
      title: 'Расчёт расхода топлива',
      type: 'tool',
      toolId: 'fuel-calculator',
      icon: 'fuel',
      version: 1
    },
    {
      id: 'winbox',
      title: 'WinBox и конфиги',
      type: 'tool',
      toolId: 'winbox',
      icon: 'router',
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

export { MIN_INSTRUCTIONS_REFRESH_MS }

export const useContentStore = create<ContentStore>((set) => ({
  manifest: null,
  selectedItem: null,
  articleHtml: null,
  loading: false,
  instructionsRefresh: null,

  setManifest: (manifest) => set({ manifest }),
  setInstructionsRefresh: (instructionsRefresh) => set({ instructionsRefresh }),

  selectItem: async (item) => {
    set({ selectedItem: item, articleHtml: null, loading: true })

    if (item.type === 'tool') {
      set({ loading: false })
      return
    }

    if (!item.htmlFile) {
      set({ loading: false })
      return
    }

    const html = window.api ? await window.api.getArticleHtml(item.htmlFile) : null

    set({ articleHtml: html ?? '<p>Статья не найдена.</p>', loading: false })
  }
}))

export async function initContentStore(): Promise<void> {
  let manifest: ContentManifest | null = null

  if (window.api) {
    manifest = await window.api.getManifest()
  }

  if (!manifest) {
    manifest = MOCK_MANIFEST
  }

  useContentStore.getState().setManifest(withTools(manifest))

  const firstItem = flattenManifestItems(manifest)[0]
  if (firstItem) {
    await useContentStore.getState().selectItem(firstItem)
  }
}
