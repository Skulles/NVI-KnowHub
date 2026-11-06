import React from 'react'
import { SectionTarget } from '../api'
import { titleToHtmlFile } from '../utils'

interface Props {
  target: SectionTarget | null
  articleId: string
  title: string
  isRepublish: boolean
  onConfirm: () => void
  onClose: () => void
}

export function PublishDialog({
  target,
  articleId,
  title,
  isRepublish,
  onConfirm,
  onClose
}: Props): React.ReactElement {
  const hasTarget = !!target?.sectionId
  const htmlFile = titleToHtmlFile(title, articleId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="admin-dialog">
        <h2 className="mb-1 text-[15px] font-semibold tracking-tight text-label-primary">
          {isRepublish ? 'Публикация изменений' : 'Публикация статьи'}
        </h2>
        <p className="mb-4 text-[13px] text-label-secondary">
          {isRepublish
            ? 'Текущая версия в приложении будет заменена сохранённым черновиком.'
            : 'Статья появится в приложении после публикации.'}
        </p>

        {hasTarget ? (
          <div className="mb-4 admin-card px-3 py-2.5 border-tint-blue/25 bg-tint-blue/[0.06]">
            <p className="admin-section-label mb-1 text-tint-blue/70">Раздел</p>
            <p className="text-[13px] font-medium text-label-primary">{target!.sectionTitle}</p>
            {target!.subsectionId && (
              <p className="mt-0.5 text-[12px] text-label-secondary">{target!.subsectionTitle}</p>
            )}
          </div>
        ) : (
          <div className="mb-4 admin-card px-3 py-2.5 border-amber-500/25 bg-amber-500/[0.06]">
            <p className="text-[13px] text-amber-400">
              Выберите раздел в панели слева перед публикацией
            </p>
          </div>
        )}

        <div className="mb-5 admin-card px-3 py-2.5">
          <p className="admin-section-label mb-1">Файл</p>
          <p className="font-mono text-[12px] text-label-secondary">{htmlFile}</p>
          <p className="mt-1.5 text-[11px] text-label-tertiary">
            Имя формируется автоматически из заголовка
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="admin-btn-secondary px-4 py-2 text-[13px]">
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!hasTarget}
            className="admin-btn-primary px-4 py-2 text-[13px]"
          >
            {isRepublish ? 'Опубликовать изменения' : 'Опубликовать'}
          </button>
        </div>
      </div>
    </div>
  )
}
