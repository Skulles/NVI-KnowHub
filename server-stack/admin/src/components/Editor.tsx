import React, { useCallback, useEffect, useRef, useState, useReducer } from 'react'
import {
  BlockNoteSchema,
  createBlockSpec,
  defaultBlockSpecs,
  defaultStyleSpecs,
  filterSuggestionItems,
  insertOrUpdateBlock
} from '@blocknote/core'
import '@blocknote/core/fonts/inter.css'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import {
  useCreateBlockNote,
  getDefaultReactSlashMenuItems,
  FormattingToolbarController,
  SuggestionMenuController,
  SideMenuController,
  type DefaultReactSuggestionItem
} from '@blocknote/react'
import { AdminFormattingToolbar } from './AdminFormattingToolbar'
import { AdminSlashMenu } from './AdminSlashMenu'
import { TableCellContextMenu } from './TableCellContextMenu'
import { api, ArticleDraft, SectionTarget } from '../api'
import { PublishDialog } from './PublishDialog'
import { PublishStatusBadge } from './PublishStatusBadge'
import { titleToHtmlFile } from '../utils'
import { ensureTableHeaderRows } from '../lib/ensure-table-header-rows'
import { CodeBlockKeyboardExtension } from '../lib/code-block-keyboard-extension'
import { CodeBlockPasteExtension } from '../lib/code-block-paste-extension'
import { TableCellAlignmentExtension } from '../lib/table-cell-alignment-extension'
import {
  applyTableCellAlignments,
  extractTableAlignmentsFromBlocks,
  mergeTableAlignmentsIntoBlocks,
  normalizeTableBlocksForEditor,
} from '../lib/table-cell-alignment'
import { appendAlertCalloutChrome, type AlertCalloutVariant } from '../lib/callout-html'
import { CodeBlock } from '../lib/code-block-spec'
import { CodeHintStyle } from '../lib/code-hint-style'
import { XMarkIcon } from './AdminIcons'

const CALLOUT_CLASS: Record<string, string> = {
  info: 'article-callout',
  warning: 'article-callout article-callout--warning',
  important: 'article-callout article-callout--important'
}

const Callout = createBlockSpec(
  {
    type: 'callout',
    propSchema: {
      variant: { default: 'info' as const }
    },
    content: 'inline'
  },
  {
    render: (block) => {
      const v = (block.props.variant ?? 'info') as string
      const outer = document.createElement('blockquote')
      outer.className = CALLOUT_CLASS[v] ?? CALLOUT_CLASS.info

      if (v === 'warning' || v === 'important') {
        const inner = appendAlertCalloutChrome(outer, v as AlertCalloutVariant)
        return { dom: outer, contentDOM: inner }
      }

      const inner = document.createElement('div')
      inner.className = 'min-h-[1.25em]'
      outer.appendChild(inner)

      return { dom: outer, contentDOM: inner }
    }
  }
)

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: Callout, codeBlock: CodeBlock },
  styleSpecs: { ...defaultStyleSpecs, codeHint: CodeHintStyle },
})

type EditorT = typeof schema.BlockNoteEditor

function getEditorBlocks(ed: EditorT): unknown[] {
  return mergeTableAlignmentsIntoBlocks(ed.document as unknown[], ed)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function normalizeUploadDataUrl(file: File, dataUrl: string): string {
  if (
    file.name.toLowerCase().endsWith('.mp4') &&
    dataUrl.startsWith('data:application/octet-stream;base64,')
  ) {
    return dataUrl.replace('data:application/octet-stream;base64,', 'data:video/mp4;base64,')
  }
  return dataUrl
}

const ITEM_RENAMES: Record<string, { title: string; group: string } | null> = {
  'Paragraph':       null,
  'Heading 1':       null,
  'Heading 2':       null,
  'Heading 3':       { title: 'Подзаголовок',          group: 'Основные' },
  'Emoji':           null,
  'Bullet List':     { title: 'Маркированный список',  group: 'Списки'   },
  'Numbered List':   { title: 'Нумерованный список',   group: 'Списки'   },
  'Check List':      null,
  'To-do List':      null,
  'Table':           { title: 'Таблица',               group: 'Вставка'  },
  'Image':           { title: 'Изображение',           group: 'Вставка'  },
  'Video':           { title: 'Видео MP4',             group: 'Вставка'  },
  'Audio':           null,
  'File':            null,
}

function cleanSlashMenuItem(item: DefaultReactSuggestionItem): DefaultReactSuggestionItem {
  const { icon: _icon, subtext: _subtext, badge: _badge, ...rest } = item
  return rest
}

interface Props {
  draftId: string | null
  targetSection: SectionTarget | null
  onTargetLoaded: (target: SectionTarget) => void
  onBack: () => void
  onSaved: (id: string) => void
}

function newArticleId(): string {
  return `article-${Date.now()}`
}

export function Editor({ draftId, targetSection, onTargetLoaded, onBack, onSaved }: Props): React.ReactElement {
  const [title, setTitle] = useState('')
  const [lead, setLead] = useState('')
  const [published, setPublished] = useState(false)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [htmlFile, setHtmlFile] = useState('')
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const currentIdRef = useRef<string | null>(draftId ?? newArticleId())
  const hydrationRef = useRef(!!draftId)
  const debounceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef<() => Promise<string>>(async () => '')
  const saveInFlightRef = useRef<Promise<string> | null>(null)
  const dirtyRef = useRef(!draftId)
  const publishGuardUntilRef = useRef(0)
  const tableHeaderFixRef = useRef(false)
  const editorZoneRef = useRef<HTMLDivElement>(null)

  const isAutosaveBlocked = (): boolean =>
    hydrationRef.current || Date.now() < publishGuardUntilRef.current

  const applySaveMeta = useCallback((meta: {
    htmlFile: string
    published: boolean
    publishedAt: string | null
    updatedAt: string
    hasUnpublishedChanges: boolean
  }): void => {
    setHtmlFile(meta.htmlFile)
    setPublished(meta.published)
    setPublishedAt(meta.publishedAt)
    setUpdatedAt(meta.updatedAt)
    setHasUnpublishedChanges(meta.hasUnpublishedChanges)
  }, [])

  const scheduleDebouncedSave = useCallback((): void => {
    if (isAutosaveBlocked() || !dirtyRef.current) return
    if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current)
    debounceSaveRef.current = setTimeout(() => {
      debounceSaveRef.current = null
      saveRef.current().catch(console.error)
    }, 1200)
  }, [])

  const editor = useCreateBlockNote({
    schema,
    uploadFile: async (file: File): Promise<string> => {
      const isUnsupportedVideo =
        file.type.startsWith('video/') &&
        file.type !== 'video/mp4' &&
        !file.name.toLowerCase().endsWith('.mp4')
      if (isUnsupportedVideo) {
        throw new Error('Поддерживаются только MP4-видео')
      }
      const dataUrl = normalizeUploadDataUrl(file, await fileToDataUrl(file))
      const result = await api.uploadFile(dataUrl)
      return result.url
    },
    _tiptapOptions: {
      extensions: [
        TableCellAlignmentExtension,
        CodeBlockKeyboardExtension,
        CodeBlockPasteExtension
      ],
    },
  })

  useEffect(() => {
    if (!draftId) {
      hydrationRef.current = false
      currentIdRef.current = newArticleId()
      dirtyRef.current = true
      setPublished(false)
      setPublishedAt(null)
      setUpdatedAt(null)
      setHtmlFile('')
      setHasUnpublishedChanges(false)
      return
    }
    hydrationRef.current = true
    dirtyRef.current = false
    currentIdRef.current = draftId
    api
      .getArticle(draftId)
      .then((draft: ArticleDraft) => {
        setTitle(draft.title)
        setLead(draft.lead ?? '')
        applySaveMeta({
          htmlFile: draft.htmlFile,
          published: draft.published,
          publishedAt: draft.publishedAt,
          updatedAt: draft.updatedAt,
          hasUnpublishedChanges: draft.hasUnpublishedChanges
        })
        if (draft.sectionId) {
          onTargetLoaded({
            sectionId: draft.sectionId,
            sectionTitle: draft.sectionTitle,
            sectionIcon: draft.sectionIcon || 'book',
            subsectionId: draft.subsectionId || undefined,
            subsectionTitle: draft.subsectionTitle || undefined
          })
        }
        if (draft.blocks?.length) {
          const alignMeta = extractTableAlignmentsFromBlocks(draft.blocks)
          const normalized = normalizeTableBlocksForEditor(draft.blocks)
          editor.replaceBlocks(
            editor.document,
            normalized as Parameters<typeof editor.replaceBlocks>[1]
          )
          requestAnimationFrame(() => {
            ensureTableHeaderRows(editor)
            applyTableCellAlignments(editor, alignMeta)
          })
        }
      })
      .catch(console.error)
      .finally(() => {
        setTimeout(() => {
          hydrationRef.current = false
        }, 0)
      })
  }, [draftId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current)
    },
    []
  )

  const save = useCallback(async (): Promise<string> => {
    if (saveInFlightRef.current) return saveInFlightRef.current
    if (!dirtyRef.current && currentIdRef.current) {
      setStatus('Сохранено')
      setTimeout(() => setStatus(null), 2000)
      return currentIdRef.current
    }

    const request = (async (): Promise<string> => {
      setSaving(true)
      try {
        const section = targetSection ?? { sectionId: '', sectionTitle: '', sectionIcon: 'book' }
        const result = await api.saveArticle({
          id: currentIdRef.current,
          title,
          lead,
          blocks: getEditorBlocks(editor),
          sectionId: section.sectionId,
          sectionTitle: section.sectionTitle,
          sectionIcon: section.sectionIcon,
          subsectionId: section.subsectionId ?? '',
          subsectionTitle: section.subsectionTitle ?? ''
        })
        currentIdRef.current = result.id
        dirtyRef.current = false
        applySaveMeta(result)
        setStatus('Сохранено')
        setTimeout(() => setStatus(null), 2000)
        onSaved(result.id)
        return result.id
      } catch (e) {
        const message = (e as Error).message
        setStatus(message.includes('Unauthorized') ? 'Сессия истекла — войдите снова' : `Ошибка: ${message}`)
        throw e
      } finally {
        setSaving(false)
      }
    })()

    saveInFlightRef.current = request
    try {
      return await request
    } finally {
      if (saveInFlightRef.current === request) saveInFlightRef.current = null
    }
  }, [title, lead, targetSection, editor, onSaved, applySaveMeta])

  saveRef.current = save

  useEffect(() => {
    return editor.onChange(() => {
      forceUpdate()
      if (!hydrationRef.current && !tableHeaderFixRef.current) {
        dirtyRef.current = true
        tableHeaderFixRef.current = true
        requestAnimationFrame(() => {
          tableHeaderFixRef.current = false
          ensureTableHeaderRows(editor)
        })
      }
      scheduleDebouncedSave()
    })
  }, [editor, scheduleDebouncedSave])

  useEffect(() => {
    if (!isAutosaveBlocked()) dirtyRef.current = true
    scheduleDebouncedSave()
  }, [title, lead, scheduleDebouncedSave])

  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current) save().catch(console.error)
    }, 30_000)
    return () => clearInterval(interval)
  }, [save])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        save().catch(console.error)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [save])

  const handlePublish = async (): Promise<void> => {
    setShowPublishDialog(false)
    setPublishing(true)
    try {
      if (debounceSaveRef.current) {
        clearTimeout(debounceSaveRef.current)
        debounceSaveRef.current = null
      }
      const id = await save()
      const result = await api.publishArticle(id)
      publishGuardUntilRef.current = Date.now() + 3000
      const fresh = await api.getArticle(id)
      dirtyRef.current = false
      applySaveMeta({
        htmlFile: result.htmlFile ?? fresh.htmlFile,
        published: fresh.published,
        publishedAt: fresh.publishedAt,
        updatedAt: fresh.updatedAt,
        hasUnpublishedChanges: fresh.hasUnpublishedChanges
      })
      setStatus('Опубликовано!')
      setTimeout(() => setStatus(null), 3000)
      onSaved(id)
    } catch (e) {
      setStatus(`Ошибка: ${(e as Error).message}`)
    } finally {
      setPublishing(false)
    }
  }

  const getSlashMenuItems = useCallback((ed: EditorT) => {
    const defaults = getDefaultReactSlashMenuItems(ed)
    const translated = defaults.flatMap((item) => {
      const key = (item as DefaultReactSuggestionItem & { key?: string }).key
      if (key === 'emoji' || key === 'paragraph' || key === 'check_list' || key === 'heading_2') return []
      const rename = ITEM_RENAMES[item.title]
      if (rename === null) return []

      if (key === 'table') {
        return [
          cleanSlashMenuItem({
            ...item,
            title: 'Таблица',
            group: 'Вставка',
            onItemClick: () => {
              insertOrUpdateBlock(ed, {
                type: 'table',
                content: {
                  type: 'tableContent',
                  rows: [
                    { cells: ['Столбец 1', 'Столбец 2', 'Столбец 3'] },
                    { cells: ['', '', ''] },
                    { cells: ['', '', ''] }
                  ]
                }
              })
              requestAnimationFrame(() => ensureTableHeaderRows(ed))
            }
          })
        ]
      }

      const next = rename === undefined ? item : { ...item, ...rename }
      return [cleanSlashMenuItem(next)]
    })
    return [
      ...translated,
      cleanSlashMenuItem({
        title: 'Блок кода',
        onItemClick: () => insertOrUpdateBlock(ed, { type: 'codeBlock' }),
        aliases: ['code', 'код', 'pre', 'блок кода', 'codeblock'],
        group: 'Вставка'
      }),
      cleanSlashMenuItem({
        title: 'Заметка',
        onItemClick: () => insertOrUpdateBlock(ed, { type: 'callout', props: { variant: 'info' } }),
        aliases: ['callout', 'note', 'заметка', 'info'],
        group: 'Специальные'
      }),
      cleanSlashMenuItem({
        title: 'Внимание',
        onItemClick: () => insertOrUpdateBlock(ed, { type: 'callout', props: { variant: 'warning' } }),
        aliases: ['warning', 'warn', 'внимание', 'предупреждение'],
        group: 'Специальные'
      }),
      cleanSlashMenuItem({
        title: 'Важно',
        onItemClick: () => insertOrUpdateBlock(ed, { type: 'callout', props: { variant: 'important' } }),
        aliases: ['important', 'danger', 'важно'],
        group: 'Специальные'
      })
    ]
  }, [])

  const articleId = currentIdRef.current ?? newArticleId()
  const previewHtmlFile = htmlFile || titleToHtmlFile(title, articleId)
  const canPublish = !!targetSection?.sectionId && (hasUnpublishedChanges || !published)
  const publishLabel = publishing
    ? 'Публикация…'
    : published && hasUnpublishedChanges
      ? 'Опубликовать изменения'
      : published
        ? 'Актуально'
        : 'Опубликовать'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="admin-toolbar sticky top-0 z-10">
        <button type="button" onClick={onBack} className="admin-btn-ghost" title="Закрыть редактор">
          <XMarkIcon />
        </button>

        <nav className="admin-breadcrumb min-w-0 max-w-[min(100%,28rem)]" aria-label="Путь">
          {targetSection?.sectionTitle ? (
            <>
              <span className="truncate">{targetSection.sectionTitle}</span>
              {targetSection.subsectionTitle && (
                <>
                  <span className="admin-breadcrumb-sep" aria-hidden>›</span>
                  <span className="truncate">{targetSection.subsectionTitle}</span>
                </>
              )}
              <span className="admin-breadcrumb-sep" aria-hidden>›</span>
              <span className="admin-breadcrumb-current truncate" title={title || 'Новая статья'}>
                {title.trim() || 'Новая статья'}
              </span>
            </>
          ) : (
            <span className="text-amber-500/90 truncate">Выберите раздел в каталоге</span>
          )}
        </nav>

        <PublishStatusBadge
          published={published}
          updatedAt={updatedAt}
          publishedAt={publishedAt}
        />

        <div className="flex-1" />

        {updatedAt && (
          <span className="hidden lg:inline text-[11px] text-label-tertiary font-mono truncate max-w-[10rem]" title={previewHtmlFile}>
            {previewHtmlFile}
          </span>
        )}

        {status && <span className="text-[12px] text-label-tertiary">{status}</span>}

        <button
          type="button"
          onClick={() => save().catch(console.error)}
          disabled={saving}
          className="admin-btn-secondary"
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button
          type="button"
          onClick={() => setShowPublishDialog(true)}
          disabled={publishing || !canPublish}
          className="admin-btn-primary"
          title={!canPublish && published ? 'Нет изменений для публикации' : undefined}
        >
          {publishLabel}
        </button>
      </div>

      <div className="app-preview flex-1 overflow-y-auto pb-20">
        <div className="mx-auto w-full max-w-[58rem] px-6 py-12 sm:px-10 sm:py-14">
          <header className="mb-9 px-0.5">
            {published && publishedAt && (
              <p className="article-publish-meta mb-3 text-[12px] text-label-tertiary">
                {hasUnpublishedChanges ? (
                  <>
                    В приложении — версия от{' '}
                    <time dateTime={publishedAt}>{new Date(publishedAt).toLocaleString('ru')}</time>
                    . Сохранённые правки ещё не опубликованы.
                  </>
                ) : (
                  <>
                    Опубликовано{' '}
                    <time dateTime={publishedAt}>{new Date(publishedAt).toLocaleString('ru')}</time>
                  </>
                )}
              </p>
            )}
            <input
              className="app-preview__title w-full bg-transparent placeholder:text-label-tertiary focus:outline-none focus:ring-0"
              placeholder="Заголовок статьи"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="app-preview__lead w-full bg-transparent placeholder:text-label-tertiary focus:outline-none focus:ring-0"
              placeholder="Краткое описание (лид-абзац, необязательно)"
              value={lead}
              onChange={(e) => setLead(e.target.value)}
            />
          </header>

          <div ref={editorZoneRef} className="article-body article-content max-w-none article-editor">
            <BlockNoteView editor={editor} theme="dark" slashMenu={false} sideMenu={false} formattingToolbar={false}>
              <FormattingToolbarController formattingToolbar={AdminFormattingToolbar} />
              <SideMenuController />
              <SuggestionMenuController
                triggerCharacter="/"
                suggestionMenuComponent={AdminSlashMenu}
                getItems={async (query) => filterSuggestionItems(getSlashMenuItems(editor), query)}
              />
            </BlockNoteView>
            <TableCellContextMenu editor={editor} containerRef={editorZoneRef} />
          </div>
        </div>
      </div>

      {showPublishDialog && (
        <PublishDialog
          target={targetSection}
          articleId={articleId}
          title={title}
          isRepublish={published}
          onConfirm={() => { void handlePublish() }}
          onClose={() => setShowPublishDialog(false)}
        />
      )}
    </div>
  )
}
