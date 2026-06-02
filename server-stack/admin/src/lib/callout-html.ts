export const CALLOUT_LABELS = {
  warning: 'Внимание',
  important: 'Важно',
} as const

export type AlertCalloutVariant = keyof typeof CALLOUT_LABELS

const OUTLINE_ICON_PATH =
  'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z'

export function calloutIconSvgHtml(): string {
  return (
    `<svg class="article-callout__icon" xmlns="http://www.w3.org/2000/svg" fill="none" ` +
    `viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">` +
    `<path stroke-linecap="round" stroke-linejoin="round" d="${OUTLINE_ICON_PATH}"/></svg>`
  )
}

export function renderAlertCalloutHtml(variant: AlertCalloutVariant, bodyHtml: string): string {
  const modifier = variant === 'warning' ? ' article-callout--warning' : ' article-callout--important'
  const label = CALLOUT_LABELS[variant]
  return (
    `<blockquote class="article-callout${modifier}">` +
    `${calloutIconSvgHtml()}` +
    `<span class="article-callout__label">${label}</span>` +
    `<div class="article-callout__body">${bodyHtml}</div>` +
    `</blockquote>`
  )
}

export function appendAlertCalloutChrome(
  blockquote: HTMLElement,
  variant: AlertCalloutVariant
): HTMLDivElement {
  const template = document.createElement('template')
  template.innerHTML = calloutIconSvgHtml().trim()
  const icon = template.content.firstChild
  if (icon) blockquote.appendChild(icon)

  const label = document.createElement('span')
  label.className = 'article-callout__label'
  label.textContent = CALLOUT_LABELS[variant]
  blockquote.appendChild(label)

  const body = document.createElement('div')
  body.className = 'article-callout__body min-h-[1.25em]'
  blockquote.appendChild(body)
  return body
}
