import { CODE_COPIED_ICON_SVG, CODE_COPY_ICON_SVG } from '@shared/code-copy-icons'

function createCopyButton(getText: () => string): {
  button: HTMLButtonElement
  destroy: () => void
} {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'article-code-copy-btn'
  btn.setAttribute('aria-label', 'Копировать код')
  btn.innerHTML = CODE_COPY_ICON_SVG

  let resetTimer: ReturnType<typeof setTimeout> | null = null

  const showCopied = (): void => {
    btn.innerHTML = CODE_COPIED_ICON_SVG
    btn.classList.add('copied')
    btn.setAttribute('aria-label', 'Скопировано')
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      btn.innerHTML = CODE_COPY_ICON_SVG
      btn.classList.remove('copied')
      btn.setAttribute('aria-label', 'Копировать код')
      resetTimer = null
    }, 2000)
  }

  const onClick = (): void => {
    void navigator.clipboard.writeText(getText()).then(showCopied)
  }

  btn.addEventListener('click', onClick)

  return {
    button: btn,
    destroy: () => {
      if (resetTimer) clearTimeout(resetTimer)
      btn.removeEventListener('click', onClick)
      btn.remove()
    }
  }
}

export function attachArticleCodeCopyButtons(container: HTMLElement): () => void {
  const cleanups: (() => void)[] = []

  container.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    if (pre.querySelector('.article-code-copy-btn')) return

    const { button, destroy } = createCopyButton(
      () => pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
    )
    pre.appendChild(button)
    cleanups.push(destroy)
  })

  return () => cleanups.forEach((fn) => fn())
}
