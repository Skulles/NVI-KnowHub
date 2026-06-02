import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const confirm = useContext(ConfirmContext)
  if (!confirm) {
    throw new Error('useConfirm must be used within ConfirmProvider')
  }
  return confirm
}

function ConfirmModal({
  pending,
  onConfirm,
  onCancel
}: {
  pending: PendingConfirm
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  const isDanger = pending.variant === 'danger'
  const confirmLabel = pending.confirmLabel ?? (isDanger ? 'Удалить' : 'Подтвердить')
  const cancelLabel = pending.cancelLabel ?? 'Отмена'

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="admin-dialog w-full max-w-sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={pending.message ? 'confirm-dialog-desc' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-[15px] font-semibold tracking-tight text-label-primary">
          {pending.title}
        </h2>
        {pending.message && (
          <p id="confirm-dialog-desc" className="mt-2 text-[13px] leading-relaxed text-label-secondary">
            {pending.message}
          </p>
        )}

        <div className="mt-6 flex gap-3 justify-end">
          <button type="button" onClick={onCancel} className="admin-btn-secondary px-4 py-2 text-[13px]">
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={
              isDanger
                ? 'rounded-lg px-4 py-2 text-[13px] font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors'
                : 'admin-btn-primary px-4 py-2 text-[13px]'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  const close = useCallback((result: boolean): void => {
    setPending((current) => {
      current?.resolve(result)
      return null
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmModal
          pending={pending}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </ConfirmContext.Provider>
  )
}
