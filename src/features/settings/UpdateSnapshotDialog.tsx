import { createPortal } from 'react-dom'
import type { UpdateCheckResult } from '../../entities/knowledge/types'

type UpdateSnapshotDialogProps = {
  open: boolean
  onClose: () => void
  isCheckingUpdates: boolean
  isApplyingUpdate: boolean
  updateState: UpdateCheckResult | null
  onApplyUpdate: (payload: {
    downloadUrl: string
    version: string
    manifestUrl?: string | null
    checksum?: string
  }) => Promise<void>
}

export function UpdateSnapshotDialog({
  open,
  onClose,
  isCheckingUpdates,
  isApplyingUpdate,
  updateState,
  onApplyUpdate,
}: UpdateSnapshotDialogProps) {
  if (!open) {
    return null
  }

  async function handleApply() {
    if (updateState?.status !== 'update-available' || !updateState.assetUrl) {
      return
    }
    try {
      await onApplyUpdate({
        downloadUrl: updateState.assetUrl,
        version: updateState.latestVersion,
        manifestUrl: updateState.manifestUrl,
        checksum: updateState.checksum,
      })
      onClose()
    } catch {
      /* сообщение уже в updateState */
    }
  }

  return createPortal(
    <div
      aria-labelledby="settings-update-dialog-title"
      className="article-delete-dialog-backdrop"
      role="presentation"
      onClick={() => !isApplyingUpdate && onClose()}
    >
      <div
        aria-modal="true"
        className="article-delete-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          className="article-delete-dialog__title"
          id="settings-update-dialog-title"
        >
          Обновление базы
        </h2>
        {isCheckingUpdates ? (
          <p className="article-delete-dialog__text">Проверяю обновления…</p>
        ) : updateState ? (
          <>
            <p className="article-delete-dialog__text">{updateState.message}</p>
            {updateState.status === 'update-available' && updateState.assetUrl ? (
              <p className="article-delete-dialog__question">
                Текущая версия в релизе:{' '}
                <span className="settings-code">{updateState.latestVersion}</span>
              </p>
            ) : null}
          </>
        ) : (
          <p className="article-delete-dialog__text">Запускаю проверку…</p>
        )}

        <div className="article-delete-dialog__actions">
          <button
            className="secondary-button"
            disabled={isApplyingUpdate}
            type="button"
            onClick={onClose}
          >
            Закрыть
          </button>
          {updateState?.status === 'update-available' &&
          updateState.assetUrl &&
          !isCheckingUpdates ? (
            <button
              className="primary-button"
              disabled={isApplyingUpdate}
              type="button"
              onClick={() => void handleApply()}
            >
              {isApplyingUpdate ? 'Применяю…' : 'Обновить'}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
