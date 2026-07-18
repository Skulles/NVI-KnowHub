import React, { useCallback, useEffect, useState } from 'react'
import { clearAppUpdateInstallOnNextLaunch, isAppUpdateToastVisible, markAppUpdateInstallOnNextLaunch, useUpdatesStore } from '../../store/updates'
import { useWinboxStore } from '../../store/winbox'
import { ArrowPathIcon, BookIcon, RouterIcon, WrenchIcon, XMarkIcon } from '../Icons'

const CONTENT_TOAST_AUTO_MS = 4500
const CONTENT_ICON_ALTERNATE_MS = 650

function ContentInstructionsToast({
  appUpdateVisible
}: {
  appUpdateVisible: boolean
}): React.ReactElement | null {
  const contentUpdated = useUpdatesStore((s) => s.contentUpdated)
  const dismissContentUpdate = useUpdatesStore((s) => s.dismissContentUpdate)

  const [leaving, setLeaving] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const [iconAlt, setIconAlt] = useState(false)

  const show = contentUpdated || leaving

  useEffect(() => {
    if (!contentUpdated) return
    setLeaving(false)
    setAnimateIn(false)
    setIconAlt(false)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true))
    })
    return () => cancelAnimationFrame(id)
  }, [contentUpdated])

  useEffect(() => {
    if (!contentUpdated || leaving) return
    const t = setTimeout(() => setLeaving(true), CONTENT_TOAST_AUTO_MS)
    return () => clearTimeout(t)
  }, [contentUpdated, leaving])

  useEffect(() => {
    if (!show || leaving) return
    const id = setInterval(() => setIconAlt((v) => !v), CONTENT_ICON_ALTERNATE_MS)
    return () => clearInterval(id)
  }, [show, leaving])

  const onTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (
        e.target !== e.currentTarget ||
        e.propertyName !== 'transform' ||
        !leaving
      ) {
        return
      }
      dismissContentUpdate()
      setAnimateIn(false)
      setLeaving(false)
    },
    [leaving, dismissContentUpdate]
  )

  if (!show) return null

  const panelOpen = animateIn && !leaving

  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 z-40 flex justify-center px-5 ${
        appUpdateVisible ? 'top-[3.35rem]' : 'top-3'
      }`}
    >
      <div
        onTransitionEnd={onTransitionEnd}
        className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border border-surface-border
          bg-surface-sidebar/95 px-4 py-2.5 text-[14px] shadow-chromeTop backdrop-blur-xl ease-out will-change-transform
          transition-[transform,opacity] duration-300
          ${panelOpen ? 'translate-y-0 opacity-100' : '-translate-y-[130%] opacity-0'}`}
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
    </div>
  )
}

const APP_ICON_ALTERNATE_MS = 650

function AppUpdateToast(): React.ReactElement | null {
  const appUpdateDownloaded = useUpdatesStore((s) => s.appUpdateDownloaded)
  const appUpdateError = useUpdatesStore((s) => s.appUpdateError)
  const appUpdateDismissed = useUpdatesStore((s) => s.appUpdateDismissed)
  const dismissAppUpdate = useUpdatesStore((s) => s.dismissAppUpdate)
  const setAppUpdateDownloading = useUpdatesStore((s) => s.setAppUpdateDownloading)
  const setAppUpdateError = useUpdatesStore((s) => s.setAppUpdateError)

  const [leaving, setLeaving] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const [iconAlt, setIconAlt] = useState(false)
  const [installing, setInstalling] = useState(false)

  const visible = !appUpdateDismissed && (appUpdateDownloaded || !!appUpdateError)
  const show = visible || leaving

  useEffect(() => {
    if (!visible) return
    setLeaving(false)
    setAnimateIn(false)
    setIconAlt(false)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true))
    })
    return () => cancelAnimationFrame(id)
  }, [visible, appUpdateDownloaded, appUpdateError])

  useEffect(() => {
    if (!show || leaving) return
    const id = setInterval(() => setIconAlt((v) => !v), APP_ICON_ALTERNATE_MS)
    return () => clearInterval(id)
  }, [show, leaving])

  const requestPostpone = useCallback(() => {
    markAppUpdateInstallOnNextLaunch()
    setLeaving(true)
  }, [])

  const onTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.propertyName !== 'transform' || !leaving) return
      dismissAppUpdate()
      setAnimateIn(false)
      setLeaving(false)
    },
    [leaving, dismissAppUpdate]
  )

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

  const handleRetry = useCallback(async () => {
    if (!window.api) return
    setAppUpdateError(null)
    setAppUpdateDownloading(true)
    const result = await window.api.startAppUpdateDownload()
    if (!result.ok) {
      setAppUpdateError(result.error ?? 'Не удалось загрузить обновление')
    }
  }, [setAppUpdateDownloading, setAppUpdateError])

  if (!show) return null

  const panelOpen = animateIn && !leaving

  return (
    <div className="pointer-events-none absolute left-0 right-0 top-3 z-40 flex justify-center px-5">
      <div
        onTransitionEnd={onTransitionEnd}
        className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border border-surface-border
          bg-surface-sidebar/95 px-4 py-2.5 text-[14px] shadow-chromeTop backdrop-blur-xl ease-out will-change-transform
          transition-[transform,opacity] duration-300
          ${panelOpen ? 'translate-y-0 opacity-100' : '-translate-y-[130%] opacity-0'}`}
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
        <span className="flex-1 text-label-primary/92 leading-snug">
          {appUpdateError
            ? 'Не удалось загрузить обновление'
            : 'Доступно обновление приложения'}
        </span>
        {appUpdateError ? (
          <button
            type="button"
            onClick={() => void handleRetry()}
            className="no-drag shrink-0 rounded-lg bg-tint-blue px-3 py-1.5 text-[12px] font-medium tracking-tight text-white shadow-sm transition-colors duration-150 hover:bg-tint-blue-hover active:scale-[0.98]"
          >
            Повторить
          </button>
        ) : (
          <button
            type="button"
            disabled={installing}
            onClick={() => void handleInstall()}
            className="no-drag shrink-0 rounded-lg bg-tint-blue px-3 py-1.5 text-[12px] font-medium tracking-tight text-white shadow-sm transition-colors duration-150 hover:bg-tint-blue-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {installing ? 'Обновление…' : 'Обновить'}
          </button>
        )}
        <button
          type="button"
          onClick={requestPostpone}
          className="no-drag shrink-0 text-[12px] font-medium tracking-tight text-label-secondary transition-colors duration-150 hover:text-label-primary"
        >
          Отложить
        </button>
      </div>
    </div>
  )
}

const WINBOX_TOAST_AUTO_MS = 6000
const WINBOX_ICON_ALTERNATE_MS = 650

function WinboxUpdateToast({
  appUpdateVisible,
  contentUpdated
}: {
  appUpdateVisible: boolean
  contentUpdated: boolean
}): React.ReactElement | null {
  const { hasUpdate, latestVersion, toastDismissed, dismissToast } = useWinboxStore()

  const [leaving, setLeaving] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const [iconAlt, setIconAlt] = useState(false)

  const show = (hasUpdate && !toastDismissed) || leaving

  useEffect(() => {
    if (!hasUpdate || toastDismissed) return
    setLeaving(false)
    setAnimateIn(false)
    setIconAlt(false)
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true))
    })
    return () => cancelAnimationFrame(id)
  }, [hasUpdate, toastDismissed])

  useEffect(() => {
    if (!hasUpdate || toastDismissed || leaving) return
    const t = setTimeout(() => setLeaving(true), WINBOX_TOAST_AUTO_MS)
    return () => clearTimeout(t)
  }, [hasUpdate, toastDismissed, leaving])

  useEffect(() => {
    if (!show || leaving) return
    const id = setInterval(() => setIconAlt((v) => !v), WINBOX_ICON_ALTERNATE_MS)
    return () => clearInterval(id)
  }, [show, leaving])

  const requestClose = useCallback(() => setLeaving(true), [])

  const onTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.propertyName !== 'transform' || !leaving) return
      dismissToast()
      setAnimateIn(false)
      setLeaving(false)
    },
    [leaving, dismissToast]
  )

  if (!show) return null

  const panelOpen = animateIn && !leaving

  const topOffset =
    appUpdateVisible && contentUpdated
      ? 'top-[6.5rem]'
      : appUpdateVisible || contentUpdated
        ? 'top-[3.35rem]'
        : 'top-3'

  return (
    <div className={`pointer-events-none absolute left-0 right-0 z-40 flex justify-center px-5 ${topOffset}`}>
      <div
        onTransitionEnd={onTransitionEnd}
        className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border border-surface-border
          bg-surface-sidebar/95 px-4 py-2.5 text-[14px] shadow-chromeTop backdrop-blur-xl ease-out will-change-transform
          transition-[transform,opacity] duration-300
          ${panelOpen ? 'translate-y-0 opacity-100' : '-translate-y-[130%] opacity-0'}`}
      >
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-tint-blue/14 text-tint-blue">
          <span
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${iconAlt ? 'opacity-0' : 'opacity-100'}`}
            aria-hidden
          >
            <RouterIcon className="w-3.5 h-3.5" />
          </span>
          <span
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${iconAlt ? 'opacity-100' : 'opacity-0'}`}
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
          onClick={requestClose}
          className="rounded-lg p-1 text-label-tertiary hover:text-label-primary hover:bg-white/[0.06] transition-colors no-drag"
          aria-label="Закрыть"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function UpdateBanner(): React.ReactElement {
  const contentUpdated = useUpdatesStore((s) => s.contentUpdated)
  const appUpdateVisible = useUpdatesStore(isAppUpdateToastVisible)

  return (
    <>
      <AppUpdateToast />
      <ContentInstructionsToast appUpdateVisible={appUpdateVisible} />
      <WinboxUpdateToast appUpdateVisible={appUpdateVisible} contentUpdated={contentUpdated} />
    </>
  )
}
