import { useCallback, useEffect, useRef, useState } from 'react'

const FORM_ERROR_TOAST_MS = 4800
const FORM_ERROR_TOAST_EXIT_MS = 380

export type FormFeedbackToastState = {
  id: number
  message: string
  open: boolean
  variant: 'error' | 'success'
}

export function useFormErrorToast() {
  const [toast, setToast] = useState<FormFeedbackToastState | null>(null)
  const openToastRafRef = useRef(0)

  const showErrorToast = useCallback((message: string) => {
    setToast((prev) => ({
      id: (prev?.id ?? 0) + 1,
      message,
      open: false,
      variant: 'error',
    }))
  }, [])

  const showSuccessToast = useCallback((message: string) => {
    setToast((prev) => ({
      id: (prev?.id ?? 0) + 1,
      message,
      open: false,
      variant: 'success',
    }))
  }, [])

  const dismissErrorToast = useCallback(() => {
    setToast(null)
  }, [])

  useEffect(() => {
    if (!toast) {
      return
    }

    let cancelled = false
    let removeAfterClose: ReturnType<typeof setTimeout> | undefined

    const raf = requestAnimationFrame(() => {
      openToastRafRef.current = requestAnimationFrame(() => {
        if (cancelled) {
          return
        }
        setToast((t) => (t ? { ...t, open: true } : null))
      })
    })

    const hideTimer = window.setTimeout(() => {
      setToast((t) => (t ? { ...t, open: false } : null))
      removeAfterClose = window.setTimeout(() => {
        setToast((t) => (t && !t.open ? null : t))
      }, FORM_ERROR_TOAST_EXIT_MS)
    }, FORM_ERROR_TOAST_MS)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      cancelAnimationFrame(openToastRafRef.current)
      window.clearTimeout(hideTimer)
      if (removeAfterClose) {
        window.clearTimeout(removeAfterClose)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id])

  return { toast, showErrorToast, showSuccessToast, dismissErrorToast }
}
