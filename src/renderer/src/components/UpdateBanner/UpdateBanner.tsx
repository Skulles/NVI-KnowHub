import React, { useCallback, useEffect, useState } from 'react'
import { useUpdatesStore } from '../../store/updates'
import { useWinboxStore } from '../../store/winbox'
import { ArrowPathIcon, BookIcon, RouterIcon, XMarkIcon } from '../Icons'

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

  const requestClose = useCallback(() => setLeaving(true), [])

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
          bg-surface-sidebar/95 px-4 py-2.5 text-[13px] shadow-chromeTop backdrop-blur-xl ease-out will-change-transform
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
        <span className="flex-1 text-label-primary/92 leading-snug">Инструкции обновлены</span>
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

const WINBOX_TOAST_AUTO_MS = 6000
const WINBOX_ICON_ALTERNATE_MS = 650

function WinboxUpdateToast({
  appUpdateVisible
}: {
  appUpdateVisible: boolean
}): React.ReactElement | null {
  const { hasUpdate, latestVersion, toastDismissed, dismissToast } = useWinboxStore()
  const contentUpdated = useUpdatesStore((s) => s.contentUpdated)

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

  // stack below other toasts to avoid overlap
  const topOffset = appUpdateVisible && contentUpdated
    ? 'top-[6.5rem]'
    : appUpdateVisible || contentUpdated
      ? 'top-[3.35rem]'
      : 'top-3'

  return (
    <div className={`pointer-events-none absolute left-0 right-0 z-40 flex justify-center px-5 ${topOffset}`}>
      <div
        onTransitionEnd={onTransitionEnd}
        className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border border-surface-border
          bg-surface-sidebar/95 px-4 py-2.5 text-[13px] shadow-chromeTop backdrop-blur-xl ease-out will-change-transform
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
  const appUpdateVersion = useUpdatesStore((s) => s.appUpdateVersion)
  const appUpdateDownloaded = useUpdatesStore((s) => s.appUpdateDownloaded)

  return (
    <>
      {appUpdateVersion ? (
        <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-surface-border bg-surface-sidebar/95 px-5 py-2.5 text-[13px] shadow-chromeTop backdrop-blur-xl">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-tint-blue/22 text-tint-blue">
            <ArrowPathIcon className="w-3.5 h-3.5" />
          </span>
          <span className="flex-1 text-label-primary/92 leading-snug">
            {appUpdateDownloaded
              ? `Обновление ${appUpdateVersion} загружено. Перезапустите приложение для установки.`
              : `Доступна новая версия ${appUpdateVersion} — загружается в фоне…`}
          </span>
          {appUpdateDownloaded && (
            <button
              type="button"
              onClick={() => window.api?.installAppUpdate()}
              className="no-drag shrink-0 rounded-lg bg-tint-blue px-3 py-1.5 text-[11px] font-medium tracking-tight text-white shadow-sm transition-colors duration-150 hover:bg-tint-blue-hover active:scale-[0.98]"
            >
              Перезапустить
            </button>
          )}
        </div>
      ) : null}

      <ContentInstructionsToast appUpdateVisible={!!appUpdateVersion} />
      <WinboxUpdateToast appUpdateVisible={!!appUpdateVersion} />
    </>
  )
}
