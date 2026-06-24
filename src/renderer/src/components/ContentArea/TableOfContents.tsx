import React, { createContext, useContext, useEffect, useState } from 'react'

interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

interface TocContextValue {
  entries: TocEntry[]
  activeId: string | null
  scrollTo: (id: string) => void
}

const TocContext = createContext<TocContextValue | null>(null)

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

const TOC_SCROLL_OFFSET = 132

function getScrollRoot(container: HTMLElement | null): HTMLElement | null {
  return container?.closest<HTMLElement>('main') ?? null
}

function scrollHeadingIntoView(heading: HTMLElement, scrollRoot: HTMLElement | null): void {
  if (!scrollRoot) {
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }

  const headingTop = heading.getBoundingClientRect().top
  scrollRoot.scrollTo({
    top: scrollRoot.scrollTop + headingTop - TOC_SCROLL_OFFSET,
    behavior: 'smooth'
  })
}

function uniqueHeadingId(baseId: string, index: number, usedIds: Set<string>): string {
  let candidate = baseId || `section-${index + 1}`
  if (!usedIds.has(candidate)) {
    usedIds.add(candidate)
    return candidate
  }

  let suffix = 2
  while (usedIds.has(`${baseId}-${suffix}`)) suffix++
  const unique = `${baseId}-${suffix}`
  usedIds.add(unique)
  return unique
}

export function articleHasToc(bodyHtml: string): boolean {
  return (bodyHtml.match(/<h[23]\b/gi)?.length ?? 0) >= 2
}

/** Split article body so inline TOC can sit immediately before the first h2/h3. */
export function splitBodyAtFirstHeading(bodyHtml: string): { before: string; rest: string } | null {
  const match = bodyHtml.match(/<h[23]\b/i)
  if (!match || match.index === undefined) return null

  let splitIndex = match.index

  const sectionOpenTag = '<section class="article-section-card">'
  const sectionOpen = bodyHtml.lastIndexOf(sectionOpenTag, splitIndex)
  if (sectionOpen !== -1) {
    const between = bodyHtml.slice(sectionOpen + sectionOpenTag.length, splitIndex)
    if (between.trim() === '') {
      splitIndex = sectionOpen
    }
  }

  const before = bodyHtml.slice(0, splitIndex).trim()
  const rest = bodyHtml.slice(splitIndex).trim()
  if (!rest) return null

  return before ? { before, rest } : { before: '', rest }
}

export function ArticleToc({
  containerRef,
  contentKey,
  children
}: {
  containerRef: React.RefObject<HTMLElement | null>
  contentKey: string
  children: React.ReactNode
}): React.ReactElement {
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const headings = Array.from(container.querySelectorAll<HTMLElement>('h2, h3'))
    const collected: TocEntry[] = []

    const usedIds = new Set<string>()

    headings.forEach((h, index) => {
      const plainText = h.textContent ?? ''
      const existingId = h.id.trim()
      const slug = slugify(plainText)
      const baseId = existingId && existingId === slug ? existingId : slug
      const id = uniqueHeadingId(baseId, index, usedIds)
      h.id = id
      const level = h.tagName === 'H2' ? 2 : 3
      collected.push({ id, text: plainText, level })
    })

    setEntries(collected)
  }, [containerRef, contentKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !entries.length) return

    const headingEls = entries
      .map((e) => container.querySelector<HTMLElement>(`#${CSS.escape(e.id)}`))
      .filter(Boolean) as HTMLElement[]
    if (!headingEls.length) return

    const scrollRoot =
      getScrollRoot(container) ??
      getScrollRoot(headingEls[0]) ??
      document.querySelector<HTMLElement>('main')
    if (!scrollRoot) return

    let rafId = 0

    const measureActive = (): void => {
      const rootTop = scrollRoot.getBoundingClientRect().top
      const activationLine = rootTop + TOC_SCROLL_OFFSET

      let next = headingEls[0].id
      for (const heading of headingEls) {
        if (heading.getBoundingClientRect().top <= activationLine) {
          next = heading.id
        } else {
          break
        }
      }
      setActiveId((prev) => (prev === next ? prev : next))
    }

    const updateActive = (): void => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(measureActive)
    }

    updateActive()
    scrollRoot.addEventListener('scroll', updateActive, { passive: true })
    window.addEventListener('resize', updateActive)

    const observer = new IntersectionObserver(() => updateActive(), {
      root: scrollRoot,
      threshold: [0, 1],
      rootMargin: `-${TOC_SCROLL_OFFSET}px 0px -60% 0px`
    })
    headingEls.forEach((el) => observer.observe(el))

    return () => {
      cancelAnimationFrame(rafId)
      scrollRoot.removeEventListener('scroll', updateActive)
      window.removeEventListener('resize', updateActive)
      observer.disconnect()
    }
  }, [containerRef, entries])

  const scrollTo = (id: string): void => {
    const container = containerRef.current
    const scrollRoot = getScrollRoot(container)
    const heading =
      container?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ??
      document.getElementById(id)

    if (!heading) return

    scrollHeadingIntoView(heading, scrollRoot)
    setActiveId(id)
  }

  return (
    <TocContext.Provider value={{ entries, activeId, scrollTo }}>
      {children}
    </TocContext.Provider>
  )
}

export function TocNav({ variant }: { variant: 'inline' | 'sidebar' }): React.ReactElement | null {
  const ctx = useContext(TocContext)
  if (!ctx || ctx.entries.length < 2) return null

  const { entries, activeId, scrollTo } = ctx

  return (
    <nav
      aria-label="Содержание"
      className={variant === 'inline' ? 'article-toc article-toc--inline' : 'article-toc'}
    >
      {variant === 'inline' && (
        <p className="article-toc__heading">Содержание</p>
      )}
      <ul className="article-toc__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={(e) => {
                e.preventDefault()
                scrollTo(entry.id)
              }}
              className={[
                'article-toc__link',
                entry.level === 3 ? 'article-toc__link--nested' : '',
                variant === 'sidebar' && activeId === entry.id ? 'is-active' : ''
              ].filter(Boolean).join(' ')}
            >
              <span className="article-toc__text">{entry.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
