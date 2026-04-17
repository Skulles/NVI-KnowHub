import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  type ArticleDraft,
  type AudienceKind,
  type KnowledgeArticle,
  type KnowledgeSection,
  TOOLS_SECTION_ID,
} from '../../entities/knowledge/types'
import { knowledgeBase } from '../../shared/lib/content/knowledge'
import { useFormErrorToast } from '../../shared/hooks/useFormErrorToast'
import {
  CustomSelect,
  type CustomSelectOption,
} from '../../shared/ui/CustomSelect'
import { BlockBodyEditor } from './BlockBodyEditor'

const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function parseDoc(json: string) {
  try {
    return JSON.parse(json) as { content?: unknown[] }
  } catch {
    return EMPTY_DOC
  }
}

type ContentBlock = {
  id: string
  title: string
  /** Документ TipTap для тела блока (без заголовка статьи). */
  bodyJson: string
}

function createBlock(title: string, bodyNodes: unknown[]): ContentBlock {
  return {
    id: crypto.randomUUID(),
    title,
    bodyJson: JSON.stringify({
      type: 'doc',
      content:
        bodyNodes.length > 0 ? bodyNodes : [{ type: 'paragraph', content: [] }],
    }),
  }
}

function newBlock(): ContentBlock {
  return createBlock('', [])
}

function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return ''
  }
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (n.type === 'hardBreak') {
    return '\n'
  }
  if (n.type === 'text' && typeof n.text === 'string') {
    return n.text
  }
  if (Array.isArray(n.content)) {
    return n.content.map(extractText).join('')
  }
  return ''
}

/** Узел считается содержательным и без текста (картинка, таблица, видео и т.д.). */
function nodeHasRenderableContent(node: unknown): boolean {
  if (!node || typeof node !== 'object') {
    return false
  }
  const n = node as { type?: string; content?: unknown[] }
  const t = n.type
  if (t === 'image' || t === 'video' || t === 'table' || t === 'horizontalRule') {
    return true
  }
  if (t === 'callout') {
    return Array.isArray(n.content) && n.content.some(nodeHasRenderableContent)
  }
  if (
    t === 'bulletList' ||
    t === 'orderedList' ||
    t === 'blockquote' ||
    t === 'codeBlock'
  ) {
    return Array.isArray(n.content) && n.content.length > 0
  }
  if (extractText(node).trim().length > 0) {
    return true
  }
  if (Array.isArray(n.content)) {
    return n.content.some(nodeHasRenderableContent)
  }
  return false
}

function blocksFromDoc(doc: { content?: unknown[] }): ContentBlock[] {
  const content = doc.content ?? []
  const blocks: ContentBlock[] = []

  let currentTitle = ''
  let bodyNodes: unknown[] = []

  function flush() {
    if (!currentTitle.trim() && bodyNodes.length === 0) {
      return
    }
    blocks.push(createBlock(currentTitle, bodyNodes))
    currentTitle = ''
    bodyNodes = []
  }

  for (const node of content) {
    if (!node || typeof node !== 'object') {
      continue
    }
    const n = node as { type?: string; attrs?: { level?: number } }
    if (n.type === 'heading' && n.attrs?.level === 2) {
      flush()
      currentTitle = extractText(node).trim()
      bodyNodes = []
    } else {
      bodyNodes.push(node)
    }
  }
  flush()

  if (blocks.length > 0) {
    return blocks
  }

  if (content.length === 0) {
    return []
  }

  return [createBlock('', [...content])]
}

function blocksFromContentJson(json: string): ContentBlock[] {
  return blocksFromDoc(parseDoc(json))
}

function buildArticleContent(blocks: ContentBlock[]): {
  contentJson: string
  contentText: string
} {
  const nodes: Record<string, unknown>[] = []
  const textParts: string[] = []

  for (const b of blocks) {
    const title = b.title.trim()
    let inner: unknown[] = []
    try {
      const doc = JSON.parse(b.bodyJson) as { content?: unknown[] }
      inner = doc.content ?? []
    } catch {
      inner = []
    }

    const hasBodyText = inner.some((node) => nodeHasRenderableContent(node))

    if (!title && !hasBodyText) {
      continue
    }

    if (title) {
      nodes.push({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: title }],
      })
      textParts.push(title)
    }

    if (hasBodyText) {
      for (const raw of inner) {
        nodes.push(JSON.parse(JSON.stringify(raw)) as Record<string, unknown>)
        const t = extractText(raw).trim()
        if (t) {
          textParts.push(t)
        }
      }
    } else if (title) {
      nodes.push({ type: 'paragraph', content: [] })
    }
  }

  if (nodes.length === 0) {
    return {
      contentJson: JSON.stringify(EMPTY_DOC),
      contentText: '',
    }
  }

  return {
    contentJson: JSON.stringify({ type: 'doc', content: nodes }),
    contentText: textParts.join('\n\n'),
  }
}

function hasBlockBodyContent(bodyJson: string): boolean {
  try {
    const doc = JSON.parse(bodyJson) as { content?: unknown[] }
    const inner = doc.content ?? []
    return inner.some((node) => nodeHasRenderableContent(node))
  } catch {
    return false
  }
}

function blockIsEmpty(b: ContentBlock): boolean {
  return !b.title.trim() && !hasBlockBodyContent(b.bodyJson)
}

function blockIsComplete(b: ContentBlock): boolean {
  return Boolean(b.title.trim() && hasBlockBodyContent(b.bodyJson))
}

/** Блок частично заполнен: есть только название или только содержимое. */
function blockIsPartial(b: ContentBlock): boolean {
  if (blockIsEmpty(b)) {
    return false
  }
  return !blockIsComplete(b)
}

function validateArticleForSave(
  mainTitle: string,
  blocks: ContentBlock[],
): string | null {
  if (!mainTitle.trim()) {
    return 'Введите заголовок статьи'
  }
  if (blocks.length === 0) {
    return 'Добавьте хотя бы один блок'
  }
  if (blocks.some(blockIsPartial)) {
    return 'У каждого блока должны быть заполнены название и содержимое'
  }
  if (!blocks.some(blockIsComplete)) {
    return 'Добавьте хотя бы один блок с названием и содержимым'
  }
  return null
}

/** Тип материала по контурам (один select вместо двух чипов). */
type AudiencePreset = 'bu' | 'tkrs' | 'both'

function audiencePresetFromFlags(forBu: boolean, forTkrs: boolean): AudiencePreset {
  if (forBu && forTkrs) {
    return 'both'
  }
  if (forBu) {
    return 'bu'
  }
  if (forTkrs) {
    return 'tkrs'
  }
  return 'both'
}

function audienceFlags(preset: AudiencePreset): {
  forBu: boolean
  forTkrs: boolean
} {
  switch (preset) {
    case 'bu':
      return { forBu: true, forTkrs: false }
    case 'tkrs':
      return { forBu: false, forTkrs: true }
    case 'both':
      return { forBu: true, forTkrs: true }
  }
}

const AUDIENCE_PRESET_OPTIONS: CustomSelectOption<AudiencePreset>[] = [
  { value: 'bu', label: 'Буровая' },
  { value: 'tkrs', label: 'ТКРС' },
  { value: 'both', label: 'Буровая / ТКРС' },
]

type AddArticleFormProps =
  | {
      mode: 'create'
      sections: KnowledgeSection[]
      defaultAudience: AudienceKind
      onClose: () => void
      onCreated: (article: KnowledgeArticle) => void
    }
  | {
      mode: 'edit'
      sections: KnowledgeSection[]
      defaultAudience: AudienceKind
      article: KnowledgeArticle
      draft: ArticleDraft | null
      onClose: () => void
      onSaveDraft: (payload: ArticleDraft) => Promise<void>
      /** Удалить статью из локальной БД (иконка в футере рядом с «Сохранить») */
      onDeleteArticle?: (articleId: string) => Promise<void>
    }

export function AddArticleForm(props: AddArticleFormProps) {
  const isEdit = props.mode === 'edit'
  const article = isEdit ? props.article : null
  const draft = isEdit ? props.draft : null
  const onDeleteArticle =
    isEdit && 'onDeleteArticle' in props ? props.onDeleteArticle : undefined

  const { sections, defaultAudience, onClose } = props

  const sectionLabelId = useId()
  const audienceLabelId = useId()

  const articleSections = useMemo(
    () => sections.filter((s) => s.id !== TOOLS_SECTION_ID),
    [sections],
  )

  const sectionSelectOptions = useMemo(
    () => articleSections.map((s) => ({ value: s.id, label: s.title })),
    [articleSections],
  )

  const [title, setTitle] = useState(() =>
    isEdit && article ? (draft?.title ?? article.title) : '',
  )
  const [summary, setSummary] = useState(() =>
    isEdit && article ? (draft?.summary ?? article.summary) : '',
  )
  const [blocks, setBlocks] = useState<ContentBlock[]>(() =>
    isEdit && article
      ? blocksFromContentJson(draft?.contentJson ?? article.contentJson)
      : [],
  )
  const [sectionId, setSectionId] = useState(() =>
    isEdit && article
      ? (draft?.sectionId ?? article.sectionId)
      : (articleSections[0]?.id ?? ''),
  )
  const [audiencePreset, setAudiencePreset] = useState<AudiencePreset>(() => {
    if (isEdit && article) {
      return audiencePresetFromFlags(
        draft?.forBu ?? article.forBu,
        draft?.forTkrs ?? article.forTkrs,
      )
    }
    if (defaultAudience === 'bu') {
      return 'bu'
    }
    if (defaultAudience === 'tkrs') {
      return 'tkrs'
    }
    return 'both'
  })
  const { toast, showErrorToast, dismissErrorToast } = useFormErrorToast()
  const [isSaving, setIsSaving] = useState(false)
  const [deleteArticleDialogOpen, setDeleteArticleDialogOpen] = useState(false)

  useEffect(() => {
    if (!isEdit || !article) {
      return
    }

    let cancelled = false

    void (async () => {
      const resolvedContentJson = draft
        ? await knowledgeBase.resolveDraftContent(draft.contentJson)
        : await knowledgeBase.resolveArticleContent(article.contentJson)

      if (cancelled) {
        return
      }

      setTitle(draft?.title ?? article.title)
      setSummary(draft?.summary ?? article.summary)
      setBlocks(blocksFromContentJson(resolvedContentJson))
      setSectionId(draft?.sectionId ?? article.sectionId)
      setAudiencePreset(
        audiencePresetFromFlags(
          draft?.forBu ?? article.forBu,
          draft?.forTkrs ?? article.forTkrs,
        ),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [isEdit, article, draft])

  useEffect(() => {
    if (isEdit) {
      return
    }
    setSectionId(articleSections[0]?.id ?? '')
  }, [isEdit, articleSections])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }
      if (deleteArticleDialogOpen) {
        event.preventDefault()
        event.stopPropagation()
        setDeleteArticleDialogOpen(false)
        return
      }
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, deleteArticleDialogOpen])

  function addBlock() {
    setBlocks((prev) => [...prev, newBlock()])
  }

  function updateBlock(
    id: string,
    patch: Partial<Pick<ContentBlock, 'title' | 'bodyJson'>>,
  ) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    )
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault()
    dismissErrorToast()

    if (props.mode !== 'create') {
      return
    }

    if (!sectionId) {
      showErrorToast('В базе нет разделов для размещения статьи.')
      return
    }

    const validationError = validateArticleForSave(title, blocks)
    if (validationError) {
      showErrorToast(validationError)
      return
    }

    setIsSaving(true)

    const { contentJson, contentText } = buildArticleContent(blocks)
    const { forBu, forTkrs } = audienceFlags(audiencePreset)

    try {
      const created = await knowledgeBase.createArticle({
        title,
        summary: summary.trim() || undefined,
        sectionId,
        contentJson,
        contentText,
        forBu,
        forTkrs,
      })
      props.onCreated(created)
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : 'Не удалось создать статью.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveDraft() {
    if (props.mode !== 'edit' || !article) {
      return
    }

    dismissErrorToast()

    if (!sectionId) {
      showErrorToast('Выберите раздел.')
      return
    }

    const trimmed = title.trim()
    const validationError = validateArticleForSave(trimmed, blocks)
    if (validationError) {
      showErrorToast(validationError)
      return
    }

    setIsSaving(true)

    const summaryTrimmed = summary.trim()
    const summaryToSave = summaryTrimmed
      ? summaryTrimmed.slice(0, 240)
      : trimmed
        ? trimmed.slice(0, 240)
        : article.summary.slice(0, 240)

    const { contentJson, contentText } = buildArticleContent(blocks)
    const { forBu, forTkrs } = audienceFlags(audiencePreset)

    try {
      await props.onSaveDraft({
        articleId: article.id,
        slug: article.slug,
        title: trimmed || article.title,
        summary: summaryToSave,
        contentJson,
        contentText,
        updatedAt: new Date().toISOString(),
        sectionId,
        forBu,
        forTkrs,
      })
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : 'Не удалось сохранить черновик.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const dialogLabel =
    isEdit ? 'Редактирование материала' : 'Добавить материал'

  if (articleSections.length === 0 && !isEdit) {
    return (
      <div
        aria-label={dialogLabel}
        aria-modal="true"
        className="add-article-panel"
        role="dialog"
      >
        <div className="add-article-panel__body">
          <p className="add-article-panel__error">
            В базе нет разделов. Сначала задайте разделы в snapshot базы знаний.
          </p>
        </div>
        <div className="add-article-panel__actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        aria-label={dialogLabel}
        aria-modal="true"
        className="add-article-panel"
        role="dialog"
      >
        <form
          className="add-article-panel__form"
          onSubmit={isEdit ? (e) => e.preventDefault() : handleCreateSubmit}
        >
          <div className="add-article-panel__body">
            <div className="add-article-panel__intro">
              <label className="add-article-panel__intro-field">
                <span className="visually-hidden">Заголовок</span>
                <input
                  autoFocus={!isEdit}
                  className="add-article-panel__title-input"
                  placeholder="Заголовок"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="add-article-panel__intro-field">
                <span className="visually-hidden">Описание</span>
                <textarea
                  className="add-article-panel__summary-input"
                  placeholder="Краткое описание"
                  rows={2}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
            </div>

            {blocks.length > 0 ? (
              <nav
                aria-label="Содержание статьи"
                className="add-article-panel__toc"
              >
                <p className="add-article-panel__toc-heading">Содержание</p>
                <ul className="add-article-panel__toc-list">
                  {blocks.map((block, index) => (
                    <li key={block.id}>
                      <a
                        className="add-article-panel__toc-link"
                        href={`#article-block-${block.id}`}
                      >
                        {block.title.trim() || `Блок ${index + 1}`}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}

            <div className="add-article-panel__blocks">
            {blocks.map((block) => (
              <div
                key={block.id}
                className="add-article-panel__content-block"
                id={`article-block-${block.id}`}
              >
                <div className="add-article-panel__content-block-head">
                  <label className="add-article-panel__intro-field">
                    <span className="visually-hidden">Название блока</span>
                    <input
                      className="add-article-panel__block-title-input"
                      placeholder="Название блока"
                      value={block.title}
                      onChange={(event) =>
                        updateBlock(block.id, { title: event.target.value })
                      }
                    />
                  </label>
                  <button
                    aria-label="Удалить блок"
                    className="add-article-panel__block-remove"
                    title="Удалить блок"
                    type="button"
                    onClick={() => removeBlock(block.id)}
                  >
                    <svg
                      aria-hidden
                      className="add-article-panel__block-remove-icon"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.75"
                      viewBox="0 0 24 24"
                    >
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
                <div className="add-article-panel__block-body-wrap">
                  <span className="visually-hidden">Текст блока</span>
                  <BlockBodyEditor
                    blockId={block.id}
                    valueJson={block.bodyJson}
                    onChange={(json) =>
                      updateBlock(block.id, { bodyJson: json })
                    }
                  />
                </div>
              </div>
            ))}
              <button
                className="secondary-button add-article-panel__add-block"
                type="button"
                onClick={addBlock}
              >
                Добавить блок
              </button>
            </div>
          </div>

          <div className="add-article-panel__footer">
            <div className="add-article-panel__footer-row">
              <div className="add-article-panel__footer-fields">
                <label className="editor-field add-article-panel__field-section">
                  <span id={sectionLabelId}>Раздел</span>
                  <CustomSelect
                    ariaLabelledBy={sectionLabelId}
                    options={sectionSelectOptions}
                    value={sectionId}
                    onChange={setSectionId}
                  />
                </label>
                <label className="editor-field add-article-panel__field-audience">
                  <span id={audienceLabelId}>Тип</span>
                  <CustomSelect
                    ariaLabelledBy={audienceLabelId}
                    options={AUDIENCE_PRESET_OPTIONS}
                    value={audiencePreset}
                    onChange={(value) => setAudiencePreset(value as AudiencePreset)}
                  />
                </label>
              </div>

              {isEdit ? (
                <div className="add-article-panel__footer-actions add-article-panel__footer-actions--edit">
                  <button
                    className="ghost-button"
                    disabled={isSaving}
                    type="button"
                    onClick={onClose}
                  >
                    Отмена
                  </button>
                  {onDeleteArticle ? (
                    <button
                      aria-label="Удалить статью"
                      className="add-article-panel__delete-article-btn"
                      disabled={isSaving}
                      title="Удалить статью из локальной базы"
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setDeleteArticleDialogOpen(true)
                      }}
                    >
                      <DeleteArticleTrashIcon />
                    </button>
                  ) : null}
                  <button
                    className="primary-button"
                    disabled={isSaving}
                    type="button"
                    onClick={() => void handleSaveDraft()}
                  >
                    {isSaving ? 'Сохранение…' : 'Сохранить'}
                  </button>
                </div>
              ) : (
                <div className="add-article-panel__footer-actions">
                  <button className="secondary-button" type="button" onClick={onClose}>
                    Отмена
                  </button>
                  <button className="primary-button" disabled={isSaving} type="submit">
                    {isSaving ? 'Сохранение…' : 'Сохранить'}
                  </button>
                </div>
              )}
            </div>
          </div>
      </form>
      </div>
      {deleteArticleDialogOpen && isEdit && article && onDeleteArticle
        ? createPortal(
            <div
              aria-labelledby="add-article-delete-dialog-title"
              className="article-delete-dialog-backdrop"
              role="presentation"
              onClick={() => setDeleteArticleDialogOpen(false)}
            >
              <div
                aria-modal="true"
                className="article-delete-dialog"
                role="dialog"
                onClick={(event) => event.stopPropagation()}
              >
                <h2
                  className="article-delete-dialog__title"
                  id="add-article-delete-dialog-title"
                >
                  Удалить статью?
                </h2>
                <p className="article-delete-dialog__text">
                  Статья «{title.trim() || 'без названия'}» будет удалена только из
                  вашей локальной базы. Пока вы не опубликуете новый snapshot, другие
                  пользователи не увидят это изменение. Восстановить материал можно из
                  резервной копии snapsho.
                </p>
                <p className="article-delete-dialog__question">
                  Продолжить удаление?
                </p>
                <div className="article-delete-dialog__actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDeleteArticleDialogOpen(false)}
                  >
                    Отмена
                  </button>
                  <button
                    className="primary-button primary-button--danger"
                    type="button"
                    onClick={async () => {
                      try {
                        await onDeleteArticle(article.id)
                        setDeleteArticleDialogOpen(false)
                      } catch {
                        /* alert в App */
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {createPortal(
        toast ? (
          <div
            aria-live="assertive"
            className={`form-error-toast${toast.variant === 'success' ? ' form-error-toast--success' : ''}${toast.open ? ' form-error-toast--open' : ''}`}
            role="alert"
          >
            {toast.message}
          </div>
        ) : null,
        document.body,
      )}
    </>
  )
}

function DeleteArticleTrashIcon() {
  return (
    <svg
      aria-hidden
      className="add-article-panel__delete-article-icon"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}
