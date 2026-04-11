import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PublishSnapshotResult, SnapshotMeta } from '../../entities/knowledge/types'
import {
  getEditorUnlockToken,
  isEditorUnlockConfigured,
} from '../../shared/config/editorGate'
import { useFormErrorToast } from '../../shared/hooks/useFormErrorToast'
import { formatPublishVersionFromDate } from '../../shared/lib/publishVersion'
import {
  type ColorTheme,
  useAppStore,
} from '../../shared/state/appStore'

/** Токен редактора (GitHub PAT для публикации + то же значение после ввода в диалоге). */
const EDITOR_TOKEN_STORAGE_KEY = 'knowhub-editor-token'
const LEGACY_GITHUB_PUBLISH_TOKEN_KEY = 'knowhub-github-publish-token'

const THEME_OPTIONS: { value: ColorTheme; label: string }[] = [
  { value: 'auto', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
]

type SettingsPanelProps = {
  releaseSourceConfigured: boolean
  snapshotMeta: SnapshotMeta
  publishState: PublishSnapshotResult | null
  onOpenUpdateDialog: () => void
  editorMode: boolean
  onEditorModeChange: (enabled: boolean) => void
  onPublishSnapshot: (payload: {
    token: string
    version: string
    releaseNotes?: string
  }) => Promise<void>
  onExportSnapshot: () => void
  onImportSnapshot: (file: File) => void
}

export function SettingsPanel({
  releaseSourceConfigured,
  snapshotMeta,
  publishState,
  onOpenUpdateDialog,
  editorMode,
  onEditorModeChange,
  onPublishSnapshot,
  onExportSnapshot,
  onImportSnapshot,
}: SettingsPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [editorToken, setEditorToken] = useState('')
  const [publishError, setPublishError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [editorUnlockDialogOpen, setEditorUnlockDialogOpen] = useState(false)
  const [snapshotDetailsOpen, setSnapshotDetailsOpen] = useState(false)
  const [editorUnlockInput, setEditorUnlockInput] = useState('')
  const [tokenHydrated, setTokenHydrated] = useState(false)
  const { toast, showErrorToast, showSuccessToast, dismissErrorToast } =
    useFormErrorToast()
  const colorTheme = useAppStore((s) => s.colorTheme)
  const setColorTheme = useAppStore((s) => s.setColorTheme)

  useEffect(() => {
    try {
      let stored = localStorage.getItem(EDITOR_TOKEN_STORAGE_KEY)
      if (!stored) {
        const legacy = localStorage.getItem(LEGACY_GITHUB_PUBLISH_TOKEN_KEY)
        if (legacy) {
          localStorage.setItem(EDITOR_TOKEN_STORAGE_KEY, legacy)
          stored = legacy
        }
      }
      setEditorToken(stored ?? '')
    } catch {
      setEditorToken('')
    }
    setTokenHydrated(true)
  }, [])

  useEffect(() => {
    if (!editorMode) {
      setEditorUnlockDialogOpen(false)
      setEditorUnlockInput('')
    }
  }, [editorMode])

  function persistEditorToken(value: string) {
    setEditorToken(value)
    try {
      localStorage.setItem(EDITOR_TOKEN_STORAGE_KEY, value)
    } catch {
      /* private mode / quota */
    }
  }

  function handleEditorSwitchChange(checked: boolean) {
    dismissErrorToast()
    if (!checked) {
      onEditorModeChange(false)
      setEditorUnlockDialogOpen(false)
      setEditorUnlockInput('')
      return
    }
    if (!isEditorUnlockConfigured()) {
      onEditorModeChange(true)
      return
    }
    setEditorUnlockInput('')
    setEditorUnlockDialogOpen(true)
  }

  function cancelEditorUnlock() {
    setEditorUnlockDialogOpen(false)
    setEditorUnlockInput('')
  }

  function confirmEditorUnlock() {
    const expected = getEditorUnlockToken()
    if (editorUnlockInput.trim() !== expected) {
      setEditorUnlockDialogOpen(false)
      setEditorUnlockInput('')
      showErrorToast('Неверный токен редактора.')
      return
    }
    const trimmed = editorUnlockInput.trim()
    persistEditorToken(trimmed)
    setEditorUnlockDialogOpen(false)
    setEditorUnlockInput('')
    onEditorModeChange(true)
    showSuccessToast('Режим редактора включён.')
  }

  async function handlePublish() {
    setPublishError(null)
    setIsPublishing(true)

    try {
      const version = formatPublishVersionFromDate()
      await onPublishSnapshot({
        token: editorToken.trim(),
        version,
      })
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : 'Не удалось опубликовать snapshot.',
      )
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <section className="settings-panel">
      <div className="settings-card">
        <h2>Тема оформления</h2>
        
        <div
          aria-label="Тема оформления"
          className="settings-theme-segment"
          role="radiogroup"
        >
          {THEME_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              aria-checked={colorTheme === value}
              className={`secondary-button settings-theme-segment__btn${colorTheme === value ? ' is-active' : ''}`}
              role="radio"
              type="button"
              onClick={() => setColorTheme(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-card">
        <h2>
          База{' '}
          <button
            aria-label={`Подробности snapshot, версия ${snapshotMeta.version}`}
            className="settings-heading-inline-version"
            type="button"
            onClick={() => setSnapshotDetailsOpen(true)}
          >
            [{snapshotMeta.version}]
          </button>
        </h2>
        <div className="settings-actions">
          <button
            className="primary-button"
            onClick={onOpenUpdateDialog}
            type="button"
          >
            Проверить обновления
          </button>
          <button
            className="secondary-button"
            onClick={onExportSnapshot}
            type="button"
          >
            Экспортировать…
          </button>
          <button
            className="secondary-button"
            onClick={() => importInputRef.current?.click()}
            type="button"
          >
            Импортировать…
          </button>
          <input
            ref={importInputRef}
            accept=".sqlite,application/octet-stream,application/x-sqlite3"
            className="visually-hidden"
            aria-label="Выбор файла snapshot"
            tabIndex={-1}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                onImportSnapshot(file)
              }
            }}
          />
        </div>
      </div>

      <div className="settings-card">
        <div className="ios-switch-row">
          <div className="ios-switch-row__text">
            <p className="ios-switch-row__title">Режим редактора</p>
           
          </div>
          <label className="ios-switch">
            <input
              aria-checked={editorMode}
              checked={editorMode}
              className="ios-switch__input"
              onChange={(event) => handleEditorSwitchChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
            <span className="ios-switch__track" />
          </label>
        </div>

        {editorMode ? (
          <>
            <div className="settings-form settings-form--tight-top">
              <label>
                <span>Токен редактора</span>
                <input
                  autoComplete="off"
                  disabled={!tokenHydrated}
                  type="password"
                  value={editorToken}
                  onChange={(event) => persistEditorToken(event.target.value)}
                />
              </label>
            </div>
           

            <div className="settings-actions">
              <button
                className="primary-button"
                disabled={
                  !editorToken.trim() ||
                  isPublishing ||
                  !releaseSourceConfigured
                }
                onClick={() => void handlePublish()}
                type="button"
              >
                {isPublishing ? 'Публикую…' : 'Опубликовать изменения'}
              </button>
            </div>
            
            {publishError ? (
              <p className="settings-message settings-message--error">{publishError}</p>
            ) : null}
            {publishState ? (
              <div className="settings-publish-result">
                <p className="settings-message">
                  Опубликована версия {publishState.version}
                </p>
                <p style={{marginTop: '-10px'}} className="settings-message">
               Контрольная сумма:{' '}
                {publishState.checksum}
              </p>
               
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {editorUnlockDialogOpen
        ? createPortal(
            <div
              aria-labelledby="settings-editor-unlock-title"
              className="article-delete-dialog-backdrop"
              role="presentation"
              onClick={cancelEditorUnlock}
            >
              <div
                aria-modal="true"
                className="article-delete-dialog"
                role="dialog"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    cancelEditorUnlock()
                  }
                }}
              >
                <h2
                  className="article-delete-dialog__title"
                  id="settings-editor-unlock-title"
                >
                  Включить режим редактора
                </h2>
                
                <label className="settings-dialog-field">
                  <span className="visually-hidden">Токен редактора</span>
                  <input
                    autoComplete="off"
                    className="settings-dialog-field__input"
                    placeholder="Токен редактора"
                    type="password"
                    value={editorUnlockInput}
                    onChange={(event) => setEditorUnlockInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        confirmEditorUnlock()
                      }
                    }}
                  />
                </label>
                <div className="article-delete-dialog__actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={cancelEditorUnlock}
                  >
                    Отмена
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={confirmEditorUnlock}
                  >
                    Включить
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {snapshotDetailsOpen
        ? createPortal(
            <div
              aria-labelledby="settings-snapshot-details-title"
              className="article-delete-dialog-backdrop"
              role="presentation"
              onClick={() => setSnapshotDetailsOpen(false)}
            >
              <div
                aria-modal="true"
                className="article-delete-dialog article-delete-dialog--wide"
                role="dialog"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSnapshotDetailsOpen(false)
                  }
                }}
              >
                <h2
                  className="article-delete-dialog__title"
                  id="settings-snapshot-details-title"
                >
                  Текущая база знаний
                </h2>
                
                <dl className="settings-snapshot-details">
                <div className="settings-snapshot-details-row">
                  <div>
                    <dt>Версия</dt>
                    <dd className="settings-code">{snapshotMeta.version}</dd>
                  </div>
                  
                 
                  <div>
                    <dt>Опубликован</dt>
                    <dd>
                      {new Date(snapshotMeta.publishedAt).toLocaleDateString(
                        'ru-RU',
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Статей</dt>
                    <dd>{snapshotMeta.articleCount}</dd>
                  </div>
                  </div>
                  <div>
                    <dt>Контрольная сумма</dt>
                    <dd className="settings-code settings-code--wrap">
                      {snapshotMeta.checksum}
                    </dd>
                  </div>
                 
                 
                </dl>
                <div className="article-delete-dialog__actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setSnapshotDetailsOpen(false)}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {createPortal(
        toast ? (
          <div
            aria-live="assertive"
            className={`form-error-toast${toast.variant === 'success' ? ' form-error-toast--success' : ''}${toast.open ? ' form-error-toast--open' : ''}`}
            role="alert"
          >
            {toast.message}
          </div>
        ) : null,
        document.body,
      )}
    </section>
  )
}
