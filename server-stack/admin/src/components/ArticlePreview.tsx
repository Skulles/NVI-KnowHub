import React, { useMemo, useRef, useEffect } from 'react'
import { blocksToArticleHtml, BNBlock } from '../lib/html-renderer'

function parseArticleHtml(html: string): { leadInner: string | undefined; bodyHtml: string } {
  let rest = html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i, '').trim()
  const leadRe = /^<p[^>]*\bclass="[^"]*\blead\b[^"]*"[^>]*>([\s\S]*?)<\/p>\s*/i
  const match = rest.match(leadRe)
  if (match) return { leadInner: match[1], bodyHtml: rest.slice(match[0].length).trim() }
  return { leadInner: undefined, bodyHtml: rest }
}

function useCopyButtons(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = ref.current
    if (!container) return
    const preEls = Array.from(container.querySelectorAll<HTMLElement>('pre'))
    const cleanups: (() => void)[] = []
    preEls.forEach((pre) => {
      if (pre.querySelector('.ap-copy-btn')) return
      const btn = document.createElement('button')
      btn.className = 'ap-copy-btn'
      btn.textContent = 'Копировать'
      const handleClick = (): void => {
        const text = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Скопировано'
          setTimeout(() => { btn.textContent = 'Копировать' }, 2000)
        })
      }
      btn.addEventListener('click', handleClick)
      pre.appendChild(btn)
      cleanups.push(() => btn.removeEventListener('click', handleClick))
    })
    return () => cleanups.forEach((fn) => fn())
  })
}

interface Props {
  title: string
  lead: string
  blocks: BNBlock[]
}

export function ArticlePreview({ title, lead, blocks }: Props): React.ReactElement {
  const html = useMemo(() => blocksToArticleHtml(title, lead, blocks), [title, lead, blocks])
  const { leadInner, bodyHtml } = useMemo(() => parseArticleHtml(html), [html])
  const articleRef = useRef<HTMLElement>(null)
  useCopyButtons(articleRef)

  return (
    <div className="app-preview flex-1 overflow-y-auto pb-20">
      <div className="mx-auto w-full max-w-[58rem] px-6 py-12 sm:px-10 sm:py-14">
        <header className="mb-9 px-0.5">
          <h1 className="app-preview__title !mt-0">{title || 'Без заголовка'}</h1>
          {leadInner && (
            <p className="app-preview__lead" dangerouslySetInnerHTML={{ __html: leadInner }} />
          )}
        </header>
        <article
          ref={articleRef}
          className="article-body article-content max-w-none"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
    </div>
  )
}
