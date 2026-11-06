import React, { useCallback, useState } from 'react'
import {
  useBlockNoteEditor,
  useComponentsContext,
  useEditorContentOrSelectionChange,
} from '@blocknote/react'
import { CodeHintDialog } from './CodeHintDialog'

const HintIcon = (): React.ReactElement => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm9.75-5.25a3.75 3.75 0 0 0-3.646 2.805.75.75 0 1 1-1.455-.36 5.25 5.25 0 1 1 8.614 3.96.75.75 0 0 1-1.155.12L12 12.25V13a.75.75 0 0 1-1.5 0v-.75a.75.75 0 0 1 .53-.72 3.75 3.75 0 0 0 1.47-6.23ZM12 17.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
  </svg>
)

type CodeHintStyles = {
  code?: boolean
  codeHint?: string
}

export function CodeHintButton(): React.ReactElement | null {
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draftHint, setDraftHint] = useState('')
  const [hasCodeStyle, setHasCodeStyle] = useState(false)
  const [hasHint, setHasHint] = useState(false)

  const readStyles = useCallback((): CodeHintStyles => {
    return editor.getActiveStyles() as CodeHintStyles
  }, [editor])

  const refreshState = useCallback(() => {
    const styles = readStyles()
    setHasCodeStyle(!!styles.code)
    const hint = typeof styles.codeHint === 'string' ? styles.codeHint.trim() : ''
    setHasHint(hint.length > 0)
  }, [readStyles])

  useEditorContentOrSelectionChange(refreshState, editor)

  if (!Components || !('codeHint' in editor.schema.styleSchema)) return null

  const openDialog = (): void => {
    if (!readStyles().code) return
    const hint = readStyles().codeHint
    setDraftHint(typeof hint === 'string' ? hint : '')
    setDialogOpen(true)
  }

  const saveHint = (value: string): void => {
    if (!value) {
      editor.removeStyles({ codeHint: true } as never)
    } else {
      editor.addStyles({ code: true, codeHint: value } as never)
    }
    setDialogOpen(false)
    refreshState()
  }

  return (
    <>
      <Components.FormattingToolbar.Button
        className="bn-button"
        mainTooltip={hasCodeStyle ? 'Подсказка для кода' : 'Сначала отметьте текст как код'}
        isSelected={hasHint}
        isDisabled={!hasCodeStyle}
        onClick={openDialog}
        label="Подсказка"
        icon={<HintIcon />}
      />
      {dialogOpen && (
        <CodeHintDialog
          initialValue={draftHint}
          onSave={saveHint}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}
