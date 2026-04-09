import type { AudienceKind } from '../../entities/knowledge/types'

type AudienceSegmentProps = {
  value: AudienceKind
  onChange: (value: AudienceKind) => void
}

export function AudienceSegment({ value, onChange }: AudienceSegmentProps) {
  return (
    <div
      aria-label="Контур: БУРОВАЯ или ТКРС"
      className="audience-segment"
      role="group"
    >
      <button
        aria-pressed={value === 'bu'}
        className={
          value === 'bu'
            ? 'audience-segment__btn is-active'
            : 'audience-segment__btn'
        }
        type="button"
        onClick={() => onChange('bu')}
      >
        БУРОВАЯ
      </button>
      <button
        aria-pressed={value === 'tkrs'}
        className={
          value === 'tkrs'
            ? 'audience-segment__btn is-active'
            : 'audience-segment__btn'
        }
        type="button"
        onClick={() => onChange('tkrs')}
      >
        ТКРС
      </button>
    </div>
  )
}
