import React, { useEffect, useRef, useState } from 'react'
import { sanitizeCodeHintHtml } from '@knowhub-shared/code-hint-sanitize'

interface Props {
  initialValue: string
  onSave: (value: string) => void
  onClose: () => void
}

export function CodeHintDialog({ initialValue, onSave, onClose }: Props): React.ReactElement {
  const [value, setValue] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const insertAtCursor = (snippet: string): void => {
    const el = textareaRef.current
    if (!el) {
      setValue((prev) => `${prev}${snippet}`)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`
    setValue(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = start + snippet.length
      el.setSelectionRange(caret, caret)
    })
  }

  const handleImageUpload = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      if (!src) return
      insertAtCursor(`<img src="${src}" alt="">`)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-surface-border bg-surface-card p-5 shadow-sheet"
        role="dialog"
        aria-labelledby="code-hint-dialog-title"
      >
        <header className="flex flex-col gap-1">
          <h2 id="code-hint-dialog-title" className="m-0 text-[15px] font-semibold text-label-primary">
            Подсказка для кода
          </h2>
          <p className="m-0 text-[12px] leading-relaxed text-label-tertiary">
            Текст переносится автоматически. Можно использовать теги{' '}
            <code className="font-mono text-[11px]">p</code>, <code className="font-mono text-[11px]">img</code>,{' '}
            <code className="font-mono text-[11px]">strong</code>.
          </p>
        </header>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'<p>Краткое пояснение</p>\n<img src="..." alt="">'}
          className="min-h-[10rem] resize-y rounded-xl border border-surface-border bg-surface-input px-3 py-2.5 font-mono text-[12px] leading-relaxed text-label-primary placeholder:text-label-tertiary/50 focus:outline-none focus:ring-2 focus:ring-tint-blue/50"
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImageUpload(file)
            e.target.value = ''
          }}
        />

        <footer className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-xl border border-surface-border bg-surface-raised/20 px-3 py-2 text-[12px] font-medium text-label-secondary transition-colors hover:text-label-primary"
          >
            Вставить изображение
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-surface-border px-4 py-2 text-[13px] font-medium text-label-secondary transition-colors hover:text-label-primary"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => onSave(sanitizeCodeHintHtml(value))}
              className="rounded-xl bg-tint-blue px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-tint-blue-hover"
            >
              Сохранить
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
