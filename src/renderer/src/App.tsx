import React, { useEffect, useLayoutEffect } from 'react'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ContentArea } from './components/ContentArea/ContentArea'
import { UpdateBanner } from './components/UpdateBanner/UpdateBanner'
import { initContentStore, MIN_INSTRUCTIONS_REFRESH_MS, useContentStore } from './store/content'
import { useUpdatesStore } from './store/updates'

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

    const offContent = window.api.onContentUpdated(() => {
      void (async () => {
        const startedAtMs = Date.now()
        useContentStore.getState().setInstructionsRefresh({ startedAtMs, endMs: null })
        try {
          await initContentStore()
          const endMs = Math.max(startedAtMs + MIN_INSTRUCTIONS_REFRESH_MS, Date.now())
          useContentStore.getState().setInstructionsRefresh({ startedAtMs, endMs })
          const waitMs = Math.max(0, endMs - Date.now())
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
          useUpdatesStore.setState({ contentUpdated: true })
        } finally {
          useContentStore.getState().setInstructionsRefresh(null)
        }
      })()
    })

    const offUpdateAvailable = window.api.onAppUpdateAvailable(() => {
      setAppUpdateAvailable()
    })

    const offUpdateProgress = window.api.onAppUpdateDownloadProgress((percent) => {
      setAppUpdateProgress(percent)
    })

    const offUpdateDownloaded = window.api.onAppUpdateDownloaded(() => {
      setAppUpdateDownloaded()
    })

    const offUpdateError = window.api.onAppUpdateError((message) => {
      setAppUpdateError(message)
    })

    return () => {
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
          <ContentArea />
        </div>
      </div>
    </div>
  )
}
