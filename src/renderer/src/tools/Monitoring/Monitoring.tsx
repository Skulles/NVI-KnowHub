import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { XMarkIcon } from '../../components/Icons'
import type {
  MonitoringHttpTarget,
  MonitoringPingResult,
  MonitoringPingStatus,
  MonitoringPingTarget
} from '@shared/api'
import cameraIconUrl from '../../assets/monitoring/camera-icon.png'
import hornIconUrl from '../../assets/monitoring/horn-icon.png'
import {
  DEFAULT_SERVER_LOGIN,
  buildMonitoringObject,
  joinIPv4Octets,
  loadMonitoringSnapshot,
  normalizePastedIPv4,
  objectDigits,
  parseIPv4Octets,
  parseMonitoringObject,
  sanitizeMonitoringDigits,
  sanitizeIPv4OctetInput,
  saveMonitoringSnapshot,
  type IPv4Octets,
  type MonitoringObject
} from './monitoringStorage'
import {
  MONITORING_LINK_INTERVAL_MS,
  MONITORING_MAX_LINK_BATCH,
  MONITORING_MAX_PREVIEW_BATCH,
  MONITORING_MAX_SERVER_BATCH,
  MONITORING_PREVIEW_INTERVAL_MS,
  MONITORING_SERVER_INTERVAL_MS,
  MONITORING_STREAMS_REFRESH_MS,
  MONITORING_TICK_MS,
  createProbeSchedule,
  failureBackoffMs,
  linkFailureBackoffMs,
  successDelayMs,
  type ObjectProbeSchedule
} from './monitoringSchedule'

type ResultMap = Record<string, MonitoringPingResult>
type LatencyHistoryMap = Record<string, number[]>
type VersionErrorMap = Record<string, string>
type EditorState = { mode: 'add' | 'edit'; objectId?: string } | null

const LINK_LATENCY_HISTORY_LIMIT = 10
const OWL_GUARD_UNREACHABLE = 'не удалось подключиться к OWL.Guard'

function versionFetchKey(object: MonitoringObject): string {
  return `${object.id}|${object.serverHost}|${object.serverLogin}|${object.serverPassword}`
}

function formatServerVersionLabel(version: string): string {
  const trimmed = version.trim()
  if (!trimmed) return ''
  return /^версия\b/i.test(trimmed) ? trimmed : `Версия ${trimmed}`
}

function localizeMonitoringError(message: string | undefined): string {
  const raw = (message ?? '').trim()
  if (!raw) return 'Не удалось получить версию'

  const lower = raw.toLowerCase()

  if (lower.includes('invalid user credentials') || lower.includes('invalid_grant')) {
    return 'Неверный логин или пароль'
  }
  if (lower.includes('account is not fully set up')) {
    return 'Учётная запись не настроена'
  }
  if (lower.includes('account disabled') || lower.includes('user disabled')) {
    return 'Учётная запись отключена'
  }
  if (lower.includes('unauthorized_client')) {
    return 'Клиент не может использовать этот способ входа'
  }
  if (lower.includes('invalid version request')) {
    return 'Некорректные данные для авторизации'
  }
  if (lower.includes('invalid token response') || lower.includes('missing access_token')) {
    return 'Сервер вернул некорректный токен'
  }
  if (lower.includes('empty version response')) {
    return 'Пустой ответ версии'
  }
  if (lower.includes('api недоступен')) {
    return raw
  }
  if (lower.includes('укажите пароль')) {
    return raw
  }
  if (lower.includes('aborted') || lower.includes('timeout') || lower.includes('timed out')) {
    return 'Превышено время ожидания'
  }
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('econnrefused')) {
    return 'Нет связи с сервером авторизации'
  }
  if (/^http\s*401\b/i.test(raw) || lower.includes('unauthorized')) {
    return 'Нет доступа (ошибка авторизации)'
  }
  if (/^http\s*403\b/i.test(raw)) {
    return 'Доступ запрещён'
  }
  if (/^http\s*404\b/i.test(raw)) {
    return 'Эндпоинт версии не найден'
  }
  if (/^http\s*\d+/i.test(raw)) {
    return `Ошибка сервера (${raw.replace(/^http\s*/i, 'HTTP ')})`
  }

  return raw
}

function targetId(objectId: string, kind: 'link' | 'server'): string {
  return `${objectId}:${kind}`
}

function isOnline(result: MonitoringPingResult | undefined): boolean {
  return (result?.status ?? 'unknown') === 'online'
}

function averageLatency(history: number[] | undefined): number | null {
  if (!history?.length) return null
  return history.reduce((sum, value) => sum + value, 0) / history.length
}

function formatLatency(latencyMs: number): string {
  return `~${Math.round(latencyMs)} мс`
}

function latencyTextClasses(latencyMs: number | null): string {
  if (latencyMs === null) return 'text-label-tertiary'
  if (latencyMs <= 100) return 'text-emerald-400'
  if (latencyMs <= 300) return 'text-amber-300'
  return 'text-red-400'
}

function statusText(status: MonitoringPingStatus | 'unknown', checking: boolean): string {
  if (checking) return 'Проверка'
  switch (status) {
    case 'online':
      return 'Онлайн'
    case 'offline':
      return 'Офлайн'
    case 'error':
      return 'Ошибка'
    default:
      return 'Нет данных'
  }
}

function linkConnectionText(status: MonitoringPingStatus | 'unknown', checking: boolean): string {
  if (checking || status === 'unknown') return 'Проверка соединения…'
  switch (status) {
    case 'online':
      return 'Соединение установлено'
    case 'offline':
      return 'Нет ответа'
    case 'error':
      return 'Ошибка соединения'
    default:
      return 'Проверка соединения…'
  }
}

function statusClasses(status: MonitoringPingStatus | 'unknown', checking: boolean): string {
  if (checking && status === 'unknown') return 'text-tint-blue'
  switch (status) {
    case 'online':
      return 'text-emerald-400'
    case 'offline':
      return 'text-red-400'
    case 'error':
      return 'text-amber-400'
    default:
      return 'text-label-tertiary/50'
  }
}

function Card({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="group rounded-2xl border border-surface-border bg-surface-card shadow-sheet overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.09em] text-tint-blue">{title}</h2>
        {action}
      </header>
      <div className="px-5 pb-5 pt-0">{children}</div>
    </section>
  )
}

function ObjectCodeTitle({ code }: { code: string }) {
  const normalized = code.replace(/\/$/, '')
  const match = normalized.match(/^(owl)(.*)$/i)
  if (!match) {
    return <span className="font-semibold [font-variation-settings:'wght'_600]">{normalized}</span>
  }

  return (
    <>
      <span className="font-normal [font-variation-settings:'wght'_430]">{match[1]}</span>
      <span className="font-bold [font-variation-settings:'wght'_700]">{match[2]}</span>
    </>
  )
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.606 7.606 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 0 1 0-7.5 3.75 3.75 0 0 1 0 7.5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />
    </svg>
  )
}

function EyeSlashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 2.25 12s3.75 6.75 9.75 6.75c1.77 0 3.4-.37 4.82-.98M6.228 6.228A10.45 10.45 0 0 1 12 5.25c6 0 9.75 6.75 9.75 6.75a10.477 10.477 0 0 1-1.728 2.772M6.228 6.228 3 3m3.228 3.228 13.544 13.544M21 21l-2.772-2.772" />
    </svg>
  )
}

function EndpointIcon({ kind }: { kind: 'link' | 'server' }) {
  if (kind === 'server') {
    return (
      <svg viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor" aria-hidden>
        <path d="M6.75 3A2.75 2.75 0 0 0 4 5.75v3A2.75 2.75 0 0 0 6.75 11h10.5A2.75 2.75 0 0 0 20 8.25v-2.5A2.75 2.75 0 0 0 17.25 3H6.75Zm1.75 5.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM6.75 13A2.75 2.75 0 0 0 4 15.75v2.5A2.75 2.75 0 0 0 6.75 21h10.5A2.75 2.75 0 0 0 20 18.25v-2.5A2.75 2.75 0 0 0 17.25 13H6.75Zm1.75 5.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor" aria-hidden>
      <path d="M12 17.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z" />
      <path d="M7.05 13.27a7.1 7.1 0 0 1 9.9 0 1 1 0 0 1-1.4 1.43 5.1 5.1 0 0 0-7.1 0 1 1 0 0 1-1.4-1.43Z" />
      <path d="M3.95 9.95a11.56 11.56 0 0 1 16.1 0 1 1 0 1 1-1.4 1.43 9.56 9.56 0 0 0-13.3 0 1 1 0 0 1-1.4-1.43Z" />
    </svg>
  )
}

function CamerasIcon() {
  return (
    <span
      className="inline-block h-6 w-6 bg-current"
      style={{
        WebkitMaskImage: `url(${cameraIconUrl})`,
        maskImage: `url(${cameraIconUrl})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center'
      }}
      aria-hidden
    />
  )
}

function HornsIcon() {
  return (
    <span
      className="inline-block h-6 w-6 bg-current"
      style={{
        WebkitMaskImage: `url(${hornIconUrl})`,
        maskImage: `url(${hornIconUrl})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center'
      }}
      aria-hidden
    />
  )
}

function ratioStatusClass(online: number, total: number): string {
  if (total <= 0) return 'text-label-tertiary/50'
  if (online <= 0) return 'text-red-400'
  if (online < total) return 'text-amber-300'
  return 'text-emerald-400'
}

function MetricCountSpinner() {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-label-tertiary/40 border-t-tint-blue"
      aria-hidden
    />
  )
}

function ObjectMetricStatus({
  label,
  online,
  total,
  icon,
  muted = false,
  onlineUnknown = false,
  loading = false
}: {
  label: string
  /** `null` — сервер ещё не ответил числом online. */
  online: number | null
  total: number
  icon: ReactNode
  muted?: boolean
  /** When true, show "?" instead of the online count (e.g. no link). */
  onlineUnknown?: boolean
  /** First PreviewV2 in progress — spinner instead of the online count. */
  loading?: boolean
}) {
  const hasOnlineValue = online !== null && !onlineUnknown && !loading
  const statusClass =
    muted || onlineUnknown || loading || online === null
      ? 'text-label-tertiary'
      : ratioStatusClass(online, total)
  const onlineLabel = onlineUnknown || online === null ? '?' : String(online)
  const title = loading ? `${label}: загрузка…` : `${label}: ${onlineLabel}/${total}`

  return (
    <>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center ${statusClass}`} title={title}>
        {icon}
      </span>
      <p
        className={`m-0 flex h-6 items-center font-mono text-[18px] font-semibold leading-6 tracking-tight ${
          muted || onlineUnknown || loading || !hasOnlineValue ? 'text-label-tertiary' : 'text-label-primary'
        }`}
        title={title}
      >
        <span className="inline-flex h-6 min-w-[1ch] items-center justify-center">
          {loading ? <MetricCountSpinner /> : onlineLabel}
        </span>
        <span>/{total}</span>
      </p>
    </>
  )
}

const ipv4FieldClass =
  'flex h-[42px] w-full items-center rounded-xl border border-surface-border/90 bg-surface-input/80 px-2 font-mono text-[14px] text-label-primary shadow-chromeTop transition-[box-shadow,border-color] focus-within:border-transparent focus-within:ring-2 focus-within:ring-tint-blue/50'

const textFieldClass =
  'h-[42px] w-full rounded-xl border border-surface-border/90 bg-surface-input/80 px-3 text-[14px] text-label-primary shadow-chromeTop transition-[box-shadow,border-color] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-tint-blue/50'

const ipv4OctetClass =
  'min-w-0 w-[2.75rem] flex-1 bg-transparent py-0 text-center text-[14px] text-label-primary focus:outline-none'

function IPv4Field({
  value,
  onChange,
  autoFocus,
  onEnter,
  'aria-label': ariaLabel
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  onEnter?: () => void
  'aria-label'?: string
}) {
  const octetRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const octets = parseIPv4Octets(value)

  const focusOctet = (index: number): void => {
    octetRefs[index]?.current?.focus()
    octetRefs[index]?.current?.select()
  }

  const updateOctets = useCallback(
    (nextOctets: IPv4Octets, focusIndex?: number): void => {
      onChange(joinIPv4Octets(nextOctets))
      if (focusIndex !== undefined) {
        window.requestAnimationFrame(() => focusOctet(focusIndex))
      }
    },
    [onChange]
  )

  const handleOctetChange = (index: number, raw: string): void => {
    const next = [...octets] as IPv4Octets
    next[index] = sanitizeIPv4OctetInput(raw, octets[index])
    updateOctets(next, raw.replace(/\D/g, '').length === 3 && index < 3 ? index + 1 : undefined)
  }

  const handleOctetBlur = (index: number): void => {
    const current = octets[index]
    if (!current) return

    const next = [...octets] as IPv4Octets
    next[index] = String(Math.min(255, Number(current)))
    if (next[index] !== current) updateOctets(next)
  }

  const handleOctetKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === '.') {
      event.preventDefault()
      if (index < 3) focusOctet(index + 1)
      return
    }

    if (event.key === 'Backspace' && !octets[index] && index > 0) {
      event.preventDefault()
      focusOctet(index - 1)
      return
    }

    if (event.key === 'ArrowRight' && event.currentTarget.selectionStart === event.currentTarget.value.length && index < 3) {
      event.preventDefault()
      focusOctet(index + 1)
      return
    }

    if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart === 0 && index > 0) {
      event.preventDefault()
      focusOctet(index - 1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      onEnter?.()
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    const normalized = normalizePastedIPv4(event.clipboardData.getData('text'))
    if (!normalized) return

    event.preventDefault()
    onChange(normalized)
    window.requestAnimationFrame(() => focusOctet(3))
  }

  return (
    <div className={ipv4FieldClass} role="group" aria-label={ariaLabel}>
      {octets.map((octet, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="shrink-0 select-none text-label-tertiary" aria-hidden>.</span>}
          <input
            ref={octetRefs[index]}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={autoFocus && index === 0}
            aria-label={`${ariaLabel ?? 'IP-адрес'}, октет ${index + 1}`}
            maxLength={3}
            value={octet}
            onChange={(event) => handleOctetChange(index, event.target.value)}
            onBlur={() => handleOctetBlur(index)}
            onKeyDown={(event) => handleOctetKeyDown(index, event)}
            onPaste={handlePaste}
            className={ipv4OctetClass}
          />
        </Fragment>
      ))}
    </div>
  )
}

function ObjectEditorModal({
  editor,
  object,
  onClose,
  onSave,
  onDelete
}: {
  editor: EditorState
  object: MonitoringObject | null
  onClose: () => void
  onSave: (next: MonitoringObject, originalId?: string) => boolean
  onDelete: (id: string) => void
}) {
  const isEdit = editor?.mode === 'edit'
  const [digits, setDigits] = useState('')
  const [linkHost, setLinkHost] = useState('')
  const [serverHost, setServerHost] = useState('')
  const [serverLogin, setServerLogin] = useState(DEFAULT_SERVER_LOGIN)
  const [serverPassword, setServerPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) {
      setDigits('')
      setLinkHost('')
      setServerHost('')
      setServerLogin(DEFAULT_SERVER_LOGIN)
      setServerPassword('')
      setShowPassword(false)
      setError(null)
      return
    }

    if (isEdit && object) {
      setDigits(objectDigits(object))
      setLinkHost(object.linkHost)
      setServerHost(object.serverHost)
      setServerLogin(object.serverLogin || DEFAULT_SERVER_LOGIN)
      setServerPassword(object.serverPassword)
    } else {
      setDigits('')
      setLinkHost('')
      setServerHost('')
      setServerLogin(DEFAULT_SERVER_LOGIN)
      setServerPassword('')
    }
    setShowPassword(false)
    setError(null)
  }, [editor, isEdit, object])

  useEffect(() => {
    if (editor?.mode !== 'add') return
    if (digits.length !== 4) {
      setLinkHost('')
      setServerHost('')
      return
    }
    const defaults = parseMonitoringObject(digits)
    if (!defaults) return
    setLinkHost(defaults.linkHost)
    setServerHost(defaults.serverHost)
  }, [digits, editor?.mode])

  useEffect(() => {
    if (!editor) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor, onClose])

  if (!editor) return null

  const handleSave = (): void => {
    let next: MonitoringObject | null = null

    if (isEdit && object) {
      next = buildMonitoringObject(objectDigits(object), linkHost, serverHost, serverLogin, serverPassword)
      if (!next) {
        setError('Проверьте IP-адреса')
        return
      }
      next = { ...next, id: object.id, code: object.code }
    } else {
      if (digits.length !== 4) {
        setError('Введите 4 цифры ID объекта')
        return
      }

      next = buildMonitoringObject(digits, linkHost, serverHost, serverLogin, serverPassword)
      if (!next) {
        setError('Проверьте ID и IP-адреса')
        return
      }
    }

    const saved = onSave(next, isEdit ? editor.objectId : undefined)
    if (!saved) {
      setError(isEdit ? 'Не удалось сохранить объект' : 'Этот объект уже добавлен')
      return
    }

    onClose()
  }

  return createPortal(
    <div className="tool-view fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6" role="presentation">
      <div
        className="absolute inset-0 bg-[#0b0e16]/75 backdrop-blur-[6px]"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="monitoring-object-modal-title"
        className="relative z-[1] w-full max-w-[32rem] overflow-hidden rounded-[1.25rem] border border-surface-border/90 bg-surface-card shadow-sheet"
      >
        <header className="flex items-center justify-between gap-3 border-b border-surface-border/80 px-5 py-4">
          <h3 id="monitoring-object-modal-title" className="m-0 text-[17px] font-semibold tracking-tight text-label-primary">
            {isEdit ? 'Настройки объекта' : 'Добавить объект'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-transparent p-2 text-label-tertiary transition-colors hover:border-surface-border/80 hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
            aria-label="Закрыть"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-5">
          <div className="flex items-start gap-3">
            <label className="flex shrink-0 flex-col gap-2">
              <span className="text-[13px] font-medium text-label-secondary">ID объекта</span>
              <div
                className={`flex h-[42px] items-center gap-2 rounded-xl border border-surface-border/90 bg-surface-input/80 px-2 shadow-chromeTop transition-[box-shadow,border-color] ${
                  isEdit
                    ? 'opacity-70'
                    : 'focus-within:border-transparent focus-within:ring-2 focus-within:ring-tint-blue/50'
                }`}
              >
                <span className="shrink-0 font-mono text-[14px] font-semibold text-tint-blue select-none">owl</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus={!isEdit}
                  readOnly={isEdit}
                  aria-readonly={isEdit}
                  maxLength={4}
                  value={digits}
                  onChange={(event) => {
                    if (isEdit) return
                    setDigits(sanitizeMonitoringDigits(event.target.value))
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleSave()
                  }}
                  placeholder="0000"
                  className="w-[3.5rem] shrink-0 bg-transparent py-0 font-mono text-[16px] tracking-[0.12em] text-label-primary placeholder:text-label-tertiary/40 focus:outline-none read-only:cursor-default"
                />
              </div>
            </label>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-end gap-3">
                <span
                  className="flex h-[42px] w-10 shrink-0 items-center justify-center text-label-tertiary"
                  aria-hidden
                >
                  <EndpointIcon kind="link" />
                </span>
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">IP роутера</span>
                  <IPv4Field
                    value={linkHost}
                    onChange={(next) => {
                      setLinkHost(next)
                      setError(null)
                    }}
                    autoFocus={isEdit}
                    onEnter={handleSave}
                    aria-label="IP роутера"
                  />
                </label>
              </div>

              <div className="flex items-end gap-3">
                <span
                  className="flex h-[42px] w-10 shrink-0 items-center justify-center text-label-tertiary"
                  aria-hidden
                >
                  <EndpointIcon kind="server" />
                </span>
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">IP сервера</span>
                  <IPv4Field
                    value={serverHost}
                    onChange={(next) => {
                      setServerHost(next)
                      setError(null)
                    }}
                    onEnter={handleSave}
                    aria-label="IP сервера"
                  />
                </label>
              </div>

              <div className="flex gap-2 pl-[3.25rem]">
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">Логин OWL.Guard</span>
                  <input
                    type="text"
                    autoComplete="off"
                    value={serverLogin}
                    onChange={(event) => {
                      setServerLogin(event.target.value)
                      setError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleSave()
                    }}
                    className={textFieldClass}
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-[13px] font-medium text-label-secondary">Пароль</span>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={serverPassword}
                      onChange={(event) => {
                        setServerPassword(event.target.value)
                        setError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleSave()
                      }}
                      className={`${textFieldClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-label-tertiary transition-colors hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    >
                      {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {error && <p className="mt-4 m-0 text-[13px] text-red-300">{error}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-surface-border/80 px-5 py-4">
          {isEdit && editor.objectId && (
            <button
              type="button"
              onClick={() => onDelete(editor.objectId!)}
              className="mr-auto h-[42px] rounded-xl border border-transparent px-4 text-[14px] font-medium text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
            >
              Удалить
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-[42px] rounded-xl border border-surface-border bg-transparent px-4 text-[14px] font-medium text-label-secondary transition-colors hover:bg-white/[0.05] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={digits.length !== 4}
            className="h-[42px] rounded-xl bg-tint-blue px-4 text-[14px] font-semibold text-white transition-colors hover:bg-tint-blue-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
          >
            {isEdit ? 'Сохранить' : 'Добавить'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

function ScrollingLine({
  text,
  className = '',
  title
}: {
  text: string
  className?: string
  title?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [shiftPx, setShiftPx] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const el = textRef.current
    if (!container || !el) return

    const update = (): void => {
      setShiftPx(Math.max(0, el.scrollWidth - container.clientWidth))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [text])

  const durationSec = Math.max(6, Math.round(shiftPx / 18) + 4)

  return (
    <div
      ref={containerRef}
      className={`mt-0.5 min-h-[1.125rem] overflow-hidden ${className}`}
      title={title}
    >
      <span
        ref={textRef}
        className="inline-block max-w-none whitespace-nowrap will-change-transform"
        style={
          shiftPx > 0
            ? {
                ['--marquee-shift' as string]: `-${shiftPx}px`,
                animation: `monitoring-marquee ${durationSec}s linear infinite`
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  )
}

function EndpointStatus({
  label,
  host,
  result,
  checking,
  kind,
  averageLatencyMs,
  muted = false,
  serverVersion = null,
  serverVersionError = null
}: {
  label: string
  host: string
  result: MonitoringPingResult | undefined
  checking: boolean
  kind: 'link' | 'server'
  averageLatencyMs?: number | null
  muted?: boolean
  serverVersion?: string | null
  serverVersionError?: string | null
}) {
  const status = result?.status ?? 'unknown'
  const linkLatencyMs =
    kind === 'link' && !muted && status === 'online' ? (averageLatencyMs ?? result?.latencyMs ?? null) : null
  const showPing = linkLatencyMs !== null && linkLatencyMs !== undefined
  const serverNoReply = kind === 'server' && !muted && status === 'offline'
  const owlGuardFailed = kind === 'server' && !muted && status === 'error'
  const authOrVersionFailed = kind === 'server' && !muted && !!serverVersionError
  const serverWarning = owlGuardFailed || authOrVersionFailed
  const versionLabel = serverVersion ? formatServerVersionLabel(serverVersion) : null
  const detail =
    kind === 'link'
      ? status === 'online' && !muted && showPing
        ? formatLatency(linkLatencyMs)
        : linkConnectionText(status, checking)
      : muted
        ? versionLabel || host
        : serverNoReply
          ? 'нет ответа'
          : owlGuardFailed
            ? OWL_GUARD_UNREACHABLE
            : serverVersionError || versionLabel || host
  const statusClass = muted
    ? 'text-label-tertiary'
    : serverWarning
      ? 'text-amber-300'
      : statusClasses(status, checking)
  const detailClass = muted
    ? 'text-label-tertiary'
    : kind === 'link' && showPing
      ? latencyTextClasses(linkLatencyMs)
      : kind === 'link'
        ? checking || status === 'unknown' || status === 'offline'
          ? 'text-label-tertiary'
          : statusClass
        : serverNoReply
          ? statusClass
          : serverWarning
            ? 'text-amber-300'
            : 'text-label-tertiary'
  const detailTitle = serverNoReply
    ? `нет ответа · ${host}`
    : owlGuardFailed
      ? OWL_GUARD_UNREACHABLE
      : kind === 'server' && serverVersionError
        ? `${serverVersionError} · ${host}`
        : kind === 'server' && versionLabel
          ? `${versionLabel} · ${host}`
          : host
  const iconTitle = muted
    ? 'Связь недоступна'
    : serverNoReply
      ? 'нет ответа'
      : owlGuardFailed
        ? OWL_GUARD_UNREACHABLE
        : authOrVersionFailed
          ? serverVersionError
          : statusText(status, checking)

  return (
    <div className="min-h-[2.5rem] min-w-0 overflow-hidden">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center ${statusClass}`}
          title={iconTitle}
        >
          <EndpointIcon kind={kind} />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden pt-0.5">
          <p className={`m-0 text-[14px] leading-5 font-medium ${statusClass}`}>{label}</p>
          {serverWarning && !muted ? (
            <ScrollingLine
              text={detail}
              className={`text-[13px] leading-5 ${detailClass}`}
              title={detailTitle}
            />
          ) : (
            <p
              className={`mt-0.5 min-h-5 truncate text-[13px] leading-5 ${showPing ? 'font-mono' : ''} ${detailClass}`}
              title={detailTitle}
            >
              {detail}
            </p>
          )}
        </div>
      </div>
      {kind === 'link' && result?.error && !muted && (
        <p className="mt-2 pl-[3.25rem] text-[13px] leading-relaxed text-amber-300">{result.error}</p>
      )}
    </div>
  )
}

function MonitoringObjectCard({
  object,
  results,
  latencyHistory,
  checking,
  serverVersion,
  serverVersionError,
  camerasPreviewLoading,
  megaphonesStatusLoading,
  onEdit
}: {
  object: MonitoringObject
  results: ResultMap
  latencyHistory: LatencyHistoryMap
  checking: boolean
  serverVersion: string | null
  serverVersionError: string | null
  camerasPreviewLoading: boolean
  megaphonesStatusLoading: boolean
  onEdit: (id: string) => void
}) {
  const linkResult = results[targetId(object.id, 'link')]
  const serverResult = results[targetId(object.id, 'server')]
  const linkAverageLatencyMs = averageLatency(latencyHistory[targetId(object.id, 'link')])
  const linkOnline = isOnline(linkResult)
  const serverOnline = linkOnline && isOnline(serverResult)
  const camerasTotal = object.camerasTotal ?? object.cameraStreams?.length ?? 0
  const hasCameraOnline = object.camerasOnline !== undefined
  const awaitingFirstCameraPreview =
    linkOnline &&
    serverOnline &&
    camerasTotal > 0 &&
    !hasCameraOnline &&
    (camerasPreviewLoading || Boolean(object.cameraStreams?.length))
  const megaphonesTotal = object.megaphonesTotal ?? 0
  const hasMegaphoneOnline = object.megaphonesOnline !== undefined
  const awaitingFirstMegaphoneStatus =
    linkOnline &&
    serverOnline &&
    megaphonesTotal > 0 &&
    !hasMegaphoneOnline &&
    (megaphonesStatusLoading || object.megaphonesTotal !== undefined)

  return (
    <Card
      title={<ObjectCodeTitle code={object.code} />}
      action={
        <button
          type="button"
          onClick={() => onEdit(object.id)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-label-tertiary opacity-0 transition-[opacity,color] duration-150 hover:bg-white/[0.05] hover:text-label-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/45"
          aria-label="Настройки объекта"
        >
          <CogIcon />
        </button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch sm:gap-5">
        <div className="grid min-w-0 gap-3 overflow-hidden">
          <EndpointStatus
            label="Связь"
            host={object.linkHost}
            result={linkResult}
            checking={checking}
            kind="link"
            averageLatencyMs={linkAverageLatencyMs}
          />
          <EndpointStatus
            label="Сервер"
            host={object.serverHost}
            result={serverResult}
            checking={checking}
            kind="server"
            muted={!linkOnline}
            serverVersion={serverVersion}
            serverVersionError={linkOnline ? serverVersionError : null}
          />
        </div>

        <div className="flex shrink-0 flex-col justify-center border-t border-surface-border/70 pt-3 sm:min-w-[7.5rem] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <div className="mx-auto grid w-fit grid-cols-[1.75rem_auto] items-center gap-x-2.5 gap-y-3 sm:mx-0">
            <ObjectMetricStatus
              label="Камеры"
              online={hasCameraOnline ? object.camerasOnline! : null}
              total={camerasTotal}
              icon={<CamerasIcon />}
              muted={!serverOnline && !awaitingFirstCameraPreview}
              onlineUnknown={!linkOnline || (!hasCameraOnline && !awaitingFirstCameraPreview)}
              loading={awaitingFirstCameraPreview}
            />
            <ObjectMetricStatus
              label="Рупора"
              online={hasMegaphoneOnline ? object.megaphonesOnline! : null}
              total={megaphonesTotal}
              icon={<HornsIcon />}
              muted={!serverOnline && !awaitingFirstMegaphoneStatus}
              onlineUnknown={!linkOnline || (!hasMegaphoneOnline && !awaitingFirstMegaphoneStatus)}
              loading={awaitingFirstMegaphoneStatus}
            />
          </div>
        </div>
      </div>
    </Card>
  )
}

export function Monitoring() {
  const [snapshot, setSnapshot] = useState(() => loadMonitoringSnapshot())
  const [editor, setEditor] = useState<EditorState>(null)
  const [results, setResults] = useState<ResultMap>({})
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistoryMap>({})
  const [serverVersionErrors, setServerVersionErrors] = useState<VersionErrorMap>({})
  const [camerasPreviewLoading, setCamerasPreviewLoading] = useState<Record<string, boolean>>({})
  const [megaphonesStatusLoading, setMegaphonesStatusLoading] = useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const bootstrapInFlightRef = useRef(new Set<string>())
  const previewInFlightRef = useRef(new Set<string>())
  const megaphoneStatusInFlightRef = useRef(new Set<string>())
  const scheduleRef = useRef<Record<string, ObjectProbeSchedule>>({})
  const credentialKeyRef = useRef<Record<string, string>>({})
  const mountedRef = useRef(true)
  const snapshotRef = useRef(snapshot)
  const resultsRef = useRef(results)
  snapshotRef.current = snapshot
  resultsRef.current = results

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const getSchedule = useCallback((objectId: string): ObjectProbeSchedule => {
    const current = scheduleRef.current[objectId]
    if (current) return current
    const created = createProbeSchedule()
    scheduleRef.current[objectId] = created
    return created
  }, [])

  const editingObject = useMemo(
    () => (editor?.mode === 'edit' && editor.objectId ? snapshot.objects.find((object) => object.id === editor.objectId) ?? null : null),
    [editor, snapshot.objects]
  )

  useEffect(() => {
    saveMonitoringSnapshot(snapshot)
  }, [snapshot])

  const objectsKey = useMemo(
    () =>
      snapshot.objects
        .map(
          (object) =>
            `${object.id}|${object.linkHost}|${object.serverHost}|${object.serverLogin}|${object.serverPassword}`
        )
        .join(';'),
    [snapshot.objects]
  )

  const runBootstrap = useCallback(async (object: MonitoringObject, forceStreams = false): Promise<void> => {
    const fetchVersion = window.api?.monitoringFetchVersion
    const fetchStreams = window.api?.monitoringFetchStreams
    const fetchMegaphones = window.api?.monitoringFetchMegaphones
    if (
      typeof fetchVersion !== 'function' ||
      typeof fetchStreams !== 'function' ||
      typeof fetchMegaphones !== 'function'
    ) {
      setServerVersionErrors((prev) => ({
        ...prev,
        [object.id]: localizeMonitoringError('API недоступен — полностью перезапустите приложение')
      }))
      return
    }

    if (!object.serverPassword) {
      setServerVersionErrors((prev) => ({
        ...prev,
        [object.id]: localizeMonitoringError('Укажите пароль OWL.Guard в настройках объекта')
      }))
      return
    }

    if (bootstrapInFlightRef.current.has(object.id)) return
    bootstrapInFlightRef.current.add(object.id)

    const schedule = getSchedule(object.id)
    const auth = {
      id: object.id,
      host: object.serverHost,
      username: object.serverLogin,
      password: object.serverPassword
    }

    try {
      console.log('[monitoring] bootstrap start', object.id, object.serverHost)
      const now = Date.now()
      const needVersion = !object.serverVersion
      const needStreams =
        forceStreams ||
        !object.cameraStreams?.length ||
        (schedule.lastStreamsAt > 0 && now - schedule.lastStreamsAt >= MONITORING_STREAMS_REFRESH_MS)
      const needMegaphones =
        forceStreams ||
        object.megaphonesTotal === undefined ||
        (schedule.lastMegaphonesAt > 0 && now - schedule.lastMegaphonesAt >= MONITORING_STREAMS_REFRESH_MS)

      if (needVersion) {
        const versionResult = await fetchVersion(auth)
        if (!mountedRef.current) return

        if (!versionResult.ok || !versionResult.version) {
          setServerVersionErrors((prev) => ({
            ...prev,
            [object.id]: localizeMonitoringError(versionResult.error)
          }))
        } else {
          setServerVersionErrors((prev) => {
            if (!(object.id in prev)) return prev
            const next = { ...prev }
            delete next[object.id]
            return next
          })
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id ? { ...item, serverVersion: versionResult.version! } : item
            )
          }))
        }
      }

      if (needStreams) {
        const streamsResult = await fetchStreams(auth)
        if (!mountedRef.current) return

        if (!streamsResult.ok) {
          console.warn('[monitoring] streams failed', object.id, streamsResult.error)
        } else {
          setServerVersionErrors((prev) => {
            if (!(object.id in prev)) return prev
            const next = { ...prev }
            delete next[object.id]
            return next
          })
          schedule.lastStreamsAt = now
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id
                ? {
                    ...item,
                    cameraStreams: streamsResult.streams,
                    camerasTotal: streamsResult.streams.length
                  }
                : item
            )
          }))

          if (needVersion) {
            const latest = snapshotRef.current.objects.find((item) => item.id === object.id)
            if (!latest?.serverVersion) {
              const retryVersion = await fetchVersion(auth)
              if (mountedRef.current && retryVersion.ok && retryVersion.version) {
                setSnapshot((prev) => ({
                  objects: prev.objects.map((item) =>
                    item.id === object.id ? { ...item, serverVersion: retryVersion.version! } : item
                  )
                }))
              }
            }
          }
        }
      } else if (object.cameraStreams?.length && schedule.lastStreamsAt === 0) {
        schedule.lastStreamsAt = now
      }

      if (needMegaphones) {
        const megaphonesResult = await fetchMegaphones(auth)
        if (!mountedRef.current) return

        if (!megaphonesResult.ok) {
          console.warn('[monitoring] megaphones failed', object.id, megaphonesResult.error)
        } else {
          schedule.lastMegaphonesAt = now
          setSnapshot((prev) => ({
            objects: prev.objects.map((item) =>
              item.id === object.id
                ? {
                    ...item,
                    megaphonesTotal: megaphonesResult.count,
                    ...(megaphonesResult.count === 0 ? { megaphonesOnline: 0 } : {})
                  }
                : item
            )
          }))
        }
      } else if (object.megaphonesTotal !== undefined && schedule.lastMegaphonesAt === 0) {
        schedule.lastMegaphonesAt = now
      }

      schedule.bootstrapped = true
      if (schedule.nextPreviewAt === 0) schedule.nextPreviewAt = now
      if (schedule.nextMegaphoneStatusAt === 0) schedule.nextMegaphoneStatusAt = now
    } finally {
      bootstrapInFlightRef.current.delete(object.id)
    }
  }, [getSchedule])

  const refresh = useCallback(async () => {
    if (!snapshotRef.current.objects.length || refreshingRef.current) return

    refreshingRef.current = true
    setRefreshing(true)

    try {
      if (!window.api) return
      const now = Date.now()
      const objects = snapshotRef.current.objects

      // Drop schedules for removed objects.
      const liveIds = new Set(objects.map((object) => object.id))
      for (const id of Object.keys(scheduleRef.current)) {
        if (!liveIds.has(id)) delete scheduleRef.current[id]
      }

      const dueLinks = objects
        .filter((object) => getSchedule(object.id).nextLinkAt <= now)
        .sort((a, b) => getSchedule(a.id).nextLinkAt - getSchedule(b.id).nextLinkAt)
        .slice(0, MONITORING_MAX_LINK_BATCH)

      const mergedResults: ResultMap = { ...resultsRef.current }

      if (dueLinks.length) {
        const linkTargets: MonitoringPingTarget[] = dueLinks.map((object) => ({
          id: targetId(object.id, 'link'),
          label: `${object.code} связь`,
          host: object.linkHost
        }))

        const linkResults = await window.api.monitoringPing(linkTargets)
        const offlineServers: MonitoringPingResult[] = []

        linkResults.forEach((result) => {
          mergedResults[result.id] = result
          const objectId = result.id.replace(/:link$/, '')
          const object = objects.find((item) => item.id === objectId)
          const schedule = getSchedule(objectId)
          if (result.status === 'online') {
            schedule.linkFailures = 0
            schedule.nextLinkAt = now + successDelayMs(MONITORING_LINK_INTERVAL_MS)
            if (schedule.nextServerAt === 0 || schedule.nextServerAt > now + MONITORING_SERVER_INTERVAL_MS) {
              schedule.nextServerAt = now
            }
          } else {
            schedule.linkFailures += 1
            schedule.nextLinkAt = now + linkFailureBackoffMs(schedule.linkFailures)
            schedule.nextServerAt = Number.MAX_SAFE_INTEGER
            const serverResult: MonitoringPingResult = {
              id: targetId(objectId, 'server'),
              host: object?.serverHost ?? '',
              label: `${object?.code ?? ''} сервер`,
              status: 'offline',
              latencyMs: null,
              checkedAt: now
            }
            mergedResults[serverResult.id] = serverResult
            offlineServers.push(serverResult)
          }
        })

        setResults((prev) => {
          const next = { ...prev }
          linkResults.forEach((result) => {
            next[result.id] = result
          })
          offlineServers.forEach((result) => {
            next[result.id] = result
          })
          return next
        })
        setLatencyHistory((prev) => {
          let next = prev
          linkResults.forEach((result) => {
            if (result.status !== 'online' || result.latencyMs === null) return
            if (next === prev) next = { ...prev }
            next[result.id] = [...(next[result.id] ?? []), result.latencyMs].slice(-LINK_LATENCY_HISTORY_LIMIT)
          })
          return next
        })
      }

      const dueServers = objects
        .filter((object) => {
          const schedule = getSchedule(object.id)
          if (schedule.nextServerAt > now) return false
          return isOnline(mergedResults[targetId(object.id, 'link')])
        })
        .sort((a, b) => getSchedule(a.id).nextServerAt - getSchedule(b.id).nextServerAt)
        .slice(0, MONITORING_MAX_SERVER_BATCH)

      if (dueServers.length) {
        // ICMP first: host may be reachable while OWL.Guard HTTP is down.
        const serverPingTargets: MonitoringPingTarget[] = dueServers.map((object) => ({
          id: targetId(object.id, 'server'),
          label: `${object.code} сервер`,
          host: object.serverHost
        }))
        const serverPingResults = await window.api.monitoringPing(serverPingTargets)
        const pingOnlineServers = dueServers.filter((_, index) => serverPingResults[index]?.status === 'online')

        const httpTargets: MonitoringHttpTarget[] = pingOnlineServers.map((object) => ({
          id: targetId(object.id, 'server'),
          host: object.serverHost,
          label: `${object.code} сервер`
        }))

        const httpProbe = window.api.monitoringHttpProbe
        const httpProbeAvailable = typeof httpProbe === 'function'
        const httpResults: Array<{ id: string; ok: boolean }> =
          httpTargets.length && httpProbeAvailable
            ? await httpProbe(httpTargets)
            : httpTargets.map((target) => ({ id: target.id, ok: true }))
        const httpOkById = new Map<string, boolean>(httpResults.map((result) => [result.id, result.ok]))

        const serverResults: MonitoringPingResult[] = serverPingResults.map((pingResult, index) => {
          const object = dueServers[index]
          if (pingResult.status !== 'online') {
            return {
              id: pingResult.id,
              host: object.serverHost,
              label: `${object.code} сервер`,
              status: 'offline' as const,
              latencyMs: null,
              checkedAt: now
            }
          }

          if (!httpProbeAvailable) {
            return {
              id: pingResult.id,
              host: object.serverHost,
              label: `${object.code} сервер`,
              status: 'online' as const,
              latencyMs: pingResult.latencyMs,
              checkedAt: now
            }
          }

          const httpOk = httpOkById.get(pingResult.id) === true
          return {
            id: pingResult.id,
            host: object.serverHost,
            label: `${object.code} сервер`,
            status: (httpOk ? 'online' : 'error') as MonitoringPingStatus,
            latencyMs: pingResult.latencyMs,
            checkedAt: now,
            error: httpOk ? undefined : OWL_GUARD_UNREACHABLE
          }
        })

        setResults((prev) => {
          const next = { ...prev }
          serverResults.forEach((result) => {
            next[result.id] = result
          })
          return next
        })

        for (let index = 0; index < dueServers.length; index += 1) {
          const object = dueServers[index]
          const result = serverResults[index]
          const schedule = getSchedule(object.id)
          const credKey = versionFetchKey(object)
          if (credentialKeyRef.current[object.id] !== credKey) {
            credentialKeyRef.current[object.id] = credKey
            schedule.bootstrapped = false
            schedule.lastStreamsAt = 0
            schedule.lastMegaphonesAt = 0
            schedule.nextPreviewAt = 0
            schedule.nextMegaphoneStatusAt = 0
          }

          if (result.status === 'offline') {
            schedule.serverFailures += 1
            schedule.nextServerAt = now + failureBackoffMs(schedule.serverFailures, MONITORING_SERVER_INTERVAL_MS)
            continue
          }

          // Ping ok (OWL up or only HTTP down) — keep regular interval; no ICMP backoff.
          schedule.serverFailures = 0
          schedule.nextServerAt = now + successDelayMs(MONITORING_SERVER_INTERVAL_MS)

          if (result.status === 'online') {
            const streamsStale =
              schedule.lastStreamsAt > 0 && now - schedule.lastStreamsAt >= MONITORING_STREAMS_REFRESH_MS
            const megaphonesStale =
              schedule.lastMegaphonesAt > 0 && now - schedule.lastMegaphonesAt >= MONITORING_STREAMS_REFRESH_MS
            const needBootstrap =
              !schedule.bootstrapped ||
              streamsStale ||
              megaphonesStale ||
              !object.serverVersion ||
              object.megaphonesTotal === undefined
            if (needBootstrap) {
              void runBootstrap(object, streamsStale || megaphonesStale)
            }
          }
        }
      }
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [getSchedule, runBootstrap])

  useEffect(() => {
    if (!snapshot.objects.length) return

    let cancelled = false
    let timer: number | undefined

    const run = async (): Promise<void> => {
      await refresh()
      if (cancelled) return
      timer = window.setTimeout(run, MONITORING_TICK_MS)
    }

    void run()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refresh, objectsKey, snapshot.objects.length])

  useEffect(() => {
    const previewCameras = window.api?.monitoringPreviewCameras
    if (typeof previewCameras !== 'function') return

    const runPreviewTick = (): void => {
      const now = Date.now()
      const due = snapshotRef.current.objects
        .filter((object) => {
          if (previewInFlightRef.current.has(object.id)) return false
          if (!object.serverPassword) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'server')])) return false
          const streamIds = object.cameraStreams?.map((stream) => stream.id) ?? []
          if (!streamIds.length) return false
          const schedule = getSchedule(object.id)
          if (!schedule.bootstrapped) return false
          return schedule.nextPreviewAt <= now
        })
        .sort((a, b) => getSchedule(a.id).nextPreviewAt - getSchedule(b.id).nextPreviewAt)
        .slice(0, MONITORING_MAX_PREVIEW_BATCH)

      due.forEach((object) => {
        const streamIds = object.cameraStreams?.map((stream) => stream.id).filter((id) => Number.isFinite(id)) ?? []
        const schedule = getSchedule(object.id)
        const isFirstPreview = object.camerasOnline === undefined
        previewInFlightRef.current.add(object.id)
        // Reserve next slot immediately so the tick does not re-pick this object.
        schedule.nextPreviewAt = now + successDelayMs(MONITORING_PREVIEW_INTERVAL_MS)

        if (isFirstPreview) {
          setCamerasPreviewLoading((prev) => (prev[object.id] ? prev : { ...prev, [object.id]: true }))
        }

        console.log('[monitoring] preview cameras', object.id, streamIds.length)
        void previewCameras({
          id: object.id,
          host: object.serverHost,
          username: object.serverLogin,
          password: object.serverPassword,
          streamIds
        })
          .then((result) => {
            if (!mountedRef.current) return
            console.log('[monitoring] preview result', result)
            if (!result.ok) {
              schedule.previewFailures += 1
              schedule.nextPreviewAt = now + failureBackoffMs(schedule.previewFailures, MONITORING_PREVIEW_INTERVAL_MS)
              console.warn('[monitoring] preview failed', object.id, result.error)
              return
            }

            schedule.previewFailures = 0
            setSnapshot((prev) => {
              const current = prev.objects.find((item) => item.id === object.id)
              if (!current) return prev
              if (current.camerasOnline === result.onlineCount) return prev
              return {
                objects: prev.objects.map((item) =>
                  item.id === object.id ? { ...item, camerasOnline: result.onlineCount } : item
                )
              }
            })
          })
          .finally(() => {
            previewInFlightRef.current.delete(object.id)
            setCamerasPreviewLoading((prev) => {
              if (!(object.id in prev)) return prev
              const next = { ...prev }
              delete next[object.id]
              return next
            })
          })
      })
    }

    runPreviewTick()
    const timer = window.setInterval(runPreviewTick, MONITORING_TICK_MS)
    return () => window.clearInterval(timer)
  }, [getSchedule, objectsKey])

  useEffect(() => {
    const fetchMegaphoneStatuses = window.api?.monitoringFetchMegaphoneStatuses
    if (typeof fetchMegaphoneStatuses !== 'function') return

    const runMegaphoneStatusTick = (): void => {
      const now = Date.now()
      const due = snapshotRef.current.objects
        .filter((object) => {
          if (megaphoneStatusInFlightRef.current.has(object.id)) return false
          if (!object.serverPassword) return false
          if (!isOnline(resultsRef.current[targetId(object.id, 'server')])) return false
          if ((object.megaphonesTotal ?? 0) <= 0) return false
          const schedule = getSchedule(object.id)
          if (!schedule.bootstrapped) return false
          return schedule.nextMegaphoneStatusAt <= now
        })
        .sort((a, b) => getSchedule(a.id).nextMegaphoneStatusAt - getSchedule(b.id).nextMegaphoneStatusAt)
        .slice(0, MONITORING_MAX_PREVIEW_BATCH)

      due.forEach((object) => {
        const schedule = getSchedule(object.id)
        const isFirstStatus = object.megaphonesOnline === undefined
        megaphoneStatusInFlightRef.current.add(object.id)
        schedule.nextMegaphoneStatusAt = now + successDelayMs(MONITORING_PREVIEW_INTERVAL_MS)

        if (isFirstStatus) {
          setMegaphonesStatusLoading((prev) => (prev[object.id] ? prev : { ...prev, [object.id]: true }))
        }

        console.log('[monitoring] megaphone statuses', object.id)
        void fetchMegaphoneStatuses({
          id: object.id,
          host: object.serverHost,
          username: object.serverLogin,
          password: object.serverPassword
        })
          .then((result) => {
            if (!mountedRef.current) return
            console.log('[monitoring] megaphone statuses result', result)
            if (!result.ok) {
              schedule.megaphoneStatusFailures += 1
              schedule.nextMegaphoneStatusAt =
                now + failureBackoffMs(schedule.megaphoneStatusFailures, MONITORING_PREVIEW_INTERVAL_MS)
              console.warn('[monitoring] megaphone statuses failed', object.id, result.error)
              return
            }

            schedule.megaphoneStatusFailures = 0
            setSnapshot((prev) => {
              const current = prev.objects.find((item) => item.id === object.id)
              if (!current || current.megaphonesOnline === result.count) return prev
              return {
                objects: prev.objects.map((item) =>
                  item.id === object.id ? { ...item, megaphonesOnline: result.count } : item
                )
              }
            })
          })
          .finally(() => {
            megaphoneStatusInFlightRef.current.delete(object.id)
            setMegaphonesStatusLoading((prev) => {
              if (!(object.id in prev)) return prev
              const next = { ...prev }
              delete next[object.id]
              return next
            })
          })
      })
    }

    runMegaphoneStatusTick()
    const timer = window.setInterval(runMegaphoneStatusTick, MONITORING_TICK_MS)
    return () => window.clearInterval(timer)
  }, [getSchedule, objectsKey])

  const clearObjectResults = useCallback((id: string) => {
    setResults((prev) => {
      const next = { ...prev }
      delete next[targetId(id, 'link')]
      delete next[targetId(id, 'server')]
      return next
    })
    setLatencyHistory((prev) => {
      const next = { ...prev }
      delete next[targetId(id, 'link')]
      return next
    })
    setServerVersionErrors((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    delete scheduleRef.current[id]
    delete credentialKeyRef.current[id]
    bootstrapInFlightRef.current.delete(id)
    previewInFlightRef.current.delete(id)
    megaphoneStatusInFlightRef.current.delete(id)
    setCamerasPreviewLoading((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setMegaphonesStatusLoading((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const saveObject = useCallback(
    (next: MonitoringObject, originalId?: string): boolean => {
      const prev = snapshot
      let nextObjects: MonitoringObject[] | null = null

      if (originalId) {
        nextObjects = prev.objects.map((object) => {
          if (object.id !== originalId) return object
          const sameHost = object.serverHost === next.serverHost
          return {
            ...next,
            id: originalId,
            code: object.code,
            ...(sameHost && object.serverVersion ? { serverVersion: object.serverVersion } : {}),
            ...(sameHost && object.cameraStreams
              ? {
                  cameraStreams: object.cameraStreams,
                  camerasTotal: object.camerasTotal ?? object.cameraStreams.length,
                  ...(object.camerasOnline !== undefined ? { camerasOnline: object.camerasOnline } : {})
                }
              : {}),
            ...(sameHost && object.megaphonesTotal !== undefined
              ? {
                  megaphonesTotal: object.megaphonesTotal,
                  ...(object.megaphonesOnline !== undefined ? { megaphonesOnline: object.megaphonesOnline } : {})
                }
              : {})
          }
        })
      } else if (prev.objects.some((object) => object.id === next.id)) {
        return false
      } else {
        nextObjects = [...prev.objects, next]
      }

      setSnapshot({ objects: nextObjects })

      clearObjectResults(originalId ?? next.id)

      return true
    },
    [clearObjectResults, snapshot]
  )

  const deleteObject = useCallback(
    (objectId: string) => {
      setSnapshot((prev) => ({ objects: prev.objects.filter((object) => object.id !== objectId) }))
      clearObjectResults(objectId)
      setEditor((prev) => (prev?.mode === 'edit' && prev.objectId === objectId ? null : prev))
    },
    [clearObjectResults]
  )

  const openAddEditor = useCallback(() => {
    setEditor({ mode: 'add' })
  }, [])

  const openEditEditor = useCallback((objectId: string) => {
    setEditor({ mode: 'edit', objectId })
  }, [])

  const closeEditor = useCallback(() => {
    setEditor(null)
  }, [])

  return (
    <article className="max-w-[64rem] pb-12">
      <header className="mb-6">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h1 className="m-0 text-[1.75rem] font-semibold tracking-[-0.028em] leading-[1.2] text-label-primary">Мониторинг</h1>
          </div>
          <button
            type="button"
            onClick={openAddEditor}
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-tint-blue px-3 py-2 text-[13px] font-semibold tracking-tight text-white shadow-sm transition-colors duration-200 hover:bg-tint-blue-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-window"
          >
            Добавить объект
          </button>
        </div>
        <p className="text-[14px] leading-relaxed text-label-secondary">
          Для работы инструмента необходимо подключиться к VPN.
        </p>
      </header>

      <ObjectEditorModal
        editor={editor}
        object={editingObject}
        onClose={closeEditor}
        onSave={saveObject}
        onDelete={deleteObject}
      />

      {snapshot.objects.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {snapshot.objects.map((object) => (
            <MonitoringObjectCard
              key={object.id}
              object={object}
              results={results}
              latencyHistory={latencyHistory}
              checking={refreshing}
              serverVersion={object.serverVersion ?? null}
              serverVersionError={serverVersionErrors[object.id] ?? null}
              camerasPreviewLoading={Boolean(camerasPreviewLoading[object.id])}
              megaphonesStatusLoading={Boolean(megaphonesStatusLoading[object.id])}
              onEdit={openEditEditor}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[min(420px,calc(100vh-18rem))] items-center justify-center">
          <p className="text-center text-[15px] font-medium text-label-secondary">
            Нет объектов для отслеживания
          </p>
        </div>
      )}
    </article>
  )
}
