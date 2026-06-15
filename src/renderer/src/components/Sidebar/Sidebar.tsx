import React from 'react'
import { useContentStore } from '../../store/content'
import type { Section, ContentItem, Subsection } from '@shared/types'
import { ArrowPathIcon, ChevronRightIcon, SectionIcon, ToolIcon } from '../Icons'
import { KnowHubLogoMark } from '../Logo/KnowHubLogoMark'

const focusRow =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sidebar'

const BRAND_SUBTITLE = 'Сервисная служба'

const INSTRUCTIONS_SECTION_ID = 'instructions'

function SectionItem({ item, onSelect, isSelected }: {
  item: ContentItem
  onSelect: (item: ContentItem) => void
  isSelected: boolean
}): React.ReactElement {
  const tool = item.type === 'tool'
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`
        group relative w-full flex items-center rounded-lg text-[13px] text-left tracking-tight
        transition-colors duration-150 ease-out border-l-[3px] border-transparent
        ${tool ? 'gap-2.5 px-2.5 py-1.5' : 'gap-0 px-2.5 py-2'}
        ${focusRow}
        ${isSelected
          ? 'bg-tint-blue/15 text-label-primary border-tint-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
          : 'text-label-secondary hover:bg-white/[0.05] hover:text-label-primary'
        }
      `}
    >
      {tool && (
        <span className={`flex-shrink-0 ${isSelected ? 'text-tint-blue-hover' : 'text-label-primary/35'}`}>
          <ToolIcon name={item.icon} className="w-[14px] h-[14px]" />
        </span>
      )}
      <span className={`truncate ${tool ? '' : 'w-full font-normal'}`}>{item.title}</span>
      {!tool && isSelected && (
        <ChevronRightIcon className="w-3.5 h-3.5 shrink-0 text-label-tertiary/70" />
      )}
    </button>
  )
}

function SubsectionBlock({ subsection, selectedId, onSelect, isFirst }: {
  subsection: Subsection
  selectedId: string | null
  onSelect: (item: ContentItem) => void
  isFirst: boolean
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false)

  return (
    <div className={isFirst ? '' : 'mt-3 pt-3'}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] font-medium text-label-secondary hover:bg-white/[0.05] hover:text-label-primary transition-colors duration-150 ${focusRow}`}
      >
        <ChevronRightIcon
          className={`w-3 h-3 flex-shrink-0 opacity-60 transition-transform duration-200 ease-out ${collapsed ? '' : 'rotate-90'}`}
        />
        <span className="flex-1 text-left leading-snug">{subsection.title}</span>
      </button>
      {!collapsed && (
        <div className="mt-1.5 ml-1.5 pl-2.5 border-l border-surface-border space-y-0.5">
          {subsection.items.map((item) => (
            <SectionItem
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SectionGroup({ section, selectedId, onSelect }: {
  section: Section
  selectedId: string | null
  onSelect: (item: ContentItem) => void
}): React.ReactElement {
  const instructionsRefresh = useContentStore((s) => s.instructionsRefresh)

  return (
    <div
      className="mb-5 last:mb-0"
      aria-busy={section.id === INSTRUCTIONS_SECTION_ID && !!instructionsRefresh}
      aria-live={section.id === INSTRUCTIONS_SECTION_ID ? 'polite' : undefined}
    >
      <div className="flex items-center gap-2 px-2 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-label-tertiary">
        {section.id === INSTRUCTIONS_SECTION_ID && instructionsRefresh ? (
          <ArrowPathIcon className="w-4 h-4 flex-shrink-0 text-label-secondary opacity-80 animate-spin" />
        ) : (
          <SectionIcon name={section.icon} className="w-4 h-4 flex-shrink-0 opacity-80 text-label-secondary" />
        )}
        <span className="min-w-0 flex-1 truncate text-left leading-tight">{section.title}</span>
      </div>

      <div className={section.subsections?.length ? 'mt-2' : 'mt-2 space-y-1'}>
        {section.subsections?.length ? (
          section.subsections.map((sub, i) => (
            <SubsectionBlock
              key={sub.id}
              subsection={sub}
              selectedId={selectedId}
              onSelect={onSelect}
              isFirst={i === 0}
            />
          ))
        ) : (
          <>
            {(section.items ?? []).map((item) => (
              <SectionItem
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onSelect={onSelect}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export function Sidebar(): React.ReactElement {
  const manifest = useContentStore((s) => s.manifest)
  const selectedItem = useContentStore((s) => s.selectedItem)
  const selectItem = useContentStore((s) => s.selectItem)

  return (
    <aside className="flex flex-col h-full w-[268px] flex-shrink-0 bg-surface-sidebar border-r border-surface-border">
      <div className="px-3.5 pt-4 pb-3.5 border-surface-border drag-region shrink-0">
        <div className="flex items-center gap-3.5 no-drag">
          <KnowHubLogoMark className="h-[52px] w-[52px] shrink-0 text-white" />
          <div className="min-w-0 flex-1 flex flex-col gap-1" style={{zoom: 0.9}}>
            <div className="grid w-max max-w-full">
              <span
                aria-hidden
                className="col-start-1 row-start-1 invisible whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.13em] leading-tight"
              >
                {BRAND_SUBTITLE}
              </span>
              <span className="col-start-1 row-start-1 self-center font-brand text-[26px] font-bold leading-[1.05] tracking-[0.02em] text-white whitespace-nowrap">
                KnowHub
              </span>
            </div>
            <div className="text-[9px] font-medium uppercase tracking-[0.13em] leading-tight text-tint-blue whitespace-nowrap">
              {BRAND_SUBTITLE}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 scroll-smooth min-h-0">
        {manifest?.sections.map((section) => (
          <SectionGroup
            key={section.id}
            section={section}
            selectedId={selectedItem?.id ?? null}
            onSelect={selectItem}
          />
        ))}

        {!manifest && (
          <div className="px-3 py-12 text-center text-[13px] text-label-tertiary">
            Загрузка…
          </div>
        )}
      </nav>
    </aside>
  )
}
