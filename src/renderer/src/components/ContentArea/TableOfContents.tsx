import React, { useEffect, useState } from 'react'

interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export function TableOfContents({
  containerRef
}: {
  containerRef: React.RefObject<HTMLElement>
}): React.ReactElement | null {
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const headings = Array.from(container.querySelectorAll<HTMLElement>('h2, h3'))
    const collected: TocEntry[] = []

    headings.forEach((h) => {
      if (!h.id) {
        h.id = slugify(h.textContent ?? '')
      }
      const level = h.tagName === 'H2' ? 2 : 3
      collected.push({ id: h.id, text: h.textContent ?? '', level })
    })

    setEntries(collected)
  }, [containerRef])

  useEffect(() => {
    const headingEls = entries.map((e) => document.getElementById(e.id)).filter(Boolean) as HTMLElement[]
    if (!headingEls.length) return

    const observer = new IntersectionObserver(
      (obs) => {
        const visible = obs.filter((e) => e.isIntersecting)
        if (visible.length) setActiveId(visible[0].target.id)
      },
      { rootMargin: '0px 0px -65% 0px', threshold: 0 }
    )

    headingEls.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [entries])

  if (entries.length < 2) return null

  return (
    <nav
      aria-label="Содержание"
      className="sticky top-8 ml-8 hidden w-[13rem] shrink-0 xl:block"
      style={{ maxHeight: 'calc(100vh - 4rem)', overflowY: 'auto' }}
    >
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-label-tertiary">
        Содержание
      </p>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                setActiveId(entry.id)
              }}
              className={`
                block rounded-md py-1 text-[12px] leading-snug transition-colors duration-100
                ${entry.level === 3 ? 'pl-3 text-[11.5px]' : 'pl-0'}
                ${activeId === entry.id
                  ? 'text-tint-blue'
                  : 'text-label-tertiary hover:text-label-secondary'
                }
              `}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
