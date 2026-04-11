import { useEffect } from 'react'

import { useAppStore } from '../state/appStore'

/** Синхронизирует выбранную тему с атрибутом `data-theme` на элементе `html`. */
export function ThemeSync() {
  const colorTheme = useAppStore((s) => s.colorTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', colorTheme)
  }, [colorTheme])

  return null
}
