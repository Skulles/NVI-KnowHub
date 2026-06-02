import React, { useMemo, useRef, useEffect } from 'react'
import { useContentStore } from '../../store/content'
import { getToolComponent } from '../../tools/registry'
import { BookIcon } from '../Icons'
import { TableOfContents } from './TableOfContents'

function parseArticleHtml(html: string): { leadInner: string | undefined; bodyHtml: string } {
  let rest = html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i, '').trim()
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

function useCopyButtons(ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    const container = ref.current
    if (!container) return

    const preEls = Array.from(container.querySelectorAll<HTMLElement>('pre'))
    const cleanups: (() => void)[] = []

    preEls.forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return

      const btn = document.createElement('button')
      btn.className = 'copy-btn'
      btn.textContent = 'Копировать'

      const handleClick = (): void => {
        const text = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Скопировано'
          btn.classList.add('copied')
          setTimeout(() => {
            btn.textContent = 'Копировать'
            btn.classList.remove('copied')
          }, 2000)
        })
      }

      btn.addEventListener('click', handleClick)
      pre.appendChild(btn)
      cleanups.push(() => btn.removeEventListener('click', handleClick))
    })

    return () => cleanups.forEach((fn) => fn())
  })
}

function ArticleDocument({ html, title }: { html: string; title: string }): React.ReactElement {
  const { leadInner, bodyHtml } = useMemo(() => parseArticleHtml(html), [html])
  const articleRef = useRef<HTMLElement>(null)

  useCopyButtons(articleRef)

  return (
    <div className="flex items-start">
      <div className="min-w-0 flex-1">
        <header className="mb-9 px-0.5">
          <h1 className="text-[1.8125rem] font-semibold tracking-[-0.032em] text-label-primary leading-[1.1]">{title}</h1>
          {leadInner && (
            <p
              className="mt-5 text-[15px] leading-[1.62] text-label-secondary [&_strong]:font-medium [&_strong]:text-label-primary/88"
              dangerouslySetInnerHTML={{ __html: leadInner }}
            />
          )}
        </header>
        <article
          ref={articleRef}
          className="article-body article-content max-w-none"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
      <TableOfContents containerRef={articleRef} />
    </div>
  )
}

function ToolView({ toolId }: { toolId: string }): React.ReactElement {
  const Tool = getToolComponent(toolId)
  if (!Tool) {
    return (
      <div className="rounded-2xl border border-surface-border bg-surface-card px-8 py-9 sm:px-10 sm:py-10 shadow-sheet ring-1 ring-surface-border/40">
        <div className="py-12 text-center text-label-tertiary">
          <p className="text-[15px] font-medium text-label-secondary">Инструмент не найден</p>
          <p className="mt-1.5 font-mono text-[13px] opacity-75">ID: {toolId}</p>
        </div>
      </div>
    )
  }
  return <Tool />
}

function EmptyState(): React.ReactElement {
  return (
    <div className="flex min-h-[min(440px,calc(100vh-13rem))] flex-col items-center justify-center px-6 select-none">
      <div
        className="relative mb-8 flex h-[5.25rem] w-[5.25rem] items-center justify-center rounded-[1.375rem]
          bg-gradient-to-br from-surface-raised via-surface-card to-surface-window shadow-sheet ring-1 ring-surface-border"
        aria-hidden
      >
        <div className="absolute inset-0 rounded-[1.375rem] bg-gradient-to-t from-transparent to-tint-blue/16" />
        <BookIcon className="relative h-[2rem] w-[2rem] text-label-primary/35" />
      </div>
      <p className="mb-2 text-center text-lg font-semibold tracking-tight text-label-primary">
        Выберите материал
      </p>
      <p className="max-w-[26rem] text-center text-[14px] leading-relaxed text-label-secondary">
        Выберите пункт в дереве слева. Работа без подключения к сети.
      </p>
    </div>
  )
}

function LoadingState(): React.ReactElement {
  return (
    <div className="mx-auto max-w-xl animate-pulse rounded-2xl border border-surface-border/80 bg-surface-card/50 p-12 shadow-sheet" aria-busy aria-label="Загрузка">
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

  return (
    <main className="relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface-window">
      <div
        className="pointer-events-none absolute inset-0 bg-[var(--page-glow)]"
        aria-hidden
      />

      <div className="relative z-[1] mx-auto w-full max-w-[58rem] px-6 py-12 sm:px-10 sm:py-14 lg:pl-14 lg:pr-12">
        {loading && <LoadingState />}

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
