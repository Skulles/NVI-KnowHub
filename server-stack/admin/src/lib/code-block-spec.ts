import { createBlockSpec } from '@blocknote/core'
import { createCodeCopyButton } from './code-copy-button'

export const CodeBlock = createBlockSpec(
  {
    type: 'codeBlock',
    propSchema: {
      language: { default: '' as const }
    },
    content: 'inline'
  },
  {
    render: () => {
      const outer = document.createElement('div')
      outer.className = 'editor-code-block'

      const content = document.createElement('div')
      content.className = 'editor-code-block__content'

      const { button, destroy } = createCodeCopyButton(() => content.textContent ?? '')
      outer.appendChild(content)
      outer.appendChild(button)

      return { dom: outer, contentDOM: content, destroy }
    },
    toExternalHTML: (block) => {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      const lang = (block.props.language as string) ?? ''
      if (lang) code.className = `language-${lang}`
      pre.appendChild(code)
      return { dom: pre, contentDOM: code }
    },
    parse: (el) => {
      const codeEl = el.tagName === 'CODE' ? el : el.querySelector('code')
      const lang = codeEl?.className.match(/language-(\S+)/)?.[1]
      return lang ? { language: lang } : undefined
    }
  }
)
