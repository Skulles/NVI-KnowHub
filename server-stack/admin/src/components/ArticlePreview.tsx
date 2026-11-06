import React, { useMemo, useRef, useEffect } from 'react'
import { attachArticleCodeHints } from '@knowhub-shared/article-code-hints'
import { attachCodeCopyButtons } from '../lib/code-copy-button'
import { blocksToArticleHtml, BNBlock } from '../lib/html-renderer'

function parseArticleHtml(html: string): { leadInner: string | undefined; bodyHtml: string } {
  let rest = html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i, '').trim()
  const leadRe = /^<p[^>]*\bclass="[^"]*\blead\b[^"]*"[^>]*>([\s\S]*?)<\/p>\s*/i
  const match = rest.match(leadRe)
  if (match) return { leadInner: match[1], bodyHtml: rest.slice(match[0].length).trim() }
  return { leadInner: undefined, bodyHtml: rest }
}

function useArticleEnhancements(ref: React.RefObject<HTMLElement | null>, contentKey: string): void {
  useEffect(() => {
    const container = ref.current
    if (!container) return
    const cleanupCopy = attachCodeCopyButtons(container)
    const cleanupHints = attachArticleCodeHints(container)
    return () => {
      cleanupCopy()
      cleanupHints()
    }
  }, [ref, contentKey])
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
  useArticleEnhancements(articleRef, bodyHtml)

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
