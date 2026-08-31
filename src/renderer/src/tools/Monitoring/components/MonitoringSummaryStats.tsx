import { useEffect, useState } from 'react'
import {
  HEALTH_COLORS,
  HEALTH_LABELS,
  type HealthCounts,
  type KindHealthGroup,
  type MonitoringObjectHealth,
  type SummaryHealthFilter
} from '../monitoringObjectHealth'
import {
  formatUndeterminedObjectKindTitle,
  UNDETERMINED_OBJECT_KIND_HINT
} from '../monitoringObjectKind'

const DONUT_ORDER: MonitoringObjectHealth[] = ['online', 'problems', 'offline']
const DONUT_RADIUS = 15.9155
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS
const DONUT_DURATION_MS = 700
const STATS_CARD_SHELL =
  'box-border flex h-[7rem] w-[15.25rem] max-w-full shrink-0 items-center rounded-2xl border border-surface-border bg-surface-card px-4 shadow-sheet'

const EMPTY_SHARES: Record<MonitoringObjectHealth, number> = {
  online: 0,
  problems: 0,
  offline: 0
}

function sharesFromCounts(counts: HealthCounts): Record<MonitoringObjectHealth, number> {
  return {
    online: counts.online,
    problems: counts.problems,
    offline: counts.offline
  }
}

function DonutChart({ counts }: { counts: HealthCounts }) {
  const [shares, setShares] = useState(EMPTY_SHARES)
  const total = Math.max(counts.total, 1)
  let offset = 0

  useEffect(() => {
    let inner = 0
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        setShares(sharesFromCounts(counts))
      })
    })
    return () => {
      window.cancelAnimationFrame(outer)
      window.cancelAnimationFrame(inner)
    }
  }, [counts.offline, counts.online, counts.problems, counts.total])

  return (
    <svg viewBox="0 0 36 36" className="h-[4.75rem] w-[4.75rem] -rotate-90" aria-hidden>
      <circle
        cx="18"
        cy="18"
        r={DONUT_RADIUS}
        fill="none"
        className="stroke-white/[0.06]"
        strokeWidth="4.5"
      />
      {DONUT_ORDER.map((health) => {
        const length = (shares[health] / total) * DONUT_CIRCUMFERENCE
        const circle = (
          <circle
            key={health}
            cx="18"
            cy="18"
            r={DONUT_RADIUS}
            fill="none"
            className={`${HEALTH_COLORS[health]} motion-reduce:transition-none`}
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="butt"
            style={{
              strokeDasharray: `${length} ${DONUT_CIRCUMFERENCE}`,
              strokeDashoffset: -offset,
              transition: `stroke-dasharray ${DONUT_DURATION_MS}ms ease-out, stroke-dashoffset ${DONUT_DURATION_MS}ms ease-out`
            }}
          />
        )
        offset += length
        return circle
      })}
    </svg>
  )
}

function KindStatsCard({
  group,
  selected,
  onSelect
}: {
  group: KindHealthGroup
  selected: SummaryHealthFilter | null
  onSelect: (filter: SummaryHealthFilter) => void
}) {
  if (group.kind === 'auto') {
    const isSelected = selected?.kind === 'auto' && !selected.health
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={group.label}
        onClick={() => onSelect({ kind: 'auto' })}
        className={`${STATS_CARD_SHELL} text-left transition-colors ${
          isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
        }`}
      >
        <span className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold uppercase tracking-[0.09em] text-tint-blue">
            {formatUndeterminedObjectKindTitle(group.counts.total)}
          </span>
          <span className="whitespace-pre-line text-[11px] font-medium leading-snug text-label-tertiary">
            {UNDETERMINED_OBJECT_KIND_HINT}
          </span>
        </span>
      </button>
    )
  }

  return (
    <section className={`${STATS_CARD_SHELL} gap-3`}>
        <div className="relative h-[4.75rem] w-[4.75rem] shrink-0">
          <DonutChart counts={group.counts} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold tabular-nums text-label-primary">
            {group.counts.total}
          </span>
        </div>
        <div className="flex w-max flex-col">
          <h3 className="m-0 mb-1 text-center">
            <button
              type="button"
              aria-pressed={selected?.kind === group.kind && !selected.health}
              onClick={() => onSelect({ kind: group.kind })}
              className={`rounded-md px-1 text-[12px] font-semibold uppercase tracking-[0.09em] text-tint-blue transition-colors ${
                selected?.kind === group.kind && !selected.health
                  ? 'bg-white/[0.08]'
                  : 'hover:bg-white/[0.05]'
              }`}
            >
              {group.label}
            </button>
          </h3>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {DONUT_ORDER.map((health) => {
              const count = group.counts[health]
              const isSelected = selected?.kind === group.kind && selected.health === health
              return (
                <li key={health}>
                  <button
                    type="button"
                    disabled={count === 0}
                    aria-pressed={isSelected}
                    onClick={() => onSelect({ kind: group.kind, health })}
                    className={`flex w-full items-baseline gap-1.5 rounded-md px-1 text-left text-[13px] font-medium leading-5 transition-colors ${
                      HEALTH_COLORS[health]
                    } ${
                      count === 0
                        ? 'cursor-default opacity-40'
                        : isSelected
                          ? 'bg-white/[0.08]'
                          : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="inline-block w-[2ch] shrink-0 text-right tabular-nums font-semibold">
                      {count}
                    </span>
                    <span className="whitespace-nowrap">{HEALTH_LABELS[health]}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
    </section>
  )
}

export function MonitoringSummaryStats({
  groups,
  selected,
  onSelect
}: {
  groups: KindHealthGroup[]
  selected: SummaryHealthFilter | null
  onSelect: (filter: SummaryHealthFilter) => void
}) {
  if (groups.length === 0) return null

  return (
    <div className="mb-4 flex flex-wrap items-start justify-center gap-3" aria-label="Сводная статистика">
      {groups.map((group) => (
        <KindStatsCard key={group.kind} group={group} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  )
}
