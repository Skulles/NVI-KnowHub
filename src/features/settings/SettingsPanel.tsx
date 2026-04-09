import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  GitHubReleaseSettings,
  PublishSnapshotResult,
  SnapshotMeta,
  UpdateCheckResult,
} from '../../entities/knowledge/types'

type SettingsPanelProps = {
  releaseSource: GitHubReleaseSettings
  releaseSourceConfigured: boolean
  snapshotMeta: SnapshotMeta
  moderatorMode: boolean
  publishState: PublishSnapshotResult | null
  updateState: UpdateCheckResult | null
  isCheckingUpdates: boolean
  isApplyingUpdate: boolean
  onModeratorModeChange: (enabled: boolean) => void
  onCheckUpdates: () => void
  onApplyUpdate: (payload: {
    downloadUrl: string
    version: string
    manifestUrl?: string | null
    checksum?: string
  }) => Promise<void>
  onPublishSnapshot: (payload: {
    token: string
    version: string
    releaseNotes?: string
  }) => Promise<void>
  onExportSnapshot: () => void
  onImportSnapshot: (file: File) => void
}

export function SettingsPanel({
  releaseSource,
  releaseSourceConfigured,
  snapshotMeta,
  moderatorMode,
  publishState,
  updateState,
  isCheckingUpdates,
  isApplyingUpdate,
  onModeratorModeChange,
  onCheckUpdates,
  onApplyUpdate,
  onPublishSnapshot,
  onExportSnapshot,
  onImportSnapshot,
}: SettingsPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [publishToken, setPublishToken] = useState('')
  const [publishVersion, setPublishVersion] = useState(snapshotMeta.version)
  const [releaseNotes, setReleaseNotes] = useState('')
  const [publishError, setPublishError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)

  useEffect(() => {
    setPublishVersion(snapshotMeta.version)
  }, [snapshotMeta.version])

  const canApplyUpdate = useMemo(
    () => updateState?.status === 'update-available',
    [updateState],
  )

  const releaseSourceSummary = useMemo(() => {
    if (!releaseSourceConfigured) {
      return 'Не задан (переменные VITE_* при сборке)'
    }
    return `${releaseSource.owner}/${releaseSource.repo}`
  }, [releaseSource, releaseSourceConfigured])

  async function handlePublish() {
    setPublishError(null)
    setIsPublishing(true)

    try {
      await onPublishSnapshot({
        token: publishToken,
        version: publishVersion,
        releaseNotes,
      })
      setPublishToken('')
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
        <h2>Текущее состояние</h2>
        <dl className="settings-grid">
          <div>
            <dt>Версия snapshot</dt>
            <dd>{snapshotMeta.version}</dd>
          </div>
          <div>
            <dt>Schema version</dt>
            <dd>{snapshotMeta.schemaVersion}</dd>
          </div>
          <div>
            <dt>Источник</dt>
            <dd>{snapshotMeta.source}</dd>
          </div>
          <div>
            <dt>Опубликован</dt>
            <dd>{new Date(snapshotMeta.publishedAt).toLocaleString('ru-RU')}</dd>
          </div>
          <div>
            <dt>Локально обновлен</dt>
            <dd>{new Date(snapshotMeta.updatedAt).toLocaleString('ru-RU')}</dd>
          </div>
          <div>
            <dt>Контрольная сумма</dt>
            <dd className="settings-code">{snapshotMeta.checksum}</dd>
          </div>
          <div>
            <dt>Разделов</dt>
            <dd>{snapshotMeta.sectionCount}</dd>
          </div>
          <div>
            <dt>Статей</dt>
            <dd>{snapshotMeta.articleCount}</dd>
          </div>
          <div>
            <dt>Модераторский режим</dt>
            <dd>{moderatorMode ? 'Включен' : 'Выключен'}</dd>
          </div>
        </dl>
      </div>

      <div className="settings-card">
        <h2>Модераторский доступ</h2>
        <label className="toggle-row">
          <span>Разрешить локальное редактирование на этом устройстве</span>
          <input
            checked={moderatorMode}
            onChange={(event) => onModeratorModeChange(event.target.checked)}
            type="checkbox"
          />
        </label>
      </div>

      <div className="settings-card">
        <h2>Источник обновлений (GitHub Releases)</h2>
        <p className="settings-message">
          Репозиторий и имена файлов задаются при сборке приложения (см.{' '}
          <code className="settings-code">.env.example</code>
          ), в интерфейсе не меняются.
        </p>
        <dl className="settings-grid">
          <div>
            <dt>Репозиторий</dt>
            <dd className="settings-code">{releaseSourceSummary}</dd>
          </div>
          <div>
            <dt>Файл snapshot</dt>
            <dd className="settings-code">
              {releaseSource.assetName || '—'}
            </dd>
          </div>
          <div>
            <dt>Manifest</dt>
            <dd className="settings-code">
              {releaseSource.manifestAssetName || '—'}
            </dd>
          </div>
        </dl>

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={isCheckingUpdates || !releaseSourceConfigured}
            onClick={onCheckUpdates}
            type="button"
          >
            {isCheckingUpdates ? 'Проверяю...' : 'Проверить обновления'}
          </button>
          <button
            className="primary-button"
            disabled={!canApplyUpdate || isApplyingUpdate}
            onClick={() => {
              if (
                updateState?.status === 'update-available' &&
                updateState.assetUrl
              ) {
                void onApplyUpdate({
                  downloadUrl: updateState.assetUrl,
                  version: updateState.latestVersion,
                  manifestUrl: updateState.manifestUrl,
                  checksum: updateState.checksum,
                })
              }
            }}
            type="button"
          >
            {isApplyingUpdate ? 'Применяю...' : 'Загрузить snapshot'}
          </button>
        </div>

        <p className="settings-message">
          {updateState?.message ??
            (releaseSourceConfigured
              ? 'Приложение проверяет новые release-assets по зашитому источнику и безопасно применяет snapshot.'
              : 'Настройте VITE_GITHUB_OWNER, VITE_GITHUB_REPO и VITE_RELEASE_ASSET_NAME для проверки обновлений.')}
        </p>
      </div>

      <div className="settings-card">
        <h2>Локальный импорт и экспорт базы</h2>
        <p className="settings-message">
          Файл <code className="settings-code">.sqlite</code> — это официальный snapshot: статьи и вложенные медиа в таблице assets. Локальные черновики и их отдельное хранилище медиа в этот файл не попадают.
        </p>
        <div className="settings-actions">
          <button
            className="secondary-button"
            onClick={onExportSnapshot}
            type="button"
          >
            Экспортировать базу…
          </button>
          <button
            className="secondary-button"
            onClick={() => importInputRef.current?.click()}
            type="button"
          >
            Импортировать базу…
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
        <h2>Публикация snapshot</h2>
        <div className="settings-form">
          <label>
            <span>Новая версия</span>
            <input
              value={publishVersion}
              onChange={(event) => setPublishVersion(event.target.value)}
            />
          </label>
          <label>
            <span>GitHub token</span>
            <input
              type="password"
              value={publishToken}
              onChange={(event) => setPublishToken(event.target.value)}
            />
          </label>
          <label>
            <span>Release notes</span>
            <textarea
              className="settings-textarea"
              rows={4}
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
            />
          </label>
        </div>

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={
              !moderatorMode ||
              isPublishing ||
              !releaseSourceConfigured
            }
            onClick={() => void handlePublish()}
            type="button"
          >
            {isPublishing ? 'Публикую...' : 'Опубликовать snapshot'}
          </button>
        </div>

        <p className="settings-message">
          {moderatorMode
            ? releaseSourceConfigured
              ? 'При публикации активные черновики встраиваются в официальный snapshot, затем загружаются `.sqlite` и manifest в репозиторий из переменных сборки.'
              : 'Задайте VITE_GITHUB_* при сборке, чтобы публиковать в репозиторий.'
            : 'Для публикации включите модераторский режим на этом устройстве.'}
        </p>

        {publishError ? (
          <p className="settings-message settings-message--error">{publishError}</p>
        ) : null}

        {publishState ? (
          <div className="settings-publish-result">
            <p className="settings-message">
              Опубликована версия {publishState.version} с checksum {publishState.checksum}.
            </p>
            <a href={publishState.releaseUrl} rel="noreferrer" target="_blank">
              Открыть release
            </a>
          </div>
        ) : null}
      </div>
    </section>
  )
}
