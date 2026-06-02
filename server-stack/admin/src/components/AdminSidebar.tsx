import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ArticleMeta, Manifest, Section, Subsection, SectionTarget } from '../api'
import { useConfirm } from './ConfirmDialog'
import { PublishStatusDot } from './PublishStatusBadge'
import { toSlug } from '../utils'
import {
  CheckIcon,
  ChevronIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon
} from './AdminIcons'

type EditingState =
  | { kind: 'newDivision'; sectionId: string }
  | { kind: 'renameDivision'; sectionId: string; subsectionId: string }

const INSTRUCTIONS_SECTION_ID = 'instructions'

interface NavDivision {
  section: Section
  sub: Subsection | null
}

interface Props {
  selectedTarget: SectionTarget | null
  activeArticleId: string | null
  isDraftNew: boolean
  refreshKey: number
  onSelectTarget: (target: SectionTarget) => void
  onSelectArticle: (id: string) => void
  onNewArticle: () => void
}

function matchesQuery(text: string, q: string): boolean {
  return text.toLowerCase().includes(q)
}

function divisionExpandKey(sectionId: string, subsectionId: string | null): string {
  return subsectionId ? `${sectionId}/${subsectionId}` : sectionId
}

function flattenDivisions(manifest: Manifest): NavDivision[] {
  const items: NavDivision[] = []
  for (const section of manifest.sections) {
    if ((section.subsections?.length ?? 0) > 0) {
      for (const sub of section.subsections ?? []) {
        items.push({ section, sub })
      }
    } else {
      items.push({ section, sub: null })
    }
  }
  return items
}

export function AdminSidebar({
  selectedTarget,
  activeArticleId,
  isDraftNew,
  refreshKey,
  onSelectTarget,
  onSelectArticle,
  onNewArticle
}: Props): React.ReactElement {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [articles, setArticles] = useState<ArticleMeta[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [articlesLoading, setArticlesLoading] = useState(true)

  const query = search.trim().toLowerCase()
  const confirm = useConfirm()

  const loadManifest = useCallback(async () => {
    try {
      setManifest(await api.getManifest())
    } catch {
      setError('Не удалось загрузить разделы')
    }
  }, [])

  useEffect(() => { void loadManifest() }, [loadManifest])

  useEffect(() => {
    setArticlesLoading(true)
    api
      .listArticles()
      .then(setArticles)
      .catch(() => setError('Не удалось загрузить статьи'))
      .finally(() => setArticlesLoading(false))
  }, [refreshKey])

  const articlesForDivision = useCallback(
    (sectionId: string, subsectionId: string | null): ArticleMeta[] => {
      let list = articles.filter((a) => {
        if (a.sectionId !== sectionId) return false
        if (subsectionId) return a.subsectionId === subsectionId
        return !a.subsectionId
      })
      if (query) {
        list = list.filter(
          (a) => matchesQuery(a.title || '', query) || matchesQuery(a.htmlFile, query)
        )
      }
      return list.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    },
    [articles, query]
  )

  const navDivisions = useMemo(() => (manifest ? flattenDivisions(manifest) : []), [manifest])

  const primarySectionId = useMemo((): string | null => {
    if (!manifest) return null
    const instructions = manifest.sections.find((s) => s.id === INSTRUCTIONS_SECTION_ID)
    if (instructions && (instructions.subsections?.length ?? 0) > 0) return instructions.id
    const withSubs = manifest.sections.find((s) => (s.subsections?.length ?? 0) > 0)
    return withSubs?.id ?? manifest.sections[0]?.id ?? null
  }, [manifest])

  useEffect(() => {
    if (!manifest || articlesLoading) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const { section, sub } of flattenDivisions(manifest)) {
        const key = divisionExpandKey(section.id, sub?.id ?? null)
        const subId = sub?.id ?? ''
        const hasArticles = articles.some((a) => {
          if (a.sectionId !== section.id) return false
          return sub ? a.subsectionId === sub.id : !a.subsectionId
        })
        if (hasArticles || query) next.add(key)
      }
      return next
    })
  }, [manifest, articles, articlesLoading, query])

  const persist = async (updated: Manifest): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await api.updateManifest(updated)
      setManifest(updated)
    } catch {
      setError('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const toggleExpand = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const cancelEdit = (): void => {
    setEditing(null)
    setEditValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent, onEnter: () => void): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onEnter()
    } else if (e.key === 'Escape') cancelEdit()
  }

  const addDivision = async (sectionId: string): Promise<void> => {
    if (!manifest || !editValue.trim()) {
      cancelEdit()
      return
    }
    const subId = toSlug(editValue, 'sub')
    const title = editValue.trim()
    const section = manifest.sections.find((s) => s.id === sectionId)

    if (section && (section.subsections?.length ?? 0) >= 0) {
      await persist({
        ...manifest,
        sections: manifest.sections.map((s) =>
          s.id !== sectionId
            ? s
            : { ...s, subsections: [...(s.subsections ?? []), { id: subId, title, items: [] }] }
        )
      })
    } else {
      await persist({
        ...manifest,
        sections: [
          {
            id: INSTRUCTIONS_SECTION_ID,
            title: 'Инструкции',
            icon: 'book',
            subsections: [{ id: subId, title, items: [] }]
          },
          ...manifest.sections
        ]
      })
    }
    setExpanded((prev) => new Set([...prev, divisionExpandKey(sectionId, subId)]))
    cancelEdit()
  }

  const renameDivision = async (sectionId: string, subId: string): Promise<void> => {
    if (!manifest) {
      cancelEdit()
      return
    }
    await persist({
      ...manifest,
      sections: manifest.sections.map((s) =>
        s.id !== sectionId
          ? s
          : {
              ...s,
              subsections: (s.subsections ?? []).map((sub) =>
                sub.id !== subId ? sub : { ...sub, title: editValue.trim() || sub.title }
              )
            }
      )
    })
    cancelEdit()
  }

  const deleteDivision = async (
    sectionId: string,
    subId: string,
    subTitle: string
  ): Promise<void> => {
    if (!manifest) return
    const ok = await confirm({
      title: 'Удалить раздел?',
      message: `«${subTitle}» будет убран из навигации. Сохранённые статьи останутся в базе.`,
      variant: 'danger',
      confirmLabel: 'Удалить'
    })
    if (!ok) return
    await persist({
      ...manifest,
      sections: manifest.sections.map((s) =>
        s.id !== sectionId
          ? s
          : { ...s, subsections: (s.subsections ?? []).filter((sub) => sub.id !== subId) }
      )
    })
  }

  const handleDeleteArticle = async (id: string, title: string): Promise<void> => {
    const label = title || '(без заголовка)'
    const ok = await confirm({
      title: 'Удалить статью?',
      message: `«${label}» будет удалена без возможности восстановления.`,
      variant: 'danger',
      confirmLabel: 'Удалить'
    })
    if (!ok) return
    await api.deleteArticle(id)
    setArticles((list) => list.filter((x) => x.id !== id))
  }

  const selectDivision = ({ section, sub }: NavDivision): void => {
    const expandKey = divisionExpandKey(section.id, sub?.id ?? null)
    setExpanded((prev) => new Set([...prev, expandKey]))
    onSelectTarget({
      sectionId: section.id,
      sectionTitle: section.title,
      sectionIcon: section.icon ?? 'book',
      subsectionId: sub?.id,
      subsectionTitle: sub?.title
    })
  }

  const startNewArticleInDivision = (division: NavDivision): void => {
    selectDivision(division)
    onNewArticle()
  }

  const divisionMatchesSearch = useCallback(
    ({ section, sub }: NavDivision): boolean => {
      const title = sub?.title ?? section.title
      const subId = sub?.id ?? null
      if (!query) return true
      if (matchesQuery(title, query)) return true
      return articlesForDivision(section.id, subId).length > 0
    },
    [query, articlesForDivision]
  )

  const inputCls = 'admin-input-inline flex-1 min-w-0'
  const actionBtnCls = 'admin-btn-ghost !p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'

  const renderArticleRows = (division: NavDivision): React.ReactElement => {
    const { section, sub } = division
    const subsectionId = sub?.id ?? null
    const list = articlesForDivision(section.id, subsectionId)
    const showDraft =
      isDraftNew &&
      selectedTarget?.sectionId === section.id &&
      (sub ? selectedTarget.subsectionId === sub.id : !selectedTarget.subsectionId)

    return (
      <div className="ml-2 pl-2 pr-1 border-l border-surface-border/60 space-y-0.5 py-0.5">
        {articlesLoading && list.length === 0 && !showDraft && (
          <p className="px-2 py-1.5 text-[11px] text-label-tertiary">Загрузка…</p>
        )}
        {showDraft && (
          <div className="admin-article-nav admin-article-nav--nested admin-article-nav--active">
            <span className="w-2 h-2 shrink-0 rounded-full bg-tint-blue ring-1 ring-black/20" title="Новая статья" />
            <span className="truncate text-[12px] font-medium">Новая статья</span>
          </div>
        )}
        {list.map((a) => {
          const isActive = activeArticleId === a.id
          return (
            <div
              key={a.id}
              className={`group admin-article-nav admin-article-nav--nested ${isActive ? 'admin-article-nav--active' : ''}`}
              onClick={() => {
                selectDivision(division)
                onSelectArticle(a.id)
              }}
            >
              <PublishStatusDot
                published={a.published}
                updatedAt={a.updatedAt}
                publishedAt={a.publishedAt}
              />
              <span className="truncate text-[12px] font-medium text-label-primary flex-1 min-w-0">
                {a.title || '(без заголовка)'}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDeleteArticle(a.id, a.title)
                }}
                className="admin-btn-ghost shrink-0 opacity-0 group-hover:opacity-100 hover:!text-red-400 !p-1"
                title="Удалить"
              >
                <TrashIcon className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        {!articlesLoading && list.length === 0 && !showDraft && !query && sub && (
          <button
            type="button"
            onClick={() => startNewArticleInDivision(division)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] text-label-tertiary hover:text-tint-blue rounded-md hover:bg-sidebar-hover transition-colors"
          >
            <PlusIcon className="w-3 h-3" />
            Создать статью
          </button>
        )}
      </div>
    )
  }

  return (
    <aside className="admin-sidebar">
      <header className="admin-sidebar-brand shrink-0">
        <div className="text-[15px] font-semibold tracking-tight text-label-primary">KnowHub Admin</div>
        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-tint-blue">
          редактор инструкций
        </div>
      </header>

      <div className="admin-sidebar-search shrink-0">
        <SearchIcon className="w-4 h-4 shrink-0 text-label-tertiary" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск инструкций…"
          className="admin-sidebar-search-input"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="admin-btn-ghost !p-1 text-[11px] shrink-0"
            title="Очистить"
          >
            ✕
          </button>
        )}
      </div>

      {(saving || error) && (
        <div className="px-4 py-1 shrink-0 text-[11px]">
          {saving && <span className="text-label-tertiary">Сохранение…</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}

      <div className="admin-sidebar-scroll flex-1 min-h-0 overflow-y-auto">
        <div className="shrink-0 px-3 pt-2 pb-1">
          <p className="admin-section-label px-1">Инструкции</p>
        </div>

        <div className="pb-3">
          {!manifest ? (
            <div className="px-4 py-2 text-[12px] text-label-tertiary">Загрузка…</div>
          ) : (
            <>
              {navDivisions.map((division) => {
                if (!divisionMatchesSearch(division)) return null

                const { section, sub } = division
                if (!sub) {
                  const expandKey = divisionExpandKey(section.id, null)
                  const isExpanded = expanded.has(expandKey)
                  return (
                    <div key={expandKey} className="mb-1">
                      <div
                        className="group admin-nav-item admin-nav-item--idle"
                        onClick={() => toggleExpand(expandKey)}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleExpand(expandKey)
                          }}
                          className="text-label-tertiary shrink-0 -ml-0.5"
                        >
                          <ChevronIcon open={isExpanded} />
                        </button>
                        <span className="flex-1 text-[13px] font-medium truncate">{section.title}</span>
                      </div>
                      {isExpanded && renderArticleRows(division)}
                    </div>
                  )
                }

                const expandKey = divisionExpandKey(section.id, sub.id)
                const isExpanded = expanded.has(expandKey)
                const isRenaming =
                  editing?.kind === 'renameDivision' &&
                  editing.sectionId === section.id &&
                  editing.subsectionId === sub.id

                return (
                  <div key={expandKey} className="mb-0.5">
                    <div
                      className="group admin-nav-item admin-nav-item--idle"
                      onClick={() => toggleExpand(expandKey)}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleExpand(expandKey)
                        }}
                        className="text-label-tertiary shrink-0 -ml-0.5"
                        aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
                      >
                        <ChevronIcon open={isExpanded} />
                      </button>

                      {isRenaming ? (
                        <div className="flex-1 flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            className={inputCls}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) =>
                              handleKeyDown(e, () => void renameDivision(section.id, sub.id))
                            }
                            placeholder="Название"
                          />
                          <button
                            type="button"
                            onClick={() => void renameDivision(section.id, sub.id)}
                            className="text-tint-blue shrink-0"
                          >
                            <CheckIcon />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-[13px] font-medium truncate min-w-0">{sub.title}</span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              title="Новая статья"
                              onClick={(e) => {
                                e.stopPropagation()
                                startNewArticleInDivision(division)
                              }}
                              className={actionBtnCls}
                            >
                              <PlusIcon />
                            </button>
                            <button
                              type="button"
                              title="Переименовать"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditing({
                                  kind: 'renameDivision',
                                  sectionId: section.id,
                                  subsectionId: sub.id
                                })
                                setEditValue(sub.title)
                              }}
                              className={actionBtnCls}
                            >
                              <PencilIcon />
                            </button>
                            <button
                              type="button"
                              title="Удалить"
                              onClick={(e) => {
                                e.stopPropagation()
                                void deleteDivision(section.id, sub.id, sub.title)
                              }}
                              className={`${actionBtnCls} hover:!text-red-400`}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {isExpanded && renderArticleRows(division)}
                  </div>
                )
              })}

              {primarySectionId &&
                (editing?.kind === 'newDivision' && editing.sectionId === primarySectionId ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <input
                      autoFocus
                      className={`w-full ${inputCls}`}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, () => void addDivision(primarySectionId))}
                      placeholder="Название раздела"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void addDivision(primarySectionId)}
                        className="flex-1 rounded-md bg-tint-blue py-1.5 text-[11px] font-medium text-white hover:bg-tint-blue-hover"
                      >
                        Создать
                      </button>
                      <button type="button" onClick={cancelEdit} className="admin-btn-ghost text-[11px]">
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!primarySectionId) return
                      setEditing({ kind: 'newDivision', sectionId: primarySectionId })
                      setEditValue('')
                    }}
                    className="admin-sidebar-add-section"
                  >
                    <PlusIcon />
                    Добавить раздел
                  </button>
                ))}
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
