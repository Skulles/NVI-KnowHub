/**
 * App shell: sidebar + content area, content init, update IPC subscriptions.
 */
import React, { useEffect, useLayoutEffect } from 'react'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ContentArea } from './components/ContentArea/ContentArea'
import { UpdateBanner } from './components/UpdateBanner/UpdateBanner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initContentStore, MIN_INSTRUCTIONS_REFRESH_MS, useContentStore } from './store/content'
import {
  clearAppUpdateInstallOnNextLaunch,
  consumeAppUpdateInstallOnNextLaunch,
  peekAppUpdateInstallOnNextLaunch,
  useUpdatesStore
} from './store/updates'

export default function App(): React.ReactElement {
  const {
    setAppUpdateAvailable,
    setAppUpdateDownloaded,
    setAppUpdateProgress,
    setAppUpdateError
  } = useUpdatesStore()

  useEffect(() => {
    initContentStore()
  }, [])

  useEffect(() => {
    const preventImageDragSave = (event: DragEvent): void => {
      if (event.target instanceof HTMLImageElement) {
        event.preventDefault()
      }
    }
    document.addEventListener('dragstart', preventImageDragSave)
    return () => document.removeEventListener('dragstart', preventImageDragSave)
  }, [])

  useLayoutEffect(() => {
    if (!window.api) return

    let contentRefreshCancelled = false
    let sawUpdateDownloaded = false
    let updateLifecycleStarted = false
    // Флаг «установить при следующем запуске», уже бывший до старта этой сессии.
    const autoInstallFromPreviousSession = peekAppUpdateInstallOnNextLaunch()

    const offContent = window.api.onContentUpdated(() => {
      void (async () => {
        const startedAtMs = Date.now()
        useContentStore.getState().setInstructionsRefresh({ startedAtMs, endMs: null })
        try {
          await initContentStore()
          if (contentRefreshCancelled) return
          const endMs = Math.max(startedAtMs + MIN_INSTRUCTIONS_REFRESH_MS, Date.now())
          useContentStore.getState().setInstructionsRefresh({ startedAtMs, endMs })
          const waitMs = Math.max(0, endMs - Date.now())
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
          if (contentRefreshCancelled) return
          useUpdatesStore.setState({ contentUpdated: true })
        } finally {
          if (!contentRefreshCancelled) {
            useContentStore.getState().setInstructionsRefresh(null)
          }
        }
      })()
    })

    const offUpdateAvailable = window.api.onAppUpdateAvailable(() => {
      updateLifecycleStarted = true
      // Предыдущая сессия отложила установку — качаем тихо и ставим без тоста.
      if (autoInstallFromPreviousSession) {
        void window.api?.startAppUpdateDownload()
        return
      }
      setAppUpdateAvailable()
    })

    const offUpdateProgress = window.api.onAppUpdateDownloadProgress((percent) => {
      setAppUpdateProgress(percent)
    })

    const offUpdateDownloaded = window.api.onAppUpdateDownloaded(() => {
      sawUpdateDownloaded = true
      // Отложено в прошлой сессии → ставим сразу, без тоста.
      if (autoInstallFromPreviousSession && consumeAppUpdateInstallOnNextLaunch()) {
        void window.api?.installAppUpdate()
        return
      }
      // «Позже» в этой сессии — держим флаг до следующего запуска, тост не показываем.
      if (peekAppUpdateInstallOnNextLaunch()) {
        useUpdatesStore.setState({
          appUpdateDownloaded: true,
          appUpdateDownloading: false,
          appUpdateSilentDownload: false,
          appUpdateDismissed: true,
          appUpdateProgress: 100,
          appUpdateError: null
        })
        return
      }
      setAppUpdateDownloaded()
    })

    const offUpdateError = window.api.onAppUpdateError((message) => {
      setAppUpdateError(message)
    })

    // Осиротевший флаг: отложили, а апдейт в этой сессии так и не пришёл.
    const clearOrphanPostpone = window.setTimeout(() => {
      if (!sawUpdateDownloaded && !updateLifecycleStarted) clearAppUpdateInstallOnNextLaunch()
    }, 20_000)

    return () => {
      contentRefreshCancelled = true
      window.clearTimeout(clearOrphanPostpone)
      offContent()
      offUpdateAvailable()
      offUpdateProgress()
      offUpdateDownloaded()
      offUpdateError()
    }
  }, [setAppUpdateAvailable, setAppUpdateDownloaded, setAppUpdateProgress, setAppUpdateError])

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-surface-window text-label-primary selection:bg-tint-blue/22">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <UpdateBanner />
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <ErrorBoundary fallbackTitle="Ошибка отображения содержимого">
            <ContentArea />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
