import { useLayoutEffect, useRef, type ReactNode } from 'react'

const FLIP_DURATION_MS = 240
const ENTER_STAGGER_MS = 28
const ENTER_STAGGER_CAP = 8
const ITEM_KEY_SEP = '\u0001'

function readShellRects(grid: HTMLElement): Map<string, DOMRect> {
  const next = new Map<string, DOMRect>()
  grid.querySelectorAll<HTMLElement>('[data-monitoring-card-shell]').forEach((element) => {
    const id = element.dataset.monitoringCardShell
    if (!id) return
    next.set(id, element.getBoundingClientRect())
  })
  return next
}

function resetShellMotionStyles(element: HTMLElement): void {
  element.classList.remove('monitoring-card-enter')
  element.style.animationDelay = ''
  element.style.transition = ''
  element.style.transform = ''
}

export function MonitoringCardsMotionLayout({
  itemKey,
  layoutKey,
  className,
  children
}: {
  itemKey: string
  layoutKey: string
  className: string
  children: ReactNode
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const prevIdsRef = useRef<string[]>([])
  const lastMotionKeyRef = useRef<string | null>(null)
  const flipFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    const motionKey = `${layoutKey}${ITEM_KEY_SEP}${itemKey}`
    if (lastMotionKeyRef.current === motionKey) return
    lastMotionKeyRef.current = motionKey

    if (flipFrameRef.current !== null) {
      window.cancelAnimationFrame(flipFrameRef.current)
      flipFrameRef.current = null
    }

    grid.querySelectorAll<HTMLElement>('[data-monitoring-card-shell]').forEach(resetShellMotionStyles)

    const currentRects = readShellRects(grid)
    const prevRects = prevRectsRef.current
    const prevIds = new Set(prevIdsRef.current)
    const animateEnter = prevIdsRef.current.length > 0
    const enterIndexById = new Map<string, number>()
    let enterIndex = 0
    const orderedIds = itemKey ? itemKey.split(ITEM_KEY_SEP) : []
    for (const id of orderedIds) {
      if (!prevIds.has(id)) enterIndexById.set(id, enterIndex++)
    }

    const flipElements: HTMLElement[] = []

    grid.querySelectorAll<HTMLElement>('[data-monitoring-card-shell]').forEach((element) => {
      const id = element.dataset.monitoringCardShell
      if (!id) return

      const nextRect = currentRects.get(id)
      if (!nextRect) return

      const prevRect = prevRects.get(id)
      const isEnter = enterIndexById.has(id)

      if (animateEnter && isEnter) {
        const stagger = Math.min(enterIndexById.get(id) ?? 0, ENTER_STAGGER_CAP)
        element.style.animationDelay = `${stagger * ENTER_STAGGER_MS}ms`
        element.classList.add('monitoring-card-enter')
        return
      }

      if (!prevRect) return

      const dx = prevRect.left - nextRect.left
      const dy = prevRect.top - nextRect.top
      if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) return

      element.style.transform = `translate(${dx}px, ${dy}px)`
      element.style.transition = 'transform 0s'
      flipElements.push(element)
    })

    if (flipElements.length > 0) {
      flipFrameRef.current = window.requestAnimationFrame(() => {
        flipFrameRef.current = null
        for (const element of flipElements) {
          element.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
          element.style.transform = ''
        }
      })
    }

    prevRectsRef.current = currentRects
    prevIdsRef.current = orderedIds

    return () => {
      if (flipFrameRef.current !== null) {
        window.cancelAnimationFrame(flipFrameRef.current)
        flipFrameRef.current = null
      }
    }
  }, [itemKey, layoutKey])

  return (
    <div ref={gridRef} className={className}>
      {children}
    </div>
  )
}

export function MonitoringCardMotionShell({
  objectId,
  children
}: {
  objectId: string
  children: ReactNode
}) {
  return (
    <div
      data-monitoring-card-shell={objectId}
      className="monitoring-card-motion-shell min-w-0"
    >
      {children}
    </div>
  )
}
