import React, { useEffect, useState } from 'react'

interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

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

export function TableOfContents({
  containerRef,
  contentKey
}: {
  containerRef: React.RefObject<HTMLElement>
  contentKey: string
}): React.ReactElement | null {
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
    const headingEls = entries.map((e) => document.getElementById(e.id)).filter(Boolean) as HTMLElement[]
    if (!headingEls.length) return

    const container = containerRef.current
    const scrollRoot = container?.closest<HTMLElement>('main') ?? document.documentElement
    let rafId = 0

    const measureActive = (): void => {
      const rootTop = scrollRoot === document.documentElement
        ? 0
        : scrollRoot.getBoundingClientRect().top
      const activationLine = rootTop + 132

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

    return () => {
      cancelAnimationFrame(rafId)
      scrollRoot.removeEventListener('scroll', updateActive)
      window.removeEventListener('resize', updateActive)
    }
  }, [containerRef, entries])

  if (entries.length < 2) return null

  return (
    <nav aria-label="Содержание" className="article-toc">
      <ul className="article-toc__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                setActiveId(entry.id)
              }}
              className={[
                'article-toc__link',
                entry.level === 3 ? 'article-toc__link--nested' : '',
                activeId === entry.id ? 'is-active' : ''
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
