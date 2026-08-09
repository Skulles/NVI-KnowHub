import { useCallback, useEffect, useState } from 'react'
import { useWinboxStore } from '../../../store/winbox'
import { preloadDeviceImages } from '../winboxDevices'

type DownloadKind = 'install' | 'update'

export function useWinboxLauncher() {
  const {
    checkStatus,
    localReady,
    bundled,
    hasUpdate,
    latestVersion,
    sidebarOpenError,
    bundledExpectedName,
    setChecking,
    setLocalStatus,
    setResult,
    setError,
    setSidebarOpenError,
  } = useWinboxStore()

  const [openError, setOpenError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [downloading, setDownloading] = useState(false)
  /** 'install' | 'update' — чтобы подпись кнопки отличала первую загрузку от обновления. */
  const [downloadKind, setDownloadKind] = useState<DownloadKind | null>(null)

  const expectedName = bundledExpectedName || 'WinBox'

  const refreshWinboxInfo = useCallback(async () => {
    if (!window.api) return
    const local = await window.api.winboxGetLocalStatus()
    setLocalStatus(local)
    const info = await window.api.winboxCheckUpdate()
    setResult({
      bundled: info.bundled,
      hasUpdate: info.hasUpdate,
      latest: info.latest,
      local: info.local,
      mikrotikOnline: info.mikrotikOnline,
      bundledExpectedName: info.bundledExpectedName,
    })
  }, [setLocalStatus, setResult])

  useEffect(() => {
    preloadDeviceImages()
  }, [])

  // Быстрый локальный статус — кнопка не ждёт mikrotik.com.
  useEffect(() => {
    if (localReady || !window.api) return
    void window.api.winboxGetLocalStatus().then(setLocalStatus)
  }, [localReady, setLocalStatus])

  // Проверка обновлений в фоне. Результат пишем в zustand даже после unmount,
  // иначе при уходе со страницы checkStatus зависает в checking.
  useEffect(() => {
    if (checkStatus !== 'idle' || !window.api) return
    setChecking()
    window.api
      .winboxCheckUpdate()
      .then((info) => {
        setResult({
          bundled: info.bundled,
          hasUpdate: info.hasUpdate,
          latest: info.latest,
          local: info.local,
          mikrotikOnline: info.mikrotikOnline,
          bundledExpectedName: info.bundledExpectedName,
        })
      })
      .catch(() => {
        setError()
      })
  }, [checkStatus, setChecking, setResult, setError])

  const runDownload = useCallback(
    async (kind: DownloadKind) => {
      if (!window.api) return
      setOpenError(null)
      setDownloadError(null)
      setSidebarOpenError(null)
      setDownloadKind(kind)
      setDownloading(true)
      const result = await window.api.winboxDownloadBundled()
      setDownloading(false)
      setDownloadKind(null)
      if (!result.ok) {
        setDownloadError(
          result.error ??
            (kind === 'update' ? 'Не удалось обновить WinBox.' : 'Не удалось загрузить WinBox.'),
        )
        return
      }
      await refreshWinboxInfo()
    },
    [refreshWinboxInfo, setSidebarOpenError],
  )

  const handlePrimaryAction = useCallback(async () => {
    if (!window.api) return
    setOpenError(null)
    setDownloadError(null)
    setSidebarOpenError(null)

    if (!bundled && localReady) {
      await runDownload('install')
      return
    }

    setLaunching(true)
    const result = await window.api.winboxOpen()
    setLaunching(false)
    const name = useWinboxStore.getState().bundledExpectedName || 'WinBox'
    if (!result.ok) {
      setOpenError(
        result.error === 'not-bundled'
          ? `${name} не найден в ресурсах приложения.`
          : `Не удалось запустить WinBox: ${result.error}`,
      )
    }
  }, [bundled, localReady, runDownload, setSidebarOpenError])

  const handleUpdate = useCallback(() => {
    void runDownload('update')
  }, [runDownload])

  // Не блокируем кнопку ожиданием сети (winboxCheckUpdate → mikrotik.com).
  const busy = launching || downloading
  const disabled = busy || !localReady

  const needsDownload = !bundled && localReady
  const needsUpdate = bundled && hasUpdate
  const primaryLabel = launching
    ? 'Открываю…'
    : downloading && downloadKind === 'install'
      ? 'Загружаю…'
      : needsDownload
        ? 'Загрузить'
        : 'Открыть WinBox'
  const updateLabel =
    downloading && downloadKind === 'update'
      ? 'Обновляю…'
      : latestVersion
        ? `Обновить ${latestVersion}`
        : 'Обновить'

  return {
    status: {
      expectedName,
      needsDownload,
      needsUpdate,
    },
    controls: {
      disabled,
    },
    labels: {
      primary: primaryLabel,
      update: updateLabel,
    },
    errors: {
      open: openError,
      sidebarOpen: sidebarOpenError,
      download: downloadError,
    },
    actions: {
      primary: handlePrimaryAction,
      update: handleUpdate,
    },
  }
}
