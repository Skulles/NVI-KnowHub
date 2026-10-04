import type { ComponentType } from 'react'
import { RouterIcon } from '../../components/Icons'

const COLUMNS = ['IP-адрес', 'MAC-адрес', 'Имя', 'Производитель'] as const

type DiscoveryGroup = {
  id: string
  title: string
  edge: string
  band: string
  chip: string
  icon: ComponentType<{ className?: string }>
}

function CameraIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M15.75 10.5 20.47 5.78a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BoardIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <rect
        x="5"
        y="6"
        width="14"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M9 6V4.25M12 6V4.25M15 6V4.25M9 18v1.75M12 18v1.75M15 18v1.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

function OtherDevicesIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="8.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  )
}

const GROUPS: DiscoveryGroup[] = [
  {
    id: 'mikrotik',
    title: 'MikroTik',
    edge: 'shadow-[inset_3px_0_0_#7c8cff]',
    band: 'bg-tint-blue/[0.08]',
    chip: 'bg-tint-blue/15 text-tint-blue-hover',
    icon: RouterIcon
  },
  {
    id: 'cameras',
    title: 'Камеры',
    edge: 'shadow-[inset_3px_0_0_#38bdf8]',
    band: 'bg-sky-400/[0.08]',
    chip: 'bg-sky-400/15 text-sky-300',
    icon: CameraIcon
  },
  {
    id: 'repka',
    title: 'RepkaPi',
    edge: 'shadow-[inset_3px_0_0_#34d399]',
    band: 'bg-emerald-400/[0.08]',
    chip: 'bg-emerald-400/15 text-emerald-300',
    icon: BoardIcon
  },
  {
    id: 'other',
    title: 'Остальное',
    edge: 'shadow-[inset_3px_0_0_#697393]',
    band: 'bg-white/[0.035]',
    chip: 'bg-white/[0.06] text-label-secondary',
    icon: OtherDevicesIcon
  }
]

export function NetworkDiscovery() {
  return (
    <article style={{ paddingBottom: '50px' }} className="max-w-[68rem]">
      <header className="mb-8">
        <h1 className="mb-2 text-[1.625rem] font-semibold tracking-tighter text-label-primary">
          Поиск устройств в сети
        </h1>
        <p className="text-[15px] leading-relaxed text-label-secondary">
          Сканирование локальной сети и обнаружение доступных устройств.
        </p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sheet">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="bg-white/[0.03]">
                {COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-surface-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-label-tertiary [&:not(:last-child)]:border-r [&:not(:last-child)]:border-surface-divider/55"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            {GROUPS.map((group, index) => {
              const Icon = group.icon
              const isLast = index === GROUPS.length - 1
              return (
                <tbody key={group.id}>
                  <tr className={group.band}>
                    <th
                      colSpan={COLUMNS.length}
                      scope="colgroup"
                      className={`px-4 py-2.5 text-left font-normal ${group.edge}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${group.chip}`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[13.5px] font-semibold tracking-tight text-label-primary">
                          {group.title}
                        </span>
                        <span className="ml-auto inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-black/25 px-2 py-0.5 font-mono text-[11px] tabular-nums text-label-secondary">
                          0
                        </span>
                      </div>
                    </th>
                  </tr>
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className={`px-4 py-3 ${group.edge} ${isLast ? '' : 'border-b border-surface-divider/50'}`}
                    >
                      <p className="m-0 pl-9 text-[13px] text-label-tertiary">Нет устройств</p>
                    </td>
                  </tr>
                </tbody>
              )
            })}
          </table>
        </div>
      </section>
    </article>
  )
}
