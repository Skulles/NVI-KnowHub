import React from 'react'
import {
  ArticlePublishStatus,
  PUBLISH_STATUS_LABEL,
  getArticlePublishStatus
} from '../utils'

interface Props {
  published: boolean
  updatedAt: string | null
  publishedAt: string | null
  compact?: boolean
}

const STATUS_STYLE: Record<ArticlePublishStatus, string> = {
  draft: 'border-surface-border bg-surface-raised/60 text-label-tertiary',
  published: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  modified: 'border-amber-500/25 bg-amber-500/10 text-amber-400'
}

const DOT_STYLE: Record<ArticlePublishStatus, string> = {
  draft: 'bg-label-tertiary/70',
  published: 'bg-emerald-400',
  modified: 'bg-amber-400'
}

export function PublishStatusDot({
  published,
  updatedAt,
  publishedAt
}: Props): React.ReactElement {
  const status = updatedAt
    ? getArticlePublishStatus(published, updatedAt, publishedAt)
    : 'draft'
  const label = PUBLISH_STATUS_LABEL[status]

  return (
    <span
      className={`w-2 h-2 shrink-0 rounded-full ${DOT_STYLE[status]} ring-1 ring-black/20`}
      title={
        status === 'modified' && publishedAt
          ? `${label}. Опубликовано: ${new Date(publishedAt).toLocaleString('ru')}`
          : label
      }
      aria-label={label}
    />
  )
}

export function PublishStatusBadge({
  published,
  updatedAt,
  publishedAt,
  compact = false
}: Props): React.ReactElement | null {
  if (!updatedAt) return null

  const status = getArticlePublishStatus(published, updatedAt, publishedAt)
  const label = PUBLISH_STATUS_LABEL[status]

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.08em] ${STATUS_STYLE[status]} ${
        compact ? 'text-[10px]' : 'text-[11px]'
      }`}
      title={
        status === 'modified' && publishedAt
          ? `Опубликовано: ${new Date(publishedAt).toLocaleString('ru')}`
          : undefined
      }
    >
      {label}
    </span>
  )
}
