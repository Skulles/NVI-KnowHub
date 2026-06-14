import React from 'react'
import {
  BasicTextStyleButton,
  FormattingToolbar,
  getFormattingToolbarItems,
  type FormattingToolbarProps
} from '@blocknote/react'
import { CodeHintButton } from './CodeHintButton'

export function AdminFormattingToolbar(props: FormattingToolbarProps): React.ReactElement {
  const items = getFormattingToolbarItems(props.blockTypeSelectItems)
  const withCode: React.ReactElement[] = []

  for (const item of items) {
    withCode.push(item)
    if (item.key === 'strikeStyleButton') {
      withCode.push(<BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />)
      withCode.push(<CodeHintButton key="codeHintButton" />)
    }
  }

  return <FormattingToolbar {...props}>{withCode}</FormattingToolbar>
}
