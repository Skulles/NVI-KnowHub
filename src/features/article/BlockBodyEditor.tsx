import type { Editor, JSONContent } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { createPortal } from 'react-dom'
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { applyArticleLinkToEditor } from '../../shared/lib/tiptap/articleLinkPrompt'
import { articleLinkExtension } from '../../shared/lib/tiptap/articleLinkExtension'
import { articleBodyNodeExtensions } from '../../shared/lib/tiptap/articleBodyNodeExtensions'
import { CalloutMarkIcon } from './CalloutMarkIcon'
import { BlockTableBubbleToolbar } from './BlockTableBubbleToolbar'

const blockTableBubblePluginKey = new PluginKey('blockTableBubbleMenu')

const EMPTY_BODY_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function parseBodyDoc(json: string): JSONContent {
  try {
    const p = JSON.parse(json) as JSONContent
    if (p?.type === 'doc' && Array.isArray(p.content)) {
      return p
    }
  } catch {
    /* ignore */
  }
  return EMPTY_BODY_DOC
}

function getCodeBlockContextTarget(
  editor: Editor,
  clientX: number,
  clientY: number,
): { type: 'codeBlock'; pos: number } | null {
  const coords = editor.view.posAtCoords({ left: clientX, top: clientY })
  if (!coords) {
    return null
  }
  const $pos = editor.state.doc.resolve(coords.pos)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'codeBlock') {
      return { type: 'codeBlock', pos: $pos.before(d) }
    }
  }
  return null
}

function getMediaContextTarget(
  editor: Editor,
  clientX: number,
  clientY: number,
): { type: 'image' | 'video'; pos: number } | null {
  const root = editor.view.dom
  const el = document.elementFromPoint(clientX, clientY)
  if (!el || !root.contains(el)) {
    return null
  }
  const media = el.closest('img, video')
  if (!media || !root.contains(media)) {
    return null
  }
  const isArticleImg =
    media.tagName === 'IMG' && media.classList.contains('article-body-img')
  const isArticleVideo =
    media.tagName === 'VIDEO' && media.classList.contains('article-body-video')
  if (!isArticleImg && !isArticleVideo) {
    return null
  }
  try {
    const pos = editor.view.posAtDOM(media, 0)
    const node = editor.state.doc.nodeAt(pos)
    if (
      node &&
      ((isArticleImg && node.type.name === 'image') ||
        (isArticleVideo && node.type.name === 'video'))
    ) {
      return { type: node.type.name as 'image' | 'video', pos }
    }
  } catch {
    /* ignore */
  }
  return null
}

function CtxIcon({ children }: { children: ReactNode }) {
  return (
    <span className="block-body-context-menu__ico" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  )
}

function BlockBubbleToolbar({
  editor,
  onOpenLinkDialog,
}: {
  editor: Editor
  onOpenLinkDialog: () => void
}) {
  const marks = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      underline: ed.isActive('underline'),
      strike: ed.isActive('strike'),
      code: ed.isActive('code'),
      link: ed.isActive('link'),
    }),
  })

  return (
    <div className="block-bubble-menu" role="toolbar" aria-label="Форматирование">
      <button
        className={
          marks.bold ? 'block-bubble-menu__btn is-active' : 'block-bubble-menu__btn'
        }
        type="button"
        title="Жирный (Ctrl+B)"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="block-bubble-menu__glyph block-bubble-menu__glyph--bold" aria-hidden>
          B
        </span>
      </button>
      <button
        className={
          marks.italic ? 'block-bubble-menu__btn is-active' : 'block-bubble-menu__btn'
        }
        type="button"
        title="Курсив (Ctrl+I)"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="block-bubble-menu__glyph block-bubble-menu__glyph--italic" aria-hidden>
          I
        </span>
      </button>
      <button
        className={
          marks.underline
            ? 'block-bubble-menu__btn is-active'
            : 'block-bubble-menu__btn'
        }
        type="button"
        title="Подчёркнутый (Ctrl+U)"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="block-bubble-menu__glyph block-bubble-menu__glyph--underline" aria-hidden>
          U
        </span>
      </button>
      <button
        className={
          marks.strike ? 'block-bubble-menu__btn is-active' : 'block-bubble-menu__btn'
        }
        type="button"
        title="Зачёркнутый"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <span className="block-bubble-menu__glyph block-bubble-menu__glyph--strike" aria-hidden>
          ab
        </span>
      </button>
      <button
        className={
          marks.code ? 'block-bubble-menu__btn is-active' : 'block-bubble-menu__btn'
        }
        type="button"
        title="Полужирный моноширинный (код)"
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <span className="block-bubble-menu__glyph block-bubble-menu__glyph--code" aria-hidden>
          {'\u003c/\u003e'}
        </span>
      </button>

      <div className="block-bubble-menu__sep" role="separator" aria-hidden />

      <button
        className={
          marks.link ? 'block-bubble-menu__btn is-active' : 'block-bubble-menu__btn'
        }
        type="button"
        title="Ссылка (выделите текст или поставьте курсор в ссылку)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpenLinkDialog}
      >
        <span className="block-bubble-menu__glyph block-bubble-menu__glyph--link" aria-hidden>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7.07 0l1.42-1.42a5 5 0 0 0-7.07-7.07l-.71.71" />
            <path d="M14 11a5 5 0 0 0-7.07 0L5.5 12.42a5 5 0 0 0 7.07 7.07l.71-.71" />
          </svg>
        </span>
      </button>
    </div>
  )
}

type BlockBodyContextMenuProps = {
  editor: Editor
  position: { x: number; y: number }
  captionTarget: { type: 'image' | 'video' | 'codeBlock'; pos: number } | null
  onClose: () => void
  onRequestCaption: (target: {
    type: 'image' | 'video' | 'codeBlock'
    pos: number
  }) => void
}

const BlockBodyContextMenu = forwardRef<HTMLDivElement, BlockBodyContextMenuProps>(
  function BlockBodyContextMenu(
    { editor, position, captionTarget, onClose, onRequestCaption },
    ref,
  ) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const run = useCallback(
    (fn: () => void) => {
      fn()
      onClose()
    },
    [onClose],
  )

  const onImageFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const src = reader.result as string
        editor.chain().focus().setImage({ src }).run()
      }
      reader.readAsDataURL(file)
      onClose()
    },
    [editor, onClose],
  )

  const onVideoFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const src = reader.result as string
        editor.chain().focus().insertContent({ type: 'video', attrs: { src } }).run()
      }
      reader.readAsDataURL(file)
      onClose()
    },
    [editor, onClose],
  )

  if (captionTarget) {
    const captionTitle =
      captionTarget.type === 'codeBlock'
        ? 'Подпись под блоком кода'
        : 'Подпись под изображением или видео'
    return (
      <div
        ref={ref}
        className="block-body-context-menu"
        role="toolbar"
        aria-label={captionTarget.type === 'codeBlock' ? 'Код' : 'Медиа'}
        style={{ left: position.x, top: position.y }}
      >
        <button
          className="block-body-context-menu__btn block-body-context-menu__btn--text"
          type="button"
          title={captionTitle}
          onMouseDown={(ev) => {
            ev.preventDefault()
            ev.stopPropagation()
          }}
          onClick={() => {
            onRequestCaption(captionTarget)
            onClose()
          }}
        >
          Подпись
        </button>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="block-body-context-menu"
      role="toolbar"
      aria-label="Вставка в блок"
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Картинка с устройства"
        onClick={() => {
          imageInputRef.current?.click()
        }}
      >
        <CtxIcon>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
          <path d="M21 17l-4.5-4.5-3 3L10 11l-4 4" />
        </CtxIcon>
      </button>
      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Видео с устройства"
        onClick={() => {
          videoInputRef.current?.click()
        }}
      >
        <CtxIcon>
          <rect x="2" y="5" width="15" height="14" rx="2" />
          <path d="M17 10l5-3v10l-5-3V10z" />
        </CtxIcon>
      </button>
      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Таблица 3×3"
        onClick={() =>
          run(() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          )
        }
      >
        <CtxIcon>
          <path d="M3 5h18v14H3V5z" />
          <path d="M3 10h18M10 5v14M17 5v14" />
        </CtxIcon>
      </button>

      <div className="block-body-context-menu__sep" role="separator" aria-hidden />

      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Маркированный список"
        onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}
      >
        <CtxIcon>
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="5" cy="6" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="5" cy="18" r="1.35" fill="currentColor" stroke="none" />
        </CtxIcon>
      </button>
      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Нумерованный список"
        onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}
      >
        <CtxIcon>
          <path d="M10 6h11M10 12h11M10 18h11" />
          <rect x="3" y="5" width="3" height="2" rx="0.5" />
          <rect x="3" y="11" width="3" height="2" rx="0.5" />
          <rect x="3" y="17" width="3" height="2" rx="0.5" />
        </CtxIcon>
      </button>

      <div className="block-body-context-menu__sep" role="separator" aria-hidden />

      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Цитата"
        onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}
      >
        <CtxIcon>
          <line x1="7" y1="5" x2="7" y2="19" />
          <line x1="10" y1="7" x2="19" y2="7" />
          <line x1="10" y1="12" x2="17" y2="12" />
          <line x1="10" y1="17" x2="19" y2="17" />
        </CtxIcon>
      </button>
      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Блок кода"
        onClick={() => run(() => editor.chain().focus().toggleCodeBlock().run())}
      >
        <CtxIcon>
          <path d="M9 7l-4 5 4 5M15 7l4 5-4 5" />
        </CtxIcon>
      </button>

      <div className="block-body-context-menu__sep" role="separator" aria-hidden />

      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Сноска (внимание)"
        onClick={() =>
          run(() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'callout',
                attrs: { variant: 'yellow' },
                content: [{ type: 'paragraph' }],
              })
              .run(),
          )
        }
      >
        <CalloutMarkIcon className="block-body-context-menu__callout-ico" variant="yellow" />
      </button>
      <button
        className="block-body-context-menu__btn"
        type="button"
        title="Сноска (важно)"
        onClick={() =>
          run(() =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'callout',
                attrs: { variant: 'red' },
                content: [{ type: 'paragraph' }],
              })
              .run(),
          )
        }
      >
        <CalloutMarkIcon className="block-body-context-menu__callout-ico" variant="red" />
      </button>

      <input
        ref={imageInputRef}
        accept="image/*"
        aria-hidden
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        onChange={onImageFile}
      />
      <input
        ref={videoInputRef}
        accept="video/*"
        aria-hidden
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        onChange={onVideoFile}
      />
    </div>
  )
  },
)

type BlockBodyEditorProps = {
  blockId: string
  valueJson: string
  onChange: (json: string) => void
}

type MediaCaptionDialogState = {
  pos: number
  type: 'image' | 'video' | 'codeBlock'
  value: string
}

export function BlockBodyEditor({
  blockId,
  valueJson,
  onChange,
}: BlockBodyEditorProps) {
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    captionTarget: { type: 'image' | 'video' | 'codeBlock'; pos: number } | null
  } | null>(null)
  const [mediaCaption, setMediaCaption] = useState<MediaCaptionDialogState | null>(
    null,
  )
  const [linkDialog, setLinkDialog] = useState<{ draft: string } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const captionInputRef = useRef<HTMLTextAreaElement | null>(null)
  const linkInputRef = useRef<HTMLInputElement | null>(null)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          link: false,
          codeBlock: false,
        }),
        articleLinkExtension,
        Underline,
        Placeholder.configure({ placeholder: 'Текст блока' }),
        ...articleBodyNodeExtensions(),
      ],
      content: parseBodyDoc(valueJson),
      onUpdate: ({ editor: ed }) => {
        onChange(JSON.stringify(ed.getJSON()))
      },
      editorProps: {
        attributes: {
          class: 'block-body-editor__tiptap tiptap-editor',
        },
      },
    },
    [blockId],
  )

  useEffect(() => {
    if (!editor) {
      return
    }
    const next = parseBodyDoc(valueJson)
    const cur = editor.getJSON()
    if (JSON.stringify(cur) === valueJson) {
      return
    }
    editor.commands.setContent(next, { emitUpdate: false })
  }, [editor, valueJson])

  useEffect(() => {
    if (!ctxMenu) {
      return
    }
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
      }
    }
    const onMouseDown = (e: MouseEvent) => {
      const root = menuRef.current
      if (root && e.target instanceof Node && root.contains(e.target)) {
        return
      }
      close()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const mediaCaptionTargetKey =
    mediaCaption != null ? `${mediaCaption.pos}:${mediaCaption.type}` : null

  useEffect(() => {
    if (mediaCaptionTargetKey == null) {
      return
    }
    const id = requestAnimationFrame(() => {
      const ta = captionInputRef.current
      ta?.focus()
      ta?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [mediaCaptionTargetKey])

  useEffect(() => {
    if (!linkDialog) {
      return
    }
    const id = requestAnimationFrame(() => {
      const input = linkInputRef.current
      input?.focus()
      input?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [linkDialog != null])

  useEffect(() => {
    if (!linkDialog) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLinkDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkDialog != null])

  useEffect(() => {
    if (!mediaCaption) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMediaCaption(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mediaCaption != null])

  const onRequestCaption = useCallback(
    (target: { type: 'image' | 'video' | 'codeBlock'; pos: number }) => {
      if (!editor) {
        return
      }
      const node = editor.state.doc.nodeAt(target.pos)
      const value =
        node &&
        typeof (node.attrs as { caption?: string | null }).caption === 'string'
          ? ((node.attrs as { caption?: string | null }).caption ?? '')
          : ''
      setMediaCaption({ ...target, value })
    },
    [editor],
  )

  const onSaveMediaCaption = useCallback(() => {
    if (!editor || !mediaCaption) {
      return
    }
    const caption =
      mediaCaption.value.trim() === '' ? null : mediaCaption.value.trim()
    editor
      .chain()
      .focus()
      .setNodeSelection(mediaCaption.pos)
      .updateAttributes(mediaCaption.type, { caption })
      .run()
    setMediaCaption(null)
  }, [editor, mediaCaption])

  const openLinkDialog = useCallback(() => {
    if (!editor) {
      return
    }
    const href = editor.getAttributes('link').href as string | undefined
    const initial = href?.trim() ? href.trim() : 'https://'
    setLinkDialog({ draft: initial })
  }, [editor])

  const onSaveLinkDialog = useCallback(() => {
    if (!editor || !linkDialog) {
      return
    }
    applyArticleLinkToEditor(editor, linkDialog.draft)
    setLinkDialog(null)
  }, [editor, linkDialog])

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (!editor) {
        return
      }
      const view = editor.view
      const mediaTarget = getMediaContextTarget(editor, e.clientX, e.clientY)
      const codeTarget =
        mediaTarget == null
          ? getCodeBlockContextTarget(editor, e.clientX, e.clientY)
          : null
      const captionTarget = mediaTarget ?? codeTarget
      const coords = !captionTarget
        ? view.posAtCoords({
            left: e.clientX,
            top: e.clientY,
          })
        : null
      if (captionTarget) {
        editor.chain().focus().setNodeSelection(captionTarget.pos).run()
      } else if (coords) {
        editor.chain().focus().setTextSelection(coords.pos).run()
      } else {
        editor.chain().focus().run()
      }
      const pad = 8
      const mw = captionTarget ? 140 : 560
      const mh = captionTarget ? 44 : 52
      let x = e.clientX
      let y = e.clientY
      if (x + mw > window.innerWidth - pad) {
        x = Math.max(pad, window.innerWidth - mw - pad)
      }
      if (y + mh > window.innerHeight - pad) {
        y = Math.max(pad, window.innerHeight - mh - pad)
      }
      setCtxMenu({ x, y, captionTarget })
    },
    [editor],
  )

  if (!editor) {
    return <div className="block-body-editor block-body-editor--loading" />
  }

  return (
    <div className="block-body-editor" onContextMenu={onContextMenu}>
      <BubbleMenu editor={editor}>
        <BlockBubbleToolbar editor={editor} onOpenLinkDialog={openLinkDialog} />
      </BubbleMenu>
      <BubbleMenu
        editor={editor}
        options={{ placement: 'bottom', flip: true }}
        pluginKey={blockTableBubblePluginKey}
        shouldShow={({ editor: ed }) => ed.isEditable && ed.isActive('table')}
      >
        <BlockTableBubbleToolbar editor={editor} />
      </BubbleMenu>
      <EditorContent editor={editor} />
      {ctxMenu
        ? createPortal(
            <BlockBodyContextMenu
              ref={menuRef}
              editor={editor}
              position={{ x: ctxMenu.x, y: ctxMenu.y }}
              captionTarget={ctxMenu.captionTarget}
              onClose={() => setCtxMenu(null)}
              onRequestCaption={onRequestCaption}
            />,
            document.body,
          )
        : null}
      {mediaCaption
        ? createPortal(
            <div
              aria-labelledby="media-caption-dialog-title"
              className="article-delete-dialog-backdrop"
              role="presentation"
              onClick={() => setMediaCaption(null)}
            >
              <div
                aria-modal="true"
                className="article-delete-dialog"
                role="dialog"
                onClick={(ev) => ev.stopPropagation()}
              >
                <h2
                  className="article-delete-dialog__title"
                  id="media-caption-dialog-title"
                >
                  {mediaCaption.type === 'codeBlock'
                    ? 'Подпись к коду'
                    : 'Подпись к медиа'}
                </h2>
                <p className="article-delete-dialog__text">
                  {mediaCaption.type === 'codeBlock'
                    ? 'Текст под блоком кода. Оставьте поле пустым, чтобы убрать подпись.'
                    : 'Текст под изображением или видео. Оставьте поле пустым, чтобы убрать подпись.'}
                </p>
                <label className="settings-dialog-field">
                  <span className="visually-hidden">Текст подписи</span>
                  <textarea
                    ref={captionInputRef}
                    className="media-caption-dialog__textarea"
                    rows={3}
                    value={mediaCaption.value}
                    onChange={(ev) =>
                      setMediaCaption((prev) =>
                        prev ? { ...prev, value: ev.target.value } : prev,
                      )
                    }
                  />
                </label>
                <div className="article-delete-dialog__actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setMediaCaption(null)}
                  >
                    Отмена
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={onSaveMediaCaption}
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {linkDialog
        ? createPortal(
            <div
              aria-labelledby="article-link-dialog-title"
              className="article-delete-dialog-backdrop"
              role="presentation"
              onClick={() => setLinkDialog(null)}
            >
              <div
                aria-modal="true"
                className="article-delete-dialog"
                role="dialog"
                onClick={(ev) => ev.stopPropagation()}
              >
                <h2
                  className="article-delete-dialog__title"
                  id="article-link-dialog-title"
                >
                  Ссылка
                </h2>
                <p className="article-delete-dialog__text">
                  Адрес страницы, mailto: или #якорь. Оставьте поле пустым, чтобы убрать
                  ссылку.
                </p>
                <label className="settings-dialog-field">
                  <span className="visually-hidden">URL</span>
                  <input
                    ref={linkInputRef}
                    autoComplete="off"
                    className="settings-dialog-field__input"
                    spellCheck={false}
                    type="text"
                    value={linkDialog.draft}
                    onChange={(ev) =>
                      setLinkDialog((prev) =>
                        prev ? { draft: ev.target.value } : prev,
                      )
                    }
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') {
                        ev.preventDefault()
                        onSaveLinkDialog()
                      }
                    }}
                  />
                </label>
                <div className="article-delete-dialog__actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setLinkDialog(null)}
                  >
                    Отмена
                  </button>
                  <button className="primary-button" type="button" onClick={onSaveLinkDialog}>
                    Сохранить
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
