import { createReactStyleSpec } from '@blocknote/react'

export const CodeHintStyle = createReactStyleSpec(
  {
    type: 'codeHint',
    propSchema: 'string',
  },
  {
    render: (props) => (
      <span ref={props.contentRef} className="bn-code-hint-mark" data-code-hint="true" />
    ),
  }
)
