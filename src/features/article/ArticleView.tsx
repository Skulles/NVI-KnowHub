import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ArticleDraft,
  AudienceKind,
  KnowledgeArticle,
} from '../../entities/knowledge/types'
import {
  type ArticleTocItem,
  knowledgeBase,
  renderArticleBodyForView,
} from '../../shared/lib/content/knowledge'

type ArticleViewProps = {
  article: KnowledgeArticle | null
  /** Загрузка статьи по URL (смена slug) до ответа базы */
  articleRouteLoading: boolean
  activeAudience: AudienceKind
  draft: ArticleDraft | null
  editorMode: boolean
  onOpenEditor: () => void
}

function ArticleViewLoading() {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="article-view-loading"
      role="status"
    >
      <div aria-hidden className="boot-loader">
        <div className="boot-loader__spinner" />
      </div>
      <span className="visually-hidden">Загрузка статьи</span>
    </section>
  )
}

export function ArticleView({
  article,
  articleRouteLoading,
  activeAudience,
  draft,
  editorMode,
  onOpenEditor,
}: ArticleViewProps) {
  const preview = useMemo(() => {
    if (!article) {
      return null
    }
    if (draft && editorMode) {
      return {
        ...article,
        title: draft.title,
        summary: draft.summary,
        contentJson: draft.contentJson,
        contentText: draft.contentText,
        sectionId: draft.sectionId ?? article.sectionId,
        forBu: draft.forBu ?? article.forBu,
        forTkrs: draft.forTkrs ?? article.forTkrs,
      }
    }
    return article
  }, [article, draft, editorMode])

  const [resolvedContent, setResolvedContent] = useState<{
    sourceContentJson: string
    contentJson: string
  } | null>(null)

  useEffect(() => {
    if (!preview) {
      return
    }

    let cancelled = false

    void (async () => {
      const nextContentJson =
        draft && editorMode
          ? await knowledgeBase.resolveDraftContent(preview.contentJson)
          : await knowledgeBase.resolveArticleContent(preview.contentJson)

      if (!cancelled) {
        setResolvedContent({
          sourceContentJson: preview.contentJson,
          contentJson: nextContentJson,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [preview, draft, editorMode])

  const resolvedContentJson =
    preview && resolvedContent?.sourceContentJson === preview.contentJson
      ? resolvedContent.contentJson
      : null

  const { html: bodyHtml, toc } = useMemo((): {
    html: string
    toc: ArticleTocItem[]
  } => {
    if (!preview || !resolvedContentJson) {
      return { html: '', toc: [] }
    }
    return renderArticleBodyForView(resolvedContentJson)
  }, [preview, resolvedContentJson])

  const articleBodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = articleBodyRef.current
    if (!root || !bodyHtml) {
      return
    }

    const copyIconSvg = `<svg class="article-body__code-copy-icon--copy" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>`
    const checkIconSvg = `<svg class="article-body__code-copy-icon--check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>`

    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement?.classList.contains('article-body__pre-wrap')) {
        return
      }
      const wrap = document.createElement('div')
      wrap.className = 'article-body__pre-wrap'
      pre.replaceWith(wrap)
      wrap.appendChild(pre)

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'article-body__code-copy'
      btn.title = 'Копировать код'
      btn.setAttribute('aria-label', 'Копировать код')
      btn.innerHTML = copyIconSvg + checkIconSvg

      let copiedTimer: ReturnType<typeof setTimeout> | undefined
      const onClick = () => {
        void (async () => {
          try {
            const text =
              pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
            await navigator.clipboard.writeText(text)
            btn.classList.add('article-body__code-copy--copied')
            window.clearTimeout(copiedTimer)
            copiedTimer = window.setTimeout(() => {
              btn.classList.remove('article-body__code-copy--copied')
            }, 2200)
          } catch {
            /* ignore */
          }
        })()
      }
      btn.addEventListener('click', onClick)
      wrap.appendChild(btn)
    })
  }, [bodyHtml])

  if (articleRouteLoading) {
    return <ArticleViewLoading />
  }

  if (!article || !preview) {
    return (
      <section className="empty-state">
        <h2>Статья не найдена</h2>
        <p>Выберите материал слева или откройте раздел настроек.</p>
      </section>
    )
  }

  const matchesAudience =
    activeAudience === 'bu' ? preview.forBu : preview.forTkrs

  const editLabel = draft ? 'Редактировать черновик' : 'Открыть редактор'

  return (
    <article className="article-view">
      <header className="article-header">
        <div className="article-header__intro">
          <div className="article-title-row">
            <h1>{preview.title}</h1>
            {editorMode ? (
              <button
                aria-label={editLabel}
                className="article-edit-btn"
                title={editLabel}
                type="button"
                onClick={onOpenEditor}
              >
                <ArticleEditIcon />
              </button>
            ) : null}
          </div>
          <span
            className="article-audience-badges"
            title="Контуры, для которых актуален материал"
          >
            {preview.forBu ? (
              <span className="audience-pill audience-pill--bu">БУРОВАЯ</span>
            ) : null}
            {preview.forTkrs ? (
              <span className="audience-pill audience-pill--tkrs">ТКРС</span>
            ) : null}
          </span>
          <p className="article-summary">{preview.summary}</p>
        </div>
      </header>

      {!matchesAudience && (
        <div className="audience-mismatch-banner" role="status">
          Материал не относится к выбранному контуру (
          {activeAudience === 'bu' ? 'БУРОВАЯ' : 'ТКРС'}). Переключите «БУРОВАЯ / ТКРС» в
          сайдбаре или выберите статью из списка для нужного контура.
        </div>
      )}

      {draft && (
        <div className="draft-banner">
          {draft.status === 'orphaned'
            ? `Черновик сохранен локально, но его исходная статья отсутствует в актуальном snapshot. ${draft.issue ?? ''}`
            : `Показан локальный черновик от ${new Date(draft.updatedAt).toLocaleString('ru-RU')}. Он еще не опубликован для остальных пользователей.`}
        </div>
      )}

      {toc.length > 0 ? (
        <nav aria-label="Содержание статьи" className="article-toc">
          <p className="article-toc__heading">Содержание</p>
          <ul className="article-toc__list">
            {toc.map((item) => (
              <li key={item.id}>
                <a className="article-toc__link" href={`#${item.id}`}>
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {resolvedContentJson ? (
        <div
          ref={articleBodyRef}
          className="article-body"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        <div
          aria-busy="true"
          className="article-view-loading article-view-loading--embed"
          role="status"
        >
          <div aria-hidden className="boot-loader">
            <div className="boot-loader__spinner" />
          </div>
          <span className="visually-hidden">Загрузка содержимого</span>
        </div>
      )}

      <p className="article-meta article-meta--footer">
        Обновлено {new Date(preview.updatedAt).toLocaleDateString('ru-RU')}
      </p>
    </article>
  )
}

function ArticleEditIcon() {
  return (
    <svg
      aria-hidden
      className="article-edit-btn__icon"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path
        d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}
