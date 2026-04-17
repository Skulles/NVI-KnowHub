import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  type FuelToolFormSnapshot,
  loadFuelToolForm,
  sanitizeFuelNumericInput,
  saveFuelToolForm,
} from './fuelToolStorage'

function fmt(n: number) {
  return Number.isFinite(n)
    ? n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    : '—'
}

function fmtWithUnit(n: number, unit: string) {
  if (!Number.isFinite(n)) {
    return '—'
  }
  return (
    <>
      {fmt(n)}{' '}
      <span className="fuel-tool-results__unit">{unit}</span>
    </>
  )
}

function readNum(raw: string): number {
  const v = parseFloat(String(raw).trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : Number.NaN
}

function formatLitersForInput(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return rounded.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    useGrouping: false,
  })
}

function computeFuelOutputs(form: FuelToolFormSnapshot) {
  const kmS = readNum(form.kmStart)
  const kmE = readNum(form.kmEnd)
  const sL = readNum(form.startL)
  const ref = readNum(form.refuel)
  const pre = Math.max(0, readNum(form.preheat) || 0)
  const idle = readNum(form.idleH)
  const n100 = readNum(form.norm100)
  const nIdle = readNum(form.normIdle)
  const nPre = readNum(form.normPreheat)

  let kmShift = Number.NaN
  if (Number.isFinite(kmS) && Number.isFinite(kmE)) {
    kmShift = Math.max(0, kmE - kmS)
  }

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

  return {
    kmShift,
    driveL,
    idleL,
    total,
    endL,
  }
}

export function FuelConsumptionTool() {
  const [form, setForm] = useState<FuelToolFormSnapshot>(() => loadFuelToolForm())

  useEffect(() => {
    saveFuelToolForm(form)
  }, [form])

  const setNumericField =
    (key: keyof FuelToolFormSnapshot) => (e: ChangeEvent<HTMLInputElement>) => {
      const next = sanitizeFuelNumericInput(e.target.value)
      setForm((prev) => ({ ...prev, [key]: next }))
    }

  const out = useMemo(() => computeFuelOutputs(form), [form])

  const carryOverToNextShift = useCallback(() => {
    setForm((prev) => {
      const { endL } = computeFuelOutputs(prev)
      if (!Number.isFinite(endL)) {
        return prev
      }
      return {
        ...prev,
        kmStart: sanitizeFuelNumericInput(prev.kmEnd),
        startL: formatLitersForInput(endL),
      }
    })
  }, [])

  const canCarryOver = Number.isFinite(out.endL)

  return (
    <article className="tool-page tool-page--fuel">
      <header className="tool-page__header">
        <h1 className="tool-page__title">Расчёт расхода топлива за смену</h1>
        <p className="tool-page__lead">
          Оценка расхода по пробегу и холостому ходу и ожидаемого остатка в баке по нормам и
          заправкам.
        </p>
      </header>

      <div className="fuel-tool-layout">
        <div className="fuel-tool-inputs" aria-label="Исходные данные для расчёта">
          <section className="fuel-tool-card fuel-tool-card--group" aria-labelledby="fuel-grp-odometer">
            <h2 className="fuel-tool-card__title" id="fuel-grp-odometer">
              Одометр
            </h2>
            <div className="fuel-tool-fields fuel-tool-fields--row">
              <label className="fuel-tool-field">
                <span>Начало смены</span>
                <span className="fuel-tool-field__control">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.kmStart}
                    onChange={setNumericField('kmStart')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    км
                  </span>
                </span>
              </label>
              <label className="fuel-tool-field">
                <span>Конец смены</span>
                <span className="fuel-tool-field__control">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.kmEnd}
                    onChange={setNumericField('kmEnd')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    км
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="fuel-tool-card fuel-tool-card--group" aria-labelledby="fuel-grp-fuel">
            <h2 className="fuel-tool-card__title" id="fuel-grp-fuel">
              Топливо
            </h2>
            <div className="fuel-tool-fields fuel-tool-fields--row">
              <label className="fuel-tool-field">
                <span>В баке на начало</span>
                <span className="fuel-tool-field__control">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.startL}
                    onChange={setNumericField('startL')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    л
                  </span>
                </span>
              </label>
              <label className="fuel-tool-field">
                <span>Заправлено</span>
                <span className="fuel-tool-field__control">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.refuel}
                    onChange={setNumericField('refuel')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    л
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section
            className="fuel-tool-card fuel-tool-card--group fuel-tool-card--span-wide"
            aria-labelledby="fuel-grp-idle"
          >
            <h2 className="fuel-tool-card__title" id="fuel-grp-idle">
              Простой и прогревы
            </h2>
            <div className="fuel-tool-fields fuel-tool-fields--row fuel-tool-fields--idle-one-line">
              <label className="fuel-tool-field">
                <span>Прогревы</span>
                <span className="fuel-tool-field__control fuel-tool-field__control--suffix-md">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.preheat}
                    onChange={setNumericField('preheat')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    усл. ед.
                  </span>
                </span>
              </label>
              <label className="fuel-tool-field">
                <span>Часы холостого хода</span>
                <span className="fuel-tool-field__control">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.idleH}
                    onChange={setNumericField('idleH')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    ч
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section
            className="fuel-tool-card fuel-tool-card--group fuel-tool-card--norms fuel-tool-card--span-wide"
            aria-labelledby="fuel-grp-norms"
          >
            <h2 className="fuel-tool-card__title" id="fuel-grp-norms">
              Нормативы расхода
            </h2>
            <div className="fuel-tool-fields fuel-tool-fields--row fuel-tool-fields--norms">
              <label className="fuel-tool-field">
                <span>На 100 км</span>
                <span className="fuel-tool-field__control fuel-tool-field__control--suffix-lg">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.norm100}
                    onChange={setNumericField('norm100')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    л
                  </span>
                </span>
              </label>
              <label className="fuel-tool-field">
                <span>Холостой ход</span>
                <span className="fuel-tool-field__control">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.normIdle}
                    onChange={setNumericField('normIdle')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    л/ч
                  </span>
                </span>
              </label>
              <label className="fuel-tool-field">
                <span>Один прогрев</span>
                <span className="fuel-tool-field__control">
                  <input
                    className="settings-dialog-field__input fuel-tool-field__input"
                    inputMode="decimal"
                    type="text"
                    value={form.normPreheat}
                    onChange={setNumericField('normPreheat')}
                  />
                  <span className="fuel-tool-field__suffix" aria-hidden="true">
                    л
                  </span>
                </span>
              </label>
            </div>
          </section>
        </div>

        <div className="fuel-tool-results-stack">
          <section className="fuel-tool-card fuel-tool-card--results" aria-labelledby="fuel-out-label">
            <h2 className="fuel-tool-card__title" id="fuel-out-label">
              Результат
            </h2>
            <dl className="fuel-tool-results">
              <div className="fuel-tool-results__row">
                <dt>Пробег за смену</dt>
                <dd>{fmtWithUnit(out.kmShift, 'км')}</dd>
              </div>
              <div className="fuel-tool-results__row">
                <dt>Расход при движении</dt>
                <dd>{fmtWithUnit(out.driveL, 'лㅤ')}</dd>
              </div>
              <div className="fuel-tool-results__row" style={{borderBottom: 'none'}}>
                <dt>Расход на холостой ход и прогревы</dt>
                <dd>{fmtWithUnit(out.idleL, 'лㅤ')}</dd>
              </div>
              <div className="fuel-tool-results__row fuel-tool-results__row--emphasis">
                <dt>Итого расход за смену</dt>
                <dd>{fmtWithUnit(out.total, 'лㅤ')}</dd>
              </div>
              <div className="fuel-tool-results__row fuel-tool-results__row--emphasis">
                <dt>Ожидаемый остаток</dt>
                <dd>{fmtWithUnit(out.endL, 'лㅤ')}</dd>
              </div>
            </dl>
          </section>

          <div className="fuel-tool-carryover">
            <button
              className="primary-button fuel-tool-carryover__btn"
              disabled={!canCarryOver}
              type="button"
              onClick={carryOverToNextShift}
            >
              Обновить данные для следующей смены
            </button>
            <p className="fuel-tool-carryover__hint">
              Показание одометра на конец смены переносится в поле «на начало смены», расчётный
              остаток топлива — в «объём в баке на начало смены».
            </p>
          </div>
        </div>
      </div>

      <aside className="fuel-tool-note" role="note">
        <p>
          Если после расчёта фактические показания датчика уровня топлива и/или бортового
          компьютера сильно отличаются от ожидаемого остатка, сделайте соответствующую пометку
          в путевом листе в разделе «экономия» или «перерасход».
        </p>
        <p className="fuel-tool-note__ref">
          Конкретные нормы расхода топлива уточняйте по действующим локальным документам.
        </p>
      </aside>
    </article>
  )
}
