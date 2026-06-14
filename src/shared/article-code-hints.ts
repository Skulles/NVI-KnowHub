import { CODE_HINT_ATTR, CODE_HINT_CLASS, decodeCodeHintHtml } from './code-hint'
import { sanitizeCodeHintHtml } from './code-hint-sanitize'

const SHOW_DELAY_MS = 220
const HIDE_DELAY_MS = 120

let tooltipEl: HTMLDivElement | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let activeAnchor: HTMLElement | null = null

function ensureTooltip(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div')
    tooltipEl.className = 'article-code-hint-tooltip'
    tooltipEl.setAttribute('role', 'tooltip')
    tooltipEl.addEventListener('mouseenter', cancelHide)
    tooltipEl.addEventListener('mouseleave', scheduleHide)
    document.body.appendChild(tooltipEl)
  }
  return tooltipEl
}

function cancelShow(): void {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

function cancelHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function hideTooltip(): void {
  cancelShow()
  cancelHide()
  activeAnchor = null
  tooltipEl?.classList.remove('is-visible')
}

function scheduleHide(): void {
  cancelHide()
  hideTimer = setTimeout(hideTooltip, HIDE_DELAY_MS)
}

function positionTooltip(anchor: HTMLElement, tooltip: HTMLDivElement): void {
  const rect = anchor.getBoundingClientRect()
  const gap = 10
  tooltip.style.visibility = 'hidden'
  tooltip.style.display = 'block'
  const tooltipRect = tooltip.getBoundingClientRect()

  let top = rect.top - tooltipRect.height - gap
  if (top < 8) top = rect.bottom + gap

  let left = rect.left + rect.width / 2 - tooltipRect.width / 2
  left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8))

  tooltip.style.top = `${top}px`
  tooltip.style.left = `${left}px`
  tooltip.style.visibility = 'visible'
}

function showTooltip(anchor: HTMLElement): void {
  const encoded = anchor.getAttribute(CODE_HINT_ATTR)
  if (!encoded) return

  const html = sanitizeCodeHintHtml(decodeCodeHintHtml(encoded))
  if (!html) return

  cancelHide()
  activeAnchor = anchor
  const tooltip = ensureTooltip()
  tooltip.innerHTML = html
  positionTooltip(anchor, tooltip)
  tooltip.classList.add('is-visible')
}

function scheduleShow(anchor: HTMLElement): void {
  cancelShow()
  showTimer = setTimeout(() => showTooltip(anchor), SHOW_DELAY_MS)
}

export function attachArticleCodeHints(container: HTMLElement): () => void {
  const codes = container.querySelectorAll<HTMLElement>(`code.${CODE_HINT_CLASS}[${CODE_HINT_ATTR}]`)
  const cleanups: Array<() => void> = []

  const onScrollOrResize = (): void => {
    if (activeAnchor && tooltipEl?.classList.contains('is-visible')) {
      positionTooltip(activeAnchor, tooltipEl)
    }
  }

  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)

  codes.forEach((code) => {
    code.classList.add('code-has-hint')
    code.setAttribute('tabindex', '0')

    const onEnter = (): void => scheduleShow(code)
    const onLeave = (): void => {
      cancelShow()
      scheduleHide()
    }

    code.addEventListener('mouseenter', onEnter)
    code.addEventListener('mouseleave', onLeave)
    code.addEventListener('focus', onEnter)
    code.addEventListener('blur', onLeave)

    cleanups.push(() => {
      code.removeEventListener('mouseenter', onEnter)
      code.removeEventListener('mouseleave', onLeave)
      code.removeEventListener('focus', onEnter)
      code.removeEventListener('blur', onLeave)
      code.classList.remove('code-has-hint')
      code.removeAttribute('tabindex')
    })
  })

  return () => {
    cleanups.forEach((fn) => fn())
    window.removeEventListener('scroll', onScrollOrResize, true)
    window.removeEventListener('resize', onScrollOrResize)
    hideTooltip()
    tooltipEl?.remove()
    tooltipEl = null
  }
}
