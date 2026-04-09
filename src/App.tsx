import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BrowserRouter,
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  matchPath,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { AudienceSegment } from './features/audience/AudienceSegment'
import { AddArticleForm } from './features/article/AddArticleForm'
import { ArticleView } from './features/article/ArticleView'
import { NavigationTree } from './features/navigation/NavigationTree'
import { SettingsPanel } from './features/settings/SettingsPanel'
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
import { knowledgeBase } from './shared/lib/content/knowledge'
import {
  articlePath,
  decodeArticleSlugParam,
} from './shared/lib/routing/articlePath'
import { useAppStore } from './shared/state/appStore'

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
    moderatorMode,
    editorOpen,
    audience,
    setModeratorMode,
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

  const releaseSource = getReleaseSourceSettings()
  const releaseSourceConfigured = isReleaseSourceConfigured(releaseSource)

  const slugMatch = matchPath('/article/:slug', location.pathname)
  const currentSlug = slugMatch?.params.slug
    ? decodeArticleSlugParam(slugMatch.params.slug)
    : null
  const currentDraft = activeArticle ? drafts[activeArticle.id] ?? null : null

  const sidebarUnpublishedArticleIds = useMemo(() => {
    const ids = new Set<string>(Object.keys(drafts))
    pendingLocalArticleIds.forEach((id) => ids.add(id))
    return ids
  }, [drafts, pendingLocalArticleIds])

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
      return
    }

    void knowledgeBase.getArticleBySlug(currentSlug).then((article) => {
      setActiveArticle(article)
    })
  }, [currentSlug, drafts, isBooting, snapshotMeta.version])

  useEffect(() => {
    if (location.pathname === '/settings') {
      setEditorOpen(false)
    }
  }, [location.pathname, setEditorOpen])

  useEffect(() => {
    if (!moderatorMode) {
      setAddArticleOpen(false)
    }
  }, [moderatorMode])

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

  async function handleCheckUpdates() {
    setIsCheckingUpdates(true)

    try {
      const result = await knowledgeBase.checkForUpdates(releaseSource)
      setUpdateState(result)
    } catch (error) {
      setUpdateState({
        status: 'not-configured',
        message:
          error instanceof Error ? error.message : 'Не удалось проверить обновления.',
      })
    } finally {
      setIsCheckingUpdates(false)
    }
  }

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
        'Источник публикации не задан: задайте переменные VITE_GITHUB_* при сборке.',
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

  if (isBooting) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <h1>Поднимаю локальную базу знаний</h1>
          <p>
            Инициализируется SQLite snapshot
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="sidebar-header__titles">
            <p className="app-eyebrow">сервисная служба</p>
            <h1 className="sidebar-title">KnowHub</h1>
          </div>
          <Link
            aria-label="Настройки"
            className={
              location.pathname === '/settings'
                ? 'sidebar-settings is-active'
                : 'sidebar-settings'
            }
            title="Настройки"
            to="/settings"
          >
            <SettingsIcon />
          </Link>
        </header>

        {moderatorMode ? (
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
            articles={articles}
            unpublishedArticleIds={sidebarUnpublishedArticleIds}
            sections={sections}
          />
        </div>
      </aside>

      {moderatorMode && addArticleOpen ? (
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

      {moderatorMode && editorOpen && activeArticle ? (
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
        <Routes>
          <Route
            path="/"
            element={
              articles[0] ? (
                <Navigate replace to={articlePath(articles[0].slug)} />
              ) : (
                <section className="empty-state">
                  <h2>Нет материалов</h2>
                  <p>
                    В выбранном контуре статей нет. Переключите «БУРОВАЯ / ТКРС» или
                    обновите базу знаний.
                  </p>
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
                draft={currentDraft}
                moderatorMode={moderatorMode}
                onOpenEditor={() => {
                  setAddArticleOpen(false)
                  setEditorOpen(true)
                }}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPanel
                releaseSource={releaseSource}
                releaseSourceConfigured={releaseSourceConfigured}
                snapshotMeta={snapshotMeta}
                moderatorMode={moderatorMode}
                publishState={publishState}
                updateState={updateState}
                isCheckingUpdates={isCheckingUpdates}
                isApplyingUpdate={isApplyingUpdate}
                onModeratorModeChange={setModeratorMode}
                onCheckUpdates={() => void handleCheckUpdates()}
                onApplyUpdate={handleApplyUpdate}
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
