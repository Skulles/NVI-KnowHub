import React, { useCallback, useEffect, useState } from 'react'
import { clearAppUpdateInstallOnNextLaunch, markAppUpdateInstallOnNextLaunch, useUpdatesStore } from '../../store/updates'
import { useWinboxStore } from '../../store/winbox'
import { ArrowPathIcon, BookIcon, RouterIcon, WrenchIcon, XMarkIcon } from '../Icons'

const TOAST_PANEL =
  'pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border border-surface-border bg-surface-sidebar/95 px-4 py-2.5 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl'

const CONTENT_TOAST_AUTO_MS = 4500
const TOAST_ICON_ALTERNATE_MS = 650
const APP_ICON_ALTERNATE_MS = 650
const WINBOX_TOAST_AUTO_MS = 6000

function useToastEnterLeave(active: boolean): {
  show: boolean
  panelOpen: boolean
  leaving: boolean
  requestLeave: () => void
  onTransitionEnd: (e: React.TransitionEvent<HTMLDivElement>) => void
  iconAlt: boolean
} {
  const [leaving, setLeaving] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const [iconAlt, setIconAlt] = useState(false)
  const show = active || leaving

  useEffect(() => {
    if (!active) return
    setLeaving(false)
    setAnimateIn(false)
    setIconAlt(false)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true))
    })
    return () => cancelAnimationFrame(id)
  }, [active])

  useEffect(() => {
    if (!show || leaving) return
    const id = setInterval(() => setIconAlt((v) => !v), TOAST_ICON_ALTERNATE_MS)
    return () => clearInterval(id)
  }, [show, leaving])

  const requestLeave = useCallback(() => setLeaving(true), [])

  const onTransitionEnd = useCallback((e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform' || !leaving) return
    setAnimateIn(false)
    setLeaving(false)
  }, [leaving])

  return {
    show,
    panelOpen: animateIn && !leaving,
    leaving,
    requestLeave,
    onTransitionEnd,
    iconAlt
  }
}

function ContentInstructionsToast(): React.ReactElement | null {
  const contentUpdated = useUpdatesStore((s) => s.contentUpdated)
  const dismissContentUpdate = useUpdatesStore((s) => s.dismissContentUpdate)
  const { show, panelOpen, leaving, requestLeave, onTransitionEnd, iconAlt } =
    useToastEnterLeave(contentUpdated)

  useEffect(() => {
    if (!contentUpdated || leaving) return
    const t = setTimeout(requestLeave, CONTENT_TOAST_AUTO_MS)
    return () => clearTimeout(t)
  }, [contentUpdated, leaving, requestLeave])

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      onTransitionEnd(e)
      if (e.target !== e.currentTarget || e.propertyName !== 'transform' || !leaving) return
      dismissContentUpdate()
    },
    [onTransitionEnd, leaving, dismissContentUpdate]
  )

  if (!show) return null

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      className={`${TOAST_PANEL} ease-out will-change-transform transition-[transform,opacity] duration-300 ${
        panelOpen ? 'translate-y-0 opacity-100' : '-translate-y-[130%] opacity-0'
      }`}
    >
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/14 text-emerald-400">
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            iconAlt ? 'opacity-0' : 'opacity-100'
          }`}
          aria-hidden
        >
          <BookIcon className="w-3.5 h-3.5" />
        </span>
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            iconAlt ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </span>
      </span>
      <span className="text-label-primary/92 leading-snug">Инструкции обновлены</span>
    </div>
  )
}

function AppUpdateCenterToast(): React.ReactElement | null {
  const appUpdateAvailable = useUpdatesStore((s) => s.appUpdateAvailable)
  const appUpdateDownloaded = useUpdatesStore((s) => s.appUpdateDownloaded)
  const appUpdateDownloading = useUpdatesStore((s) => s.appUpdateDownloading)
  const appUpdateError = useUpdatesStore((s) => s.appUpdateError)
  const appUpdateDismissed = useUpdatesStore((s) => s.appUpdateDismissed)
  const dismissAppUpdate = useUpdatesStore((s) => s.dismissAppUpdate)
  const beginAppUpdateDownload = useUpdatesStore((s) => s.beginAppUpdateDownload)
  const setAppUpdateError = useUpdatesStore((s) => s.setAppUpdateError)

  const [leaving, setLeaving] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const [iconAlt, setIconAlt] = useState(false)
  const [installing, setInstalling] = useState(false)

  const active =
    !appUpdateDismissed &&
    !appUpdateDownloading &&
    (!!appUpdateError ||
      appUpdateDownloaded ||
      (appUpdateAvailable && !appUpdateDownloading))

  const show = active || leaving

  useEffect(() => {
    if (!active) return
    setLeaving(false)
    setAnimateIn(false)
    setIconAlt(false)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true))
    })
    return () => cancelAnimationFrame(id)
  }, [active, appUpdateDownloaded, appUpdateError])

  useEffect(() => {
    if (!show || leaving) return
    const id = setInterval(() => setIconAlt((v) => !v), APP_ICON_ALTERNATE_MS)
    return () => clearInterval(id)
  }, [show, leaving])

  const requestPostpone = useCallback(() => {
    markAppUpdateInstallOnNextLaunch()
    if (appUpdateDownloaded) {
      setLeaving(true)
      return
    }
    setLeaving(true)
    beginAppUpdateDownload({ silent: true })
    void (async () => {
      if (!window.api) return
      const result = await window.api.startAppUpdateDownload()
      if (!result.ok) {
        setAppUpdateError(result.error ?? 'Не удалось загрузить обновление')
      }
    })()
  }, [appUpdateDownloaded, beginAppUpdateDownload, setAppUpdateError])

  const onTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.propertyName !== 'transform' || !leaving) return
      dismissAppUpdate()
      setAnimateIn(false)
      setLeaving(false)
    },
    [leaving, dismissAppUpdate]
  )

  const handleStartDownload = useCallback(() => {
    if (!window.api) return
    clearAppUpdateInstallOnNextLaunch()
    beginAppUpdateDownload({ silent: false })
    void (async () => {
      const result = await window.api!.startAppUpdateDownload()
      if (!result.ok) {
        setAppUpdateError(result.error ?? 'Не удалось загрузить обновление')
      }
    })()
  }, [beginAppUpdateDownload, setAppUpdateError])

  const handleInstall = useCallback(async () => {
    if (!window.api) return
    setInstalling(true)
    setAppUpdateError(null)
    clearAppUpdateInstallOnNextLaunch()
    try {
      await window.api.installAppUpdate()
    } catch (e) {
      setAppUpdateError((e as Error).message || 'Не удалось перезапустить приложение')
      setInstalling(false)
    }
  }, [setAppUpdateError])

  const handleRetry = useCallback(() => {
    if (!window.api) return
    setAppUpdateError(null)
    beginAppUpdateDownload({ silent: false })
    void (async () => {
      const result = await window.api!.startAppUpdateDownload()
      if (!result.ok) {
        setAppUpdateError(result.error ?? 'Не удалось загрузить обновление')
      }
    })()
  }, [beginAppUpdateDownload, setAppUpdateError])

  if (!show) return null

  const panelOpen = animateIn && !leaving
  const message = appUpdateError
    ? 'Не удалось загрузить обновление'
    : appUpdateDownloaded
      ? 'Обновление загружено'
      : 'Доступно обновление приложения'

  return (
    <div
      onTransitionEnd={onTransitionEnd}
      className={`${TOAST_PANEL} ease-out will-change-transform transition-[transform,opacity] duration-300 ${
        panelOpen ? 'translate-y-0 opacity-100' : '-translate-y-[130%] opacity-0'
      }`}
    >
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-tint-blue/14 text-tint-blue">
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            iconAlt ? 'opacity-0' : 'opacity-100'
          }`}
          aria-hidden
        >
          <WrenchIcon className="w-3.5 h-3.5" />
        </span>
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            iconAlt ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </span>
      </span>
      <span className="flex-1 text-label-primary/92 leading-snug">{message}</span>
      {appUpdateError ? (
        <button
          type="button"
          onClick={handleRetry}
          className="no-drag shrink-0 rounded-lg bg-tint-blue px-3 py-1.5 text-[12px] font-medium tracking-tight text-white shadow-sm transition-colors duration-150 hover:bg-tint-blue-hover active:scale-[0.98]"
        >
          Повторить
        </button>
      ) : appUpdateDownloaded ? (
        <button
          type="button"
          disabled={installing}
          onClick={() => void handleInstall()}
          className="no-drag shrink-0 rounded-lg bg-tint-blue px-3 py-1.5 text-[12px] font-medium tracking-tight text-white shadow-sm transition-colors duration-150 hover:bg-tint-blue-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {installing ? 'Установка…' : 'Установить'}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStartDownload}
          className="no-drag shrink-0 rounded-lg bg-tint-blue px-3 py-1.5 text-[12px] font-medium tracking-tight text-white shadow-sm transition-colors duration-150 hover:bg-tint-blue-hover active:scale-[0.98]"
        >
          Обновить
        </button>
      )}
      <button
        type="button"
        onClick={requestPostpone}
        className="no-drag shrink-0 text-[12px] font-medium tracking-tight text-label-secondary transition-colors duration-150 hover:text-label-primary"
      >
        Позже
      </button>
    </div>
  )
}

function AppUpdateDownloadCorner(): React.ReactElement | null {
  const appUpdateDownloading = useUpdatesStore((s) => s.appUpdateDownloading)
  const appUpdateSilentDownload = useUpdatesStore((s) => s.appUpdateSilentDownload)
  const appUpdateDownloaded = useUpdatesStore((s) => s.appUpdateDownloaded)
  const appUpdateError = useUpdatesStore((s) => s.appUpdateError)
  const appUpdateProgress = useUpdatesStore((s) => s.appUpdateProgress)

  const [animateIn, setAnimateIn] = useState(false)

  const visible =
    appUpdateDownloading &&
    !appUpdateSilentDownload &&
    !appUpdateDownloaded &&
    !appUpdateError

  useEffect(() => {
    if (!visible) {
      setAnimateIn(false)
      return
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true))
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  if (!visible) return null

  const percent = Math.max(0, Math.min(100, Math.round(appUpdateProgress ?? 0)))

  return (
    <div className="pointer-events-none absolute right-5 top-3 z-40">
      <div
        className={`whitespace-nowrap text-[12px] tabular-nums tracking-tight text-label-secondary/90 ease-out will-change-transform transition-[transform,opacity] duration-300 ${
          animateIn ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'
        }`}
      >
        Загрузка обновления {percent}%
      </div>
    </div>
  )
}

function WinboxUpdateToast(): React.ReactElement | null {
  const { hasUpdate, latestVersion, toastDismissed, dismissToast } = useWinboxStore()
  const active = hasUpdate && !toastDismissed
  const { show, panelOpen, leaving, requestLeave, onTransitionEnd, iconAlt } =
    useToastEnterLeave(active)

  useEffect(() => {
    if (!active || leaving) return
    const t = setTimeout(requestLeave, WINBOX_TOAST_AUTO_MS)
    return () => clearTimeout(t)
  }, [active, leaving, requestLeave])

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      onTransitionEnd(e)
      if (e.target !== e.currentTarget || e.propertyName !== 'transform' || !leaving) return
      dismissToast()
    },
    [onTransitionEnd, leaving, dismissToast]
  )

  if (!show) return null

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      className={`${TOAST_PANEL} ease-out will-change-transform transition-[transform,opacity] duration-300 ${
        panelOpen ? 'translate-y-0 opacity-100' : '-translate-y-[130%] opacity-0'
      }`}
    >
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-tint-blue/14 text-tint-blue">
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            iconAlt ? 'opacity-0' : 'opacity-100'
          }`}
          aria-hidden
        >
          <RouterIcon className="w-3.5 h-3.5" />
        </span>
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            iconAlt ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </span>
      </span>
      <span className="flex-1 text-label-primary/92 leading-snug">
        Доступно обновление WinBox{latestVersion ? ` ${latestVersion}` : ''}
      </span>
      <button
        type="button"
        onClick={requestLeave}
        className="rounded-lg p-1 text-label-tertiary hover:text-label-primary hover:bg-white/[0.06] transition-colors no-drag"
        aria-label="Закрыть"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

export function UpdateBanner(): React.ReactElement {
  const appUpdateToastKey = useUpdatesStore((s) =>
    s.appUpdateDownloaded ? 'ready' : s.appUpdateError ? 'error' : 'flow'
  )

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex flex-col items-center gap-2 px-5">
        <AppUpdateCenterToast key={appUpdateToastKey} />
        <ContentInstructionsToast />
        <WinboxUpdateToast />
      </div>
      <AppUpdateDownloadCorner />
    </>
  )
}
