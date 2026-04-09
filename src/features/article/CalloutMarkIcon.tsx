import type { CalloutVariant } from '../../shared/lib/tiptap/calloutExtension'
import calloutMarkRedUrl from '../../assets/callout-mark-red.svg?url'
import calloutMarkYellowUrl from '../../assets/callout-mark-yellow.svg?url'

const MARK_SRC: Record<CalloutVariant, string> = {
  yellow: calloutMarkYellowUrl,
  red: calloutMarkRedUrl,
}

type CalloutMarkIconProps = {
  variant: CalloutVariant
  className?: string
}

/** Те же SVG, что и у маркера вставленной сноски (`index.css` → `::before`). */
export function CalloutMarkIcon({ variant, className }: CalloutMarkIconProps) {
  return (
    <img
      alt=""
      className={className}
      draggable={false}
      src={MARK_SRC[variant]}
    />
  )
}
