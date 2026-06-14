import { Extension } from '@tiptap/core'

type HardBreakCommands = {
  setHardBreak: () => boolean
}

/** Enter inserts a line break inside code blocks instead of splitting the block. */
export const CodeBlockKeyboardExtension = Extension.create({
  name: 'adminCodeBlockKeyboard',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const parent = this.editor.state.selection.$head.parent
        if (parent.type.name !== 'codeBlock') return false
        return (this.editor.commands as unknown as HardBreakCommands).setHardBreak()
      }
    }
  }
})
