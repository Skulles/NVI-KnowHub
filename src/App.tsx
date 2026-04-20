import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  BrowserRouter,
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  matchPath,
  resolvePath,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { AudienceSegment } from './features/audience/AudienceSegment'
import { AddArticleForm } from './features/article/AddArticleForm'
import { ArticleView } from './features/article/ArticleView'
import { NavigationTree } from './features/navigation/NavigationTree'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { UpdateSnapshotDialog } from './features/settings/UpdateSnapshotDialog'
import { FuelConsumptionTool } from './features/tools/FuelConsumptionTool'
import { MikroTikDiscoveryTool } from './features/tools/MikroTikDiscoveryTool'
import type {
  ApplySnapshotUpdateInput,
  ArticleDraft,
  KnowledgeArticle,
  KnowledgeArticleSummary,
  PublishSnapshotResult,
  KnowledgeSection,
  SnapshotMeta,
  UpdateCheckResult,
} from './entities/knowledge/types'
import {
  getReleaseSourceSettings,
  isReleaseSourceConfigured,
} from './shared/config/releaseSource'
import { knowledgeBase, slugifyArticleTitle } from './shared/lib/content/knowledge'
import {
  articlePath,
  decodeArticleSlugParam,
} from './shared/lib/routing/articlePath'
import { useAppStore } from './shared/state/appStore'
import { useFormErrorToast } from './shared/hooks/useFormErrorToast'
const knowhubMarkUrl = `${import.meta.env.BASE_URL}knowhub-mark.png`

/**
 * Путь приложения из `href` ссылки (Browser или Hash router, абсолютные URL того же origin).
 * Возвращает null, если переход не из SPA (внешняя ссылка и т.п.).
 */
function appPathnameFromHref(
  href: string,
  currentPathname: string,
): string | null {
  const trimmed = href.trim()
  if (
    !trimmed ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:')
  ) {
    return null
  }
  if (trimmed.startsWith('#')) {
    const raw = trimmed.slice(1)
    const pathOnly = raw.split('?')[0] || '/'
    return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      if (u.origin !== window.location.origin) {
        return null
      }
      return u.pathname || '/'
    } catch {
      return null
    }
  }
  try {
    return resolvePath(trimmed, currentPathname).pathname
  } catch {
    return null
  }
}

/**
 * Цель клика как Element (при клике по тексту внутри `<a>` target часто Text, не Element).
 */
function clickTargetElement(target: EventTarget | null): Element | null {
  if (!target || target === window) {
    return null
  }
  if (target instanceof Element) {
    return target
  }
  if (target instanceof Text) {
    return target.parentElement
  }
  return null
}

function draftSlugForNav(draft: ArticleDraft): string {
  return draft.slug?.trim() || slugifyArticleTitle(draft.title)
}

function findOrphanDraftBySlug(
  slug: string,
  draftMap: Record<string, ArticleDraft>,
): ArticleDraft | null {
  for (const d of Object.values(draftMap)) {
    if (d.status !== 'orphaned') {
      continue
    }
    if (draftSlugForNav(d) === slug) {
      return d
    }
  }
  return null
}

function App() {
  const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

  return (
    <Router>
      <WorkspaceApp />
    </Router>
  )
}

function WorkspaceApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    editorMode,
    editorOpen,
    audience,
    setEditorMode,
    setEditorOpen,
    setAudience,
  } = useAppStore()

  const [isBooting, setIsBooting] = useState(true)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false)
  const [sections, setSections] = useState<KnowledgeSection[]>([])
  const [articles, setArticles] = useState<KnowledgeArticleSummary[]>([])
  const [drafts, setDrafts] = useState<Record<string, ArticleDraft>>({})
  const [pendingLocalArticleIds, setPendingLocalArticleIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [activeArticle, setActiveArticle] = useState<KnowledgeArticle | null>(null)
  const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMeta>({
    version: 'loading',
    updatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    schemaVersion: 0,
    checksum: 'loading',
    articleCount: 0,
    sectionCount: 0,
    source: 'local',
  })
  const [updateState, setUpdateState] = useState<UpdateCheckResult | null>(null)
  const [publishState, setPublishState] = useState<PublishSnapshotResult | null>(null)
  const [addArticleOpen, setAddArticleOpen] = useState(false)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const startupUpdateCheckDoneRef = useRef(false)
  const knowledgeImportInputRef = useRef<HTMLInputElement>(null)
  const articleSlugPrevRef = useRef<string | null>(null)
  const [articleRouteLoading, setArticleRouteLoading] = useState(false)

  const { toast: navBlockedToast, showErrorToast: showNavigationBlockedToast } =
    useFormErrorToast()

  const releaseSource = useMemo(() => getReleaseSourceSettings(), [])
  const releaseSourceConfigured = isReleaseSourceConfigured(releaseSource)

  const slugMatch = matchPath('/article/:slug', location.pathname)
  const currentSlug = slugMatch?.params.slug
    ? decodeArticleSlugParam(slugMatch.params.slug)
    : null
  const currentDraft = activeArticle ? drafts[activeArticle.id] ?? null : null

  const editorBlocking =
    editorMode &&
    (addArticleOpen || Boolean(editorOpen && activeArticle))

  const onSidebarNavClickCapture = useCallback(
    (e: ReactMouseEvent) => {
      if (!editorBlocking) {
        return
      }
      const el = clickTargetElement(e.target)
      if (!el) {
        return
      }
      const a = el.closest('a[href]')
      if (!a || !(a instanceof HTMLAnchorElement)) {
        return
      }
      if (a.target === '_blank' || a.hasAttribute('download')) {
        return
      }
      const href = a.getAttribute('href')
      if (!href) {
        return
      }
      const nextPath = appPathnameFromHref(href, location.pathname)
      if (nextPath == null) {
        return
      }
      // Не сравниваем с текущим URL: при создании поста с /settings повторный клик по
      // «Настройки» ведёт на тот же путь — всё равно нужно напомнить про черновик.
      e.preventDefault()
      e.stopPropagation()
      showNavigationBlockedToast(
        'Сначала сохраните или отмените редактирование',
      )
    },
    [editorBlocking, location.pathname, showNavigationBlockedToast],
  )

  const navigationArticles = useMemo(() => {
    const ids = new Set(articles.map((a) => a.id))
    const extra: KnowledgeArticleSummary[] = []
    const defaultSectionId = sections[0]?.id
    for (const d of Object.values(drafts)) {
      if (d.status !== 'orphaned' || ids.has(d.articleId)) {
        continue
      }
      const sectionId = d.sectionId ?? defaultSectionId
      if (!sectionId) {
        continue
      }
      extra.push({
        id: d.articleId,
        sectionId,
        slug: draftSlugForNav(d),
        title: d.title,
        summary: d.summary,
        updatedAt: d.updatedAt,
        forBu: d.forBu ?? true,
        forTkrs: d.forTkrs ?? true,
      })
    }
    return [...articles, ...extra]
  }, [articles, drafts, sections])

  const articleLocalChangeKind = useMemo(() => {
    const m: Record<string, 'added' | 'edited' | 'deleted'> = {}
    for (const [id, d] of Object.entries(drafts)) {
      if (d.status === 'orphaned') {
        m[id] = 'deleted'
      } else if (!pendingLocalArticleIds.has(id)) {
        m[id] = 'edited'
      }
    }
    for (const id of pendingLocalArticleIds) {
      m[id] = 'added'
    }
    return m
  }, [drafts, pendingLocalArticleIds])

  const orphanArticleFromDraft = useCallback(
    (draft: ArticleDraft, slug: string): KnowledgeArticle | null => {
      const sectionId = draft.sectionId ?? sections[0]?.id
      if (!sectionId) {
        return null
      }
      return {
        id: draft.articleId,
        sectionId,
        slug,
        title: draft.title,
        summary: draft.summary,
        contentJson: draft.contentJson,
        contentText: draft.contentText,
        updatedAt: draft.updatedAt,
        forBu: draft.forBu ?? true,
        forTkrs: draft.forTkrs ?? true,
      }
    },
    [sections],
  )

  const loadWorkspace = useCallback(async () => {
    const [
      loadedSections,
      loadedArticles,
      loadedDrafts,
      loadedMeta,
      loadedPendingLocals,
    ] = await Promise.all([
      knowledgeBase.listSections(),
      knowledgeBase.listArticles(audience),
      knowledgeBase.listDrafts(),
      knowledgeBase.getSnapshotMeta(),
      knowledgeBase.getPendingLocalArticleIds(),
    ])

    setSections(loadedSections)
    setArticles(loadedArticles)
    setDrafts(loadedDrafts)
    setSnapshotMeta(loadedMeta)
    setPendingLocalArticleIds(loadedPendingLocals)
  }, [audience])

  useEffect(() => {
    let isMounted = true

    async function bootstrap() {
      try {
        await knowledgeBase.bootstrap()
      } finally {
        if (isMounted) {
          setIsBooting(false)
        }
      }
    }

    void bootstrap()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (isBooting) {
      return
    }

    void loadWorkspace()
  }, [isBooting, loadWorkspace])

  useEffect(() => {
    if (isBooting) {
      return
    }
    if (!currentSlug) {
      setActiveArticle(null)
      setArticleRouteLoading(false)
      articleSlugPrevRef.current = null
      return
    }

    const slugChanged = articleSlugPrevRef.current !== currentSlug
    articleSlugPrevRef.current = currentSlug

    if (slugChanged) {
      setArticleRouteLoading(true)
      setActiveArticle(null)
    }

    let cancelled = false

    void knowledgeBase.getArticleBySlug(currentSlug).then((article) => {
      if (cancelled) {
        return
      }
      if (article) {
        setActiveArticle(article)
        setArticleRouteLoading(false)
        return
      }
      const orphan = findOrphanDraftBySlug(currentSlug, drafts)
      const synthetic = orphan ? orphanArticleFromDraft(orphan, currentSlug) : null
      setActiveArticle(synthetic)
      setArticleRouteLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [currentSlug, drafts, isBooting, snapshotMeta.version, orphanArticleFromDraft])

  useEffect(() => {
    if (!editorMode) {
      setAddArticleOpen(false)
    }
  }, [editorMode])

  useEffect(() => {
    if (isBooting) {
      return
    }
    if (!activeArticle || !currentSlug || location.pathname === '/settings') {
      return
    }

    const visible =
      audience === 'bu' ? activeArticle.forBu : activeArticle.forTkrs

    if (visible) {
      return
    }

    void knowledgeBase.listArticles(audience).then((list) => {
      if (list[0]) {
        navigate(articlePath(list[0].slug), { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    })
  }, [
    activeArticle,
    audience,
    currentSlug,
    location.pathname,
    navigate,
    isBooting,
  ])

  async function handleSaveDraft(payload: ArticleDraft) {
    await knowledgeBase.saveDraft(payload)
    setDrafts(await knowledgeBase.listDrafts())
    setEditorOpen(false)
  }

  const handleCloseEditor = useCallback(async () => {
    if (activeArticle) {
      try {
        await knowledgeBase.discardDraft(activeArticle.id)
        setDrafts(await knowledgeBase.listDrafts())
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Не удалось сбросить черновик.',
        )
        return
      }
    }
    setEditorOpen(false)
  }, [activeArticle, setEditorOpen])

  const handleDeleteArticle = useCallback(
    async (articleId: string) => {
      try {
        await knowledgeBase.deleteArticle(articleId)
        await loadWorkspace()
        setEditorOpen(false)
        if (activeArticle?.id === articleId) {
          const list = await knowledgeBase.listArticles(audience)
          if (list[0]) {
            navigate(articlePath(list[0].slug), { replace: true })
          } else {
            navigate('/', { replace: true })
          }
        }
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Не удалось удалить статью.',
        )
        throw err
      }
    },
    [loadWorkspace, activeArticle?.id, audience, navigate, setEditorOpen],
  )

  const handleCheckUpdates = useCallback(
    async (options?: { resetState?: boolean }) => {
      const resetState = options?.resetState !== false
      setIsCheckingUpdates(true)
      if (resetState) {
        setUpdateState(null)
      }

      try {
        const result = await knowledgeBase.checkForUpdates(releaseSource)
        setUpdateState(result)
      } catch (error) {
        setUpdateState({
          status: 'not-configured',
          message:
            error instanceof Error
              ? error.message
              : 'Не удалось проверить обновления.',
        })
      } finally {
        setIsCheckingUpdates(false)
      }
    },
    [releaseSource],
  )

  const openUpdateDialogFromSettings = useCallback(() => {
    setUpdateDialogOpen(true)
    void handleCheckUpdates({ resetState: true })
  }, [handleCheckUpdates])

  useEffect(() => {
    if (isBooting || !releaseSourceConfigured) {
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return
    }
    if (startupUpdateCheckDoneRef.current) {
      return
    }
    startupUpdateCheckDoneRef.current = true
    void handleCheckUpdates({ resetState: false })
  }, [isBooting, releaseSourceConfigured, handleCheckUpdates])

  async function handleApplyUpdate(payload: {
    downloadUrl: string
    version: string
    manifestUrl?: string | null
    checksum?: string
  }) {
    setIsApplyingUpdate(true)

    try {
      const result = await knowledgeBase.applySnapshotUpdate(
        payload satisfies ApplySnapshotUpdateInput,
        (_stage, message) => {
          setUpdateState({
            status: 'update-available',
            latestVersion: payload.version,
            assetUrl: payload.downloadUrl,
            manifestUrl: payload.manifestUrl ?? null,
            checksum: payload.checksum,
            message,
          })
        },
      )
      await loadWorkspace()
      setSnapshotMeta(result.meta)
      setUpdateState({
        status: 'up-to-date',
        latestVersion: result.meta.version,
        assetUrl: payload.downloadUrl,
        manifestUrl: payload.manifestUrl ?? null,
        checksum: payload.checksum,
        message:
          result.drafts.orphaned > 0
            ? `Новый snapshot применен. Активных черновиков: ${result.drafts.active}, orphaned: ${result.drafts.orphaned}.`
            : 'Новый snapshot применен. Локальные черновики сохранены отдельно.',
      })
    } catch (error) {
      setUpdateState({
        status: 'not-configured',
        message:
          error instanceof Error ? error.message : 'Не удалось применить обновление.',
      })
      throw error
    } finally {
      setIsApplyingUpdate(false)
    }
  }

  async function handlePublishSnapshot(payload: {
    token: string
    version: string
    releaseNotes?: string
  }) {
    if (!releaseSourceConfigured) {
      throw new Error(
        'Источник публикации не задан',
      )
    }
    const result = await knowledgeBase.publishSnapshot({
      settings: releaseSource,
      token: payload.token,
      version: payload.version,
      releaseNotes: payload.releaseNotes,
    })
    setPublishState(result)
    await loadWorkspace()
    setSnapshotMeta(await knowledgeBase.getSnapshotMeta())
  }

  function handleExportSnapshot() {
    const bytes = knowledgeBase.exportSnapshotBytes()
    const blob = new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.sqlite3',
    })
    const url = URL.createObjectURL(blob)
    const safeVersion = snapshotMeta.version.replace(/[^\w.-]+/g, '_')
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `knowhub-snapshot-${safeVersion}.sqlite`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportSnapshot(file: File) {
    const ok = window.confirm(
      'Заменить локальный snapshot выбранным файлом? При ошибке импорта будет восстановлена предыдущая база из резервной копии. Локальные черновики будут сверены с новой базой; они не входят в .sqlite-файл.',
    )
    if (!ok) {
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      await knowledgeBase.importSnapshotFromBytes(new Uint8Array(buffer))
      await loadWorkspace()
      if (currentSlug) {
        const still = await knowledgeBase.getArticleBySlug(currentSlug)
        if (!still) {
          const list = await knowledgeBase.listArticles(audience)
          if (list[0]) {
            navigate(articlePath(list[0].slug), { replace: true })
          } else {
            navigate('/', { replace: true })
          }
        }
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Не удалось импортировать базу.',
      )
    }
  }

  const showUpdateBanner =
    releaseSourceConfigured &&
    updateState?.status === 'update-available' &&
    Boolean(updateState.assetUrl)

  if (isBooting) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="boot-screen"
        role="status"
      >
        <div aria-hidden className="boot-loader">
          <div className="boot-loader__spinner" />
        </div>
        <span className="visually-hidden">Загрузка базы знаний</span>
      </div>
    )
  }

  const settingsNavActive = location.pathname === '/settings' && !addArticleOpen

  return (
    <div
      className={
        showUpdateBanner ? 'app-shell app-shell--update-banner' : 'app-shell'
      }
    >
      {showUpdateBanner && updateState?.status === 'update-available' ? (
        <div className="update-available-banner" role="status">
          <p className="update-available-banner__text">
            Доступна новая версия базы{' '}
            
          </p>
          <div className="update-available-banner__actions">
            <button
              className="primary-button update-available-banner__btn"
              type="button"
              onClick={() => setUpdateDialogOpen(true)}
            >
              Обновить
            </button>
          </div>
        </div>
      ) : null}

      <aside className="sidebar" onClickCapture={onSidebarNavClickCapture}>
        <header className="sidebar-header">
          <div className="sidebar-header__brand">
            <div
              aria-hidden
              className="sidebar-header__logo"
              style={
                {
                  '--sidebar-mark-url': `url(${knowhubMarkUrl})`,
                } as CSSProperties
              }
            />
            <div className="sidebar-header__titles">
              <h1 className="sidebar-title">KnowHub</h1>
              <p className="app-eyebrow">сервисная служба</p>
            </div>
          </div>
          <Link
            aria-label="Настройки"
            className={
              settingsNavActive ? 'sidebar-settings is-active' : 'sidebar-settings'
            }
            title="Настройки"
            to="/settings"
          >
            <SettingsIcon />
          </Link>
        </header>

        {editorMode ? (
          <button
            className="sidebar-add-article"
            type="button"
            onClick={() => {
              setEditorOpen(false)
              setAddArticleOpen(true)
            }}
          >
            Добавить статью
          </button>
        ) : null}

        <AudienceSegment onChange={setAudience} value={audience} />

        <div className="sidebar-scroll">
          <NavigationTree
            articleLocalChangeKind={articleLocalChangeKind}
            articles={navigationArticles}
            muteActiveHighlight={addArticleOpen}
            sections={sections}
          />
        </div>
      </aside>

      {editorMode && addArticleOpen ? (
        <AddArticleForm
          key="create-article"
          defaultAudience={audience}
          mode="create"
          sections={sections}
          onClose={() => setAddArticleOpen(false)}
          onCreated={async (article) => {
            setAddArticleOpen(false)
            navigate(articlePath(article.slug))
            await loadWorkspace()
          }}
        />
      ) : null}

      {editorMode && editorOpen && activeArticle ? (
        <AddArticleForm
          key={`edit-${activeArticle.id}`}
          article={activeArticle}
          defaultAudience={audience}
          draft={currentDraft}
          mode="edit"
          sections={sections}
          onClose={() => void handleCloseEditor()}
          onDeleteArticle={handleDeleteArticle}
          onSaveDraft={handleSaveDraft}
        />
      ) : null}

      <main className="main-column">
        <input
          ref={knowledgeImportInputRef}
          accept=".sqlite,application/octet-stream,application/x-sqlite3"
          aria-label="Выбор файла локальной базы (.sqlite)"
          className="visually-hidden"
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void handleImportSnapshot(file)
            }
          }}
        />
        <Routes>
          <Route
            path="/"
            element={
              navigationArticles[0] ? (
                <Navigate replace to={articlePath(navigationArticles[0].slug)} />
              ) : (
                <section className="empty-state empty-state--knowledge-import">
                  <button
                    className="primary-button empty-state__import-btn"
                    type="button"
                    onClick={() => knowledgeImportInputRef.current?.click()}
                  >
                    Импортировать локальную базу
                  </button>
                </section>
              )
            }
          />
          <Route
            path="/article/:slug"
            element={
              <ArticleView
                activeAudience={audience}
                article={activeArticle}
                articleRouteLoading={articleRouteLoading}
                draft={currentDraft}
                editorMode={editorMode}
                onOpenEditor={() => {
                  setAddArticleOpen(false)
                  setEditorOpen(true)
                }}
              />
            }
          />
          <Route path="/tools/fuel" element={<FuelConsumptionTool />} />
          <Route path="/tools/mikrotik" element={<MikroTikDiscoveryTool />} />
          <Route
            path="/settings"
            element={
              <SettingsPanel
                releaseSourceConfigured={releaseSourceConfigured}
                snapshotMeta={snapshotMeta}
                editorMode={editorMode}
                publishState={publishState}
                onEditorModeChange={setEditorMode}
                onOpenUpdateDialog={openUpdateDialogFromSettings}
                onPublishSnapshot={handlePublishSnapshot}
                onExportSnapshot={handleExportSnapshot}
                onImportSnapshot={(file) => void handleImportSnapshot(file)}
              />
            }
          />
          <Route
            path="*"
            element={
              <section className="empty-state">
                <h2>Страница не найдена</h2>
                <p>Вернитесь к списку статей слева.</p>
              </section>
            }
          />
        </Routes>
      </main>

      <UpdateSnapshotDialog
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
        isApplyingUpdate={isApplyingUpdate}
        isCheckingUpdates={isCheckingUpdates}
        updateState={updateState}
        onApplyUpdate={handleApplyUpdate}
      />

      {createPortal(
        navBlockedToast ? (
          <div
            aria-live="assertive"
            className={`form-error-toast${navBlockedToast.variant === 'success' ? ' form-error-toast--success' : ''}${navBlockedToast.open ? ' form-error-toast--open' : ''}`}
            role="alert"
          >
            {navBlockedToast.message}
          </div>
        ) : null,
        document.body,
      )}
    </div>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="sidebar-settings__icon"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}

export default App
