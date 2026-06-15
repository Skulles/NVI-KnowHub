import React, { useCallback, useEffect, useState } from 'react'
import { AdminSidebar } from './components/AdminSidebar'
import { ConfirmProvider } from './components/ConfirmDialog'
import { Editor } from './components/Editor'
import { LoginScreen } from './components/LoginScreen'
import { api, SectionTarget, setUnauthorizedHandler } from './api'

type EditorView = { draftId: string | null; sessionKey: number } | null
type AuthState = 'loading' | 'guest' | 'authenticated'

export default function App(): React.ReactElement {
  const [authState, setAuthState] = useState<AuthState>('loading')

  const checkSession = useCallback(async (): Promise<void> => {
    try {
      const session = await api.getSession()
      setAuthState(session.authenticated ? 'authenticated' : 'guest')
    } catch {
      setAuthState('guest')
    }
  }, [])

  useEffect(() => {
    void checkSession()
    setUnauthorizedHandler(() => setAuthState('guest'))
    return () => setUnauthorizedHandler(null)
  }, [checkSession])

  if (authState === 'loading') {
    return (
      <div className="h-screen bg-surface-window flex items-center justify-center text-label-secondary text-[13px]">
        Загрузка…
      </div>
    )
  }

  if (authState === 'guest') {
    return <LoginScreen onLoggedIn={() => setAuthState('authenticated')} />
  }

  return <AdminApp onLogout={() => void api.logout().then(() => setAuthState('guest'))} />
}

function AdminApp({ onLogout }: { onLogout: () => void }): React.ReactElement {
  const [editorView, setEditorView] = useState<EditorView>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [selectedTarget, setSelectedTarget] = useState<SectionTarget | null>(null)

  const refresh = (): void => setListRefreshKey((k) => k + 1)

  const activeArticleId = editorView && editorView.draftId ? editorView.draftId : null
  const isDraftNew = editorView !== null && editorView.draftId === null

  const openArticle = (id: string): void =>
    setEditorView({ draftId: id, sessionKey: Date.now() })

  const openNewArticle = (): void => {
    if (!selectedTarget?.sectionId) return
    setEditorView({ draftId: null, sessionKey: Date.now() })
  }

  const closeEditor = (): void => setEditorView(null)

  const handleArticleSaved = (id: string): void => {
    refresh()
    setEditorView((prev) =>
      prev ? { ...prev, draftId: id } : { draftId: id, sessionKey: Date.now() }
    )
  }

  return (
    <ConfirmProvider>
    <div className="h-screen bg-surface-window text-label-primary overflow-hidden flex">
      <button
        type="button"
        onClick={onLogout}
        className="fixed bottom-4 right-4 z-50 text-[11px] text-label-tertiary hover:text-label-secondary transition-colors"
        title="Выйти"
      >
        Выйти
      </button>
      <AdminSidebar
        selectedTarget={selectedTarget}
        activeArticleId={activeArticleId}
        isDraftNew={isDraftNew}
        refreshKey={listRefreshKey}
        onSelectTarget={(t) => {
          setSelectedTarget(t)
          setEditorView(null)
        }}
        onSelectArticle={openArticle}
        onNewArticle={openNewArticle}
      />

      <div className="admin-main">
        <div className="pointer-events-none absolute inset-0 bg-[var(--page-glow)]" aria-hidden />

        <div className="relative z-[1] flex-1 min-h-0 overflow-hidden flex flex-col">
          {editorView ? (
            <Editor
              key={editorView.sessionKey}
              draftId={editorView.draftId}
              targetSection={selectedTarget}
              onTargetLoaded={setSelectedTarget}
              onBack={closeEditor}
              onSaved={handleArticleSaved}
            />
          ) : (
            <AdminWelcome hasTarget={!!selectedTarget?.sectionId} onNewArticle={openNewArticle} />
          )}
        </div>
      </div>
    </div>
    </ConfirmProvider>
  )
}

function AdminWelcome({
  hasTarget,
  onNewArticle
}: {
  hasTarget: boolean
  onNewArticle: () => void
}): React.ReactElement {
  return (
    <div className="flex flex-col h-full">
      <header className="admin-panel-header">
        <h1 className="text-[15px] font-semibold text-label-primary tracking-tight">Редактор</h1>
      </header>
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="admin-card max-w-md px-8 py-10 text-center">
          {hasTarget ? (
            <>
              <p className="text-[15px] font-medium text-label-primary">Выберите статью слева</p>
              <p className="mt-2 text-[13px] leading-relaxed text-label-secondary">
                в списке подраздела или создайте новую кнопкой «+»
              </p>
              <button type="button" onClick={onNewArticle} className="admin-btn-primary mt-6">
                + Создать статью
              </button>
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium text-label-primary">Добро пожаловать</p>
              <p className="mt-2 text-[13px] leading-relaxed text-label-secondary">
                Раскройте раздел «Инструкции» слева и выберите или создайте статью
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
