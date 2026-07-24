import React, { useMemo, useRef, useLayoutEffect } from 'react'
import { attachArticleCodeCopyButtons } from '../../lib/article-code-copy'
import { sanitizeArticleHtml } from '../../lib/sanitize-article-html'
import { attachArticleCodeHints } from '../../lib/article-code-hints'
import { useContentStore } from '../../store/content'
import { getToolComponent } from '../../tools/registry'
import { ArticleToc, TocNav, articleHasToc, splitBodyAtFirstHeading } from './TableOfContents'

function parseArticleHtml(html: string): { leadInner: string | undefined; bodyHtml: string } {
  const safeHtml = sanitizeArticleHtml(html)
  const rest = safeHtml.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i, '').trim()
  const leadRe = /^<p[^>]*\bclass="[^"]*\blead\b[^"]*"[^>]*>([\s\S]*?)<\/p>\s*/i
  const match = rest.match(leadRe)
  if (match) {
    return {
      leadInner: match[1],
      bodyHtml: rest.slice(match[0].length).trim()
    }
  }
  return { leadInner: undefined, bodyHtml: rest }
}

function useArticleEnhancements(ref: React.RefObject<HTMLElement | null>, contentKey: string): void {
  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    const cleanupCopy = attachArticleCodeCopyButtons(container)
    const cleanupHints = attachArticleCodeHints(container)
    const cleanupLinks = attachExternalLinks(container)
    const cleanupMedia = attachArticleMedia(container)
    return () => {
      cleanupCopy()
      cleanupHints()
      cleanupLinks()
      cleanupMedia()
    }
  }, [ref, contentKey])
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href)
}

function attachExternalLinks(container: HTMLElement): () => void {
  const cleanups: (() => void)[] = []

  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? ''
    if (!isExternalHref(href)) return

    link.target = '_blank'
    link.rel = 'noreferrer'

    const onClick = (event: MouseEvent): void => {
      event.preventDefault()
      void window.api?.openExternal(link.href)
    }

    link.addEventListener('click', onClick)
    cleanups.push(() => link.removeEventListener('click', onClick))
  })

  return () => cleanups.forEach((fn) => fn())
}

function attachArticleMedia(container: HTMLElement): () => void {
  const cleanups: (() => void)[] = []

  container.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video').forEach((media) => {
    const wrapper = media.closest<HTMLElement>('.article-image-wrap, .article-video-wrap')
    if (!wrapper) return

    wrapper.classList.remove('is-loading', 'is-error')

    const markLoaded = (): void => wrapper.classList.remove('is-loading')
    const markError = (): void => {
      wrapper.classList.remove('is-loading')
      wrapper.classList.add('is-error')
    }

    if (media instanceof HTMLImageElement) {
      media.draggable = false
      if (media.complete) {
        markLoaded()
      } else {
        wrapper.classList.add('is-loading')
        media.addEventListener('load', markLoaded)
        media.addEventListener('error', markError)
        cleanups.push(() => {
          media.removeEventListener('load', markLoaded)
          media.removeEventListener('error', markError)
        })
      }
      return
    }

    media.muted = true
    media.loop = true
    media.autoplay = true
    media.playsInline = true
    media.controls = false
    media.disablePictureInPicture = true

    const play = (): void => {
      void media.play().catch(() => {
        // Autoplay can still be delayed by the engine; keep the skeleton off once data is ready.
      })
    }

    if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      markLoaded()
      play()
    } else {
      wrapper.classList.add('is-loading')
      media.addEventListener('loadeddata', markLoaded)
      media.addEventListener('canplay', play)
      media.addEventListener('error', markError)
      cleanups.push(() => {
        media.removeEventListener('loadeddata', markLoaded)
        media.removeEventListener('canplay', play)
        media.removeEventListener('error', markError)
      })
    }
  })

  return () => cleanups.forEach((fn) => fn())
}

function ArticleDocument({ html, title }: { html: string; title: string }): React.ReactElement {
  const { leadInner, bodyHtml } = useMemo(() => parseArticleHtml(html), [html])
  const bodySplit = useMemo(() => splitBodyAtFirstHeading(bodyHtml), [bodyHtml])
  const articleRef = useRef<HTMLElement>(null)
  const contentWrapperRef = useRef<HTMLDivElement>(null)

  useArticleEnhancements(contentWrapperRef, bodyHtml)

  return (
    <ArticleToc containerRef={contentWrapperRef} contentKey={bodyHtml}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,46rem)_11rem] xl:justify-center">
        <div ref={contentWrapperRef} className="article-view min-w-0">
          <header className="mb-9 px-0.5">
            <h1 className="text-[2rem] font-semibold tracking-[-0.032em] leading-[1.15] text-label-primary">{title}</h1>
            {leadInner && (
              <p
                className="article-lead mt-5 text-[16px] leading-[1.64] [&_strong]:font-semibold [&_strong]:text-label-primary"
                dangerouslySetInnerHTML={{ __html: leadInner }}
              />
            )}
          </header>
          {bodySplit?.before ? (
            <div
              className="article-body article-content max-w-none"
              dangerouslySetInnerHTML={{ __html: bodySplit.before }}
            />
          ) : null}
          <TocNav variant="inline" />
          <article
            ref={articleRef}
            className="article-body article-content max-w-none"
            dangerouslySetInnerHTML={{ __html: bodySplit?.rest ?? bodyHtml }}
          />
        </div>
        <TocNav variant="sidebar" />
      </div>
    </ArticleToc>
  )
}

function ToolView({ toolId }: { toolId: string }): React.ReactElement {
  const Tool = getToolComponent(toolId)
  if (!Tool) {
    return (
      <div className="tool-view">
        <div className="rounded-2xl border border-surface-border bg-surface-card px-8 py-9 sm:px-10 sm:py-10 shadow-sheet ring-1 ring-surface-border/40">
          <div className="py-12 text-center text-label-tertiary">
            <p className="text-[16px] font-medium text-label-secondary">Инструмент не найден</p>
            <p className="mt-1.5 font-mono text-[14px] opacity-75">ID: {toolId}</p>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="tool-view">
      <Tool />
    </div>
  )
}

function ContentSpinner({ label = 'Загрузка' }: { label?: string }): React.ReactElement {
  return (
    <div
      className="flex min-h-[min(440px,calc(100vh-13rem))] flex-col items-center justify-center px-6 select-none"
      aria-busy
      aria-label={label}
    >
      <div className="knowhub-spinner" aria-hidden />
    </div>
  )
}

function EmptyState(): React.ReactElement {
  return <ContentSpinner />
}

function ArticleLoadingSkeleton({ title }: { title: string }): React.ReactElement {
  return (
    <div
      className="article-loading grid items-start gap-6 xl:grid-cols-[minmax(0,46rem)_11rem] xl:justify-center"
      aria-busy
      aria-label="Загрузка статьи"
    >
      <div className="min-w-0">
        <header className="mb-9 px-0.5">
          <h1 className="text-[2rem] font-semibold tracking-[-0.032em] leading-[1.15] text-label-primary">
            {title}
          </h1>
          <div className="mt-5 space-y-2.5">
            <div className="article-loading__block article-loading__line w-[94%]" />
            <div className="article-loading__block article-loading__line w-[72%]" />
          </div>
        </header>

        <aside className="mb-6 xl:hidden" aria-hidden>
          <div className="article-loading__block h-3.5 w-24 mb-2.5" />
          <div className="space-y-2.5">
            {[0.92, 0.78, 0.85, 0.64].map((width, index) => (
              <div
                key={index}
                className="article-loading__block article-loading__toc-line"
                style={{ width: `${width * 100}%` }}
              />
            ))}
          </div>
        </aside>

        <div className="space-y-3 pb-10">
          <div className="article-loading__block article-loading__line w-[42%]" />
          <div className="article-loading__block article-loading__row w-full" />
          <div className="article-loading__block article-loading__row w-full" />
          <div className="article-loading__block article-loading__row w-[88%]" />
          <div className="article-loading__block article-loading__line w-[36%] mt-2" />
          <div className="article-loading__block article-loading__row w-full" />
          <div className="article-loading__block article-loading__row w-[92%]" />
        </div>
      </div>

      <aside className="hidden xl:block" aria-hidden>
        <div className="sticky top-24 space-y-3 pl-1">
          {[0.92, 0.78, 0.85, 0.64].map((width, index) => (
            <div
              key={index}
              className="article-loading__block article-loading__toc-line"
              style={{ width: `${width * 100}%` }}
            />
          ))}
        </div>
      </aside>
    </div>
  )
}

function LoadingState(): React.ReactElement {
  return (
    <div
      className="mx-auto max-w-xl animate-pulse rounded-2xl border border-surface-border/80 bg-surface-card/50 p-12 shadow-sheet"
      aria-busy
      aria-label="Загрузка"
    >
      <div className="mx-auto mb-10 h-6 w-[38%] max-w-[12rem] rounded-md bg-white/[0.08]" />
      <div className="space-y-4">
        <div className="h-14 rounded-xl bg-white/[0.05]" />
        <div className="h-14 rounded-xl bg-white/[0.05]" />
        <div className="h-[5.5rem] rounded-xl bg-white/[0.04]" />
      </div>
    </div>
  )
}

export function ContentArea(): React.ReactElement {
  const { selectedItem, articleHtml, loading } = useContentStore()

  const articleShowsToc =
    !loading &&
    selectedItem?.type === 'article' &&
    !!articleHtml &&
    articleHasToc(parseArticleHtml(articleHtml).bodyHtml)

  return (
    <main className="relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface-window">
      <div
        className="pointer-events-none absolute inset-0 bg-[var(--page-glow)]"
        aria-hidden
      />

      <div
        className={`relative z-[1] mx-auto w-full max-w-[78rem] px-6 py-12 sm:px-10 sm:py-14 lg:pl-14 lg:pr-12${articleShowsToc ? ' xl:pr-6' : ''}`}
      >
        {loading && selectedItem?.type === 'article' && (
          <ArticleLoadingSkeleton title={selectedItem.title} />
        )}

        {loading && selectedItem?.type !== 'article' && <LoadingState />}

        {!loading && !selectedItem && <EmptyState />}

        {!loading && selectedItem?.type === 'article' && articleHtml && (
          <ArticleDocument html={articleHtml} title={selectedItem.title} />
        )}

        {!loading && selectedItem?.type === 'tool' && selectedItem.toolId && (
          <ToolView toolId={selectedItem.toolId} />
        )}
      </div>
    </main>
  )
}
