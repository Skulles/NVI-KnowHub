import { useEffect, useState } from 'react'

/**
 * Tracks document visibility for pausing background work.
 * Hides immediately; resumes after a short debounce to avoid minimize/restore flaps.
 */
export function useDocumentVisible(resumeDebounceMs = 400): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  )

  useEffect(() => {
    let timer: number | undefined

    const sync = (): void => {
      const next = document.visibilityState === 'visible'
      if (!next) {
        if (timer !== undefined) {
          window.clearTimeout(timer)
          timer = undefined
        }
        setVisible(false)
        return
      }

      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        setVisible(document.visibilityState === 'visible')
      }, resumeDebounceMs)
    }

    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [resumeDebounceMs])

  return visible
}
