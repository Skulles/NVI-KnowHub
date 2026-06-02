import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  type FuelToolFormSnapshot,
  loadFuelToolForm,
  sanitizeFuelNumericInput,
  saveFuelToolForm,
} from './fuelToolStorage'

// ─── helpers ────────────────────────────────────────────────────────────────

function readNum(raw: string): number {
  const v = parseFloat(String(raw).trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : Number.NaN
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

function formatLitersForInput(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    useGrouping: false,
  })
}

function computeOutputs(form: FuelToolFormSnapshot) {
  const kmS = readNum(form.kmStart)
  const kmE = readNum(form.kmEnd)
  const sL = readNum(form.startL)
  const ref = readNum(form.refuel)
  const pre = Math.max(0, readNum(form.preheat) || 0)
  const idle = readNum(form.idleH)
  const n100 = readNum(form.norm100)
  const nIdle = readNum(form.normIdle)
  const nPre = readNum(form.normPreheat)

  const kmShift =
    Number.isFinite(kmS) && Number.isFinite(kmE) ? Math.max(0, kmE - kmS) : Number.NaN
  const driveL =
    Number.isFinite(kmShift) && Number.isFinite(n100) ? (kmShift / 100) * n100 : Number.NaN
  const idleL =
    Number.isFinite(idle) && Number.isFinite(nIdle) && Number.isFinite(nPre)
      ? idle * nIdle + pre * nPre
      : Number.NaN
  const total =
    Number.isFinite(driveL) && Number.isFinite(idleL) ? driveL + idleL : Number.NaN
  const endL =
    Number.isFinite(sL) && Number.isFinite(ref) && Number.isFinite(total)
      ? sL + ref - total
      : Number.NaN

  return { kmShift, driveL, idleL, total, endL }
}

// ─── ui primitives ──────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface-card border border-surface-border overflow-hidden shadow-sheet">
      <header className="px-4 py-3 border-surface-border" style={{paddingBottom: 0}}>
        <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-tint-blue">
          {title}
        </h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  suffix,
  value,
  onValueChange,
}: {
  label: string
  suffix: string
  value: string
  onValueChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-2 flex-1 min-w-0">
      <span className="text-[13px] text-label-secondary">
        {label}
      </span>
      <div className="flex items-center bg-surface-input/80 border border-surface-border/90 rounded-xl shadow-chromeTop focus-within:ring-2 focus-within:ring-tint-blue/50 focus-within:border-transparent transition-[box-shadow,border-color] duration-200">
        <input
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-[14px] text-label-primary placeholder:text-label-tertiary/50 focus:outline-none"
          inputMode="decimal"
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onFocus={() => { if (value === '0') onValueChange('') }}
          onBlur={() => { if (value === '') onValueChange('0') }}
        />
        <span className="pr-3 text-[12px] font-medium text-label-tertiary whitespace-nowrap select-none">
          {suffix}
        </span>
      </div>
    </label>
  )
}

function ResultRow({
  label,
  value,
  unit,
  emphasis = false,
  color,
  last = false,
}: {
  label: string
  value: number
  unit: string
  emphasis?: boolean
  color?: string
  last?: boolean
}) {
  const valid = Number.isFinite(value)
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-3 ${last ? '' : 'border-b border-surface-divider'}`}
    >
      <dt
        className={`text-[13px] leading-snug ${emphasis ? 'text-label-primary font-medium' : 'text-label-secondary'}`}
      >
        {label}
      </dt>
      <dd
        className={`m-0 tabular-nums shrink-0 ${emphasis ? 'text-[18px] font-semibold' : 'text-[15px] font-medium'} ${valid ? (color ?? 'text-label-primary') : 'text-label-tertiary'}`}
      >
        {valid ? (
          <>
            {fmt(value)}{' '}
            <span className="text-[11px] font-normal text-label-tertiary">{unit}</span>
          </>
        ) : (
          '—'
        )}
      </dd>
    </div>
  )
}

// ─── main component ──────────────────────────────────────────────────────────

export function FuelCalculator() {
  const [form, setForm] = useState<FuelToolFormSnapshot>(() => loadFuelToolForm())

  useEffect(() => {
    saveFuelToolForm(form)
  }, [form])

  const setField = (key: keyof FuelToolFormSnapshot) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: sanitizeFuelNumericInput(value) }))
  }

  const out = useMemo(() => computeOutputs(form), [form])

  const carryOver = useCallback(() => {
    setForm((prev) => {
      const { endL } = computeOutputs(prev)
      if (!Number.isFinite(endL)) return prev
      return {
        ...prev,
        kmStart: sanitizeFuelNumericInput(prev.kmEnd),
        startL: formatLitersForInput(endL),
        refuel: '0',
      }
    })
  }, [])

  const endLColor =
    Number.isFinite(out.endL)
      ? out.endL < 0
        ? 'text-red-400'
        : out.endL < 10
          ? 'text-amber-400'
          : 'text-emerald-400'
      : undefined

  return (
    <article style={{paddingBottom: '50px'}} className="max-w-[58rem]">
      {/* ── header ── */}
      <header className="mb-8">
        
        <h1 className="text-[1.5rem] font-semibold tracking-tighter text-label-primary mb-2">
          Расчёт расхода топлива за смену
        </h1>
        <p className="text-label-secondary text-[14px] leading-relaxed">
          Оценка расхода и ожидаемого остатка топлива в баке по нормам и заправкам.
        </p>
      </header>

      <div className="grid lg:grid-cols-[1fr_420px] gap-5 items-start">
        {/* ── left: inputs ── */}
        <div className="flex flex-col gap-4">

          {/* Одометр + Топливо side by side */}
          <div className="grid grid-cols-2 gap-4">
            <Card title="Одометр">
              <div className="flex flex-col gap-4">
                <Field
                  label="Начало смены"
                  suffix="км"
                  value={form.kmStart}
                  onValueChange={setField('kmStart')}
                />
                <Field
                  label="Конец смены"
                  suffix="км"
                  value={form.kmEnd}
                  onValueChange={setField('kmEnd')}
                />
              </div>
            </Card>

            <Card title="Топливо">
              <div className="flex flex-col gap-4">
                <Field
                  label="В баке на начало"
                  suffix="л"
                  value={form.startL}
                  onValueChange={setField('startL')}
                />
                <Field
                  label="Заправлено"
                  suffix="л"
                  value={form.refuel}
                  onValueChange={setField('refuel')}
                />
              </div>
            </Card>
          </div>

          {/* Простой и прогревы */}
          <Card title="Простой и прогревы">
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Прогревы"
                suffix="усл. ед."
                value={form.preheat}
                onValueChange={setField('preheat')}
              />
              <Field
                label="Холостой ход"
                suffix="ч"
                value={form.idleH}
                onValueChange={setField('idleH')}
              />
            </div>
          </Card>

          {/* Нормативы */}
          <Card title="Нормативы расхода">
            <div className="grid grid-cols-3 gap-4">
              <Field
                label="На 100 км"
                suffix="л"
                value={form.norm100}
                onValueChange={setField('norm100')}
              />
              <Field
                label="Холостой ход"
                suffix="л/ч"
                value={form.normIdle}
                onValueChange={setField('normIdle')}
              />
              <Field
                label="Один прогрев"
                suffix="л"
                value={form.normPreheat}
                onValueChange={setField('normPreheat')}
              />
            </div>
          </Card>
        </div>

        {/* ── right: results + action ── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-6">

          {/* Результат */}
          <section className="rounded-2xl bg-surface-card border border-surface-border overflow-hidden shadow-sheet">
            <header className="px-4 py-3 border-surface-border">
              <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-tint-blue">
                Результат
              </h2>
            </header>
            <div className="px-4">
              <dl className="m-0 border-3-child-none">
                <ResultRow label="Пробег за смену" value={out.kmShift} unit="км" />
                <ResultRow label="Расход при движении" value={out.driveL} unit="л" />
                <ResultRow label="Расход на холостой ход и прогревы" value={out.idleL} unit="л" />
                <div className="border-t border-surface-border my-1" />
                <ResultRow label="Итого расход за смену" value={out.total} unit="л" emphasis color='text-tint-blue' />
                <ResultRow
                  label="Ожидаемый остаток"
                  value={out.endL}
                  unit="л"
                  emphasis
                  color={endLColor}
                  last
                />
              </dl>
            </div>
            <div className="h-3" />
          </section>

          {/* Перенос на следующую смену */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={!Number.isFinite(out.endL)}
              onClick={carryOver}
              className="w-full bg-tint-blue hover:bg-tint-blue-hover disabled:opacity-35 disabled:cursor-not-allowed text-white font-medium text-[14px] py-3 px-5 rounded-xl transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
            >
              Обновить данные для следующей смены
            </button>
            <p className="m-0 text-[12px] text-label-tertiary leading-relaxed">
              Показание одометра на конец смены переносится на начало смены, расчётный
              остаток топлива в объём в баке на начало смены.
            </p>
          </div>
        </div>
      </div>

      {/* ── footer note ── */}
      <aside style={{marginBottom: '60px'}} className="mt-6 rounded-2xl border border-surface-border/80 bg-surface-card/40 px-5 py-4">
        <p className="m-0 text-[13px] text-label-tertiary leading-relaxed">
          Если фактические показания датчика уровня топлива или бортового компьютера сильно
          отличаются от ожидаемого остатка сделайте соответствующую пометку в путевом листе
          в разделе «экономия» или «перерасход».{' '}
          <span style={{display: 'block'}} className="opacity-65">
             Нормы расхода уточняйте по действующим локальным документам.
          </span>
        </p>
      </aside>
    </article>
  )
}
