import { CODE_COPIED_ICON_SVG, CODE_COPY_ICON_SVG } from '@knowhub-shared/code-copy-icons'

export const CODE_COPY_CLIPBOARD_SVG = CODE_COPY_ICON_SVG
export const CODE_COPY_CHECK_SVG = CODE_COPIED_ICON_SVG

export function createCodeCopyButton(getText: () => string): {
  button: HTMLButtonElement
  destroy: () => void
} {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'article-code-copy-btn'
  btn.setAttribute('aria-label', 'Копировать код')
  btn.innerHTML = CODE_COPY_CLIPBOARD_SVG

  let resetTimer: ReturnType<typeof setTimeout> | null = null

  const showCopied = (): void => {
    btn.innerHTML = CODE_COPY_CHECK_SVG
    btn.classList.add('copied')
    btn.setAttribute('aria-label', 'Скопировано')
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      btn.innerHTML = CODE_COPY_CLIPBOARD_SVG
      btn.classList.remove('copied')
      btn.setAttribute('aria-label', 'Копировать код')
      resetTimer = null
    }, 2000)
  }

  const onMouseDown = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onClick = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    void navigator.clipboard.writeText(getText()).then(showCopied)
  }

  btn.addEventListener('mousedown', onMouseDown)
  btn.addEventListener('click', onClick)

  return {
    button: btn,
    destroy: () => {
      if (resetTimer) clearTimeout(resetTimer)
      btn.removeEventListener('mousedown', onMouseDown)
      btn.removeEventListener('click', onClick)
    }
  }
}

export function attachCodeCopyButtons(container: HTMLElement): () => void {
  const cleanups: (() => void)[] = []

  container.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    if (pre.querySelector('.article-code-copy-btn')) return

    const { button, destroy } = createCodeCopyButton(
      () => pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
    )
    pre.appendChild(button)
    cleanups.push(destroy)
  })

  return () => cleanups.forEach((fn) => fn())
}
