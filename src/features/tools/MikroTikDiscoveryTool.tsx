import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getDesktopMacTelnet,
  getDesktopMikroTikDiscovery,
  type MacTelnetEvent,
  type MacTelnetPhase,
  type MikroTikDiscoveredDevice,
  type MikroTikDiscoverySnapshot,
} from '../../shared/lib/platform/desktopBridge'

const EMPTY_SNAPSHOT: MikroTikDiscoverySnapshot = {
  status: 'idle',
  lastError: null,
  devices: [],
}

const RB912R_IMAGE_URL = `${import.meta.env.BASE_URL}mikrotik-rb912r.png`

function deviceDisplayName(device: MikroTikDiscoveredDevice) {
  return device.identity ?? device.board ?? device.platform ?? device.mac ?? 'MikroTik'
}

function devicePrimaryAddress(device: MikroTikDiscoveredDevice) {
  return device.ipv4 ?? device.address ?? device.ipv6 ?? '—'
}

function formatVersion(version: string | null) {
  if (!version) {
    return '—'
  }

  const trimmed = version.trim()
  const withoutIsoDate = trimmed.replace(/\s+\d{4}[-/.]\d{1,2}[-/.]\d{1,2}.*$/i, '')
  const withoutNamedDate = withoutIsoDate.replace(
    /\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\/\-\s]+\d{1,2}[\/\-\s]+\d{2,4}.*$/i,
    '',
  )
  return withoutNamedDate.trim() || trimmed
}

function isSupportedMikroTikDevice(device: MikroTikDiscoveredDevice) {
  const board = device.board?.trim()
  const platform = device.platform?.trim().toLowerCase()
  return Boolean(board) && platform === 'mikrotik'
}

function boardImageUrl(device: MikroTikDiscoveredDevice) {
  const board = device.board?.trim().toUpperCase()
  if (!board) {
    return null
  }
  if (board.includes('RB912R')) {
    return RB912R_IMAGE_URL
  }
  return null
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function phaseCaption(phase: MacTelnetPhase) {
  switch (phase) {
    case 'idle':
      return 'Готово к подключению'
    case 'discovering':
      return 'Поиск устройства по сети…'
    case 'authenticating':
      return 'Авторизация…'
    case 'connected':
      return 'Подключено'
    case 'closed':
      return 'Сессия закрыта'
    default:
      return phase
  }
}

type ConnectionState = {
  sessionId: number | null
  phase: MacTelnetPhase
  error: string | null
  authMode: 'md5' | 'ec-srp' | null
  iface: string | null
}

type ConnectMode = 'auto-default' | 'manual'

const INSPECT_COMMAND = [
  ':put "NVI KnowHub MAC-Telnet OK"',
  '/system identity print',
  '/system resource print',
  '/system routerboard print',
  '/quit',
].join('\r\n') + '\r\n'

const PROMPT_PATTERN = /\[[^\]]+\]\s*>\s*$/
const DEFAULT_PASSWORD_HELP =
  'Авторизация не удалась. Убедитесь, что устройство сброшено на заводские настройки. Если на нём есть наклейка с указанным на ней паролем, введите его.'

function sanitizeMacTelnetText(text: string) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/g, '')
}

const INITIAL_CONNECTION_STATE: ConnectionState = {
  sessionId: null,
  phase: 'idle',
  error: null,
  authMode: null,
  iface: null,
}

export function MikroTikDiscoveryTool() {
  const isDesktop = Boolean(window.electronShell?.isDesktop)
  const desktopApi = getDesktopMikroTikDiscovery()
  const macTelnet = getDesktopMacTelnet()
  const [snapshot, setSnapshot] = useState<MikroTikDiscoverySnapshot>(EMPTY_SNAPSHOT)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [connection, setConnection] = useState<ConnectionState>(INITIAL_CONNECTION_STATE)
  const [verificationOutput, setVerificationOutput] = useState('')
  const [showLoginForm, setShowLoginForm] = useState(false)
  const [loginHelp, setLoginHelp] = useState<string | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const inspectRequestedRef = useRef(false)
  const inspectTimerRef = useRef<number | null>(null)
  const outputBufferRef = useRef('')
  const attemptedDefaultAuthRef = useRef(false)
  const connectModeRef = useRef<ConnectMode>('manual')
  const readyForCommandsRef = useRef(false)
  const textDecoderRef = useRef(new TextDecoder())

  const clearInspectTimer = useCallback(() => {
    if (inspectTimerRef.current != null) {
      window.clearTimeout(inspectTimerRef.current)
      inspectTimerRef.current = null
    }
  }, [])

  const triggerInspect = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (!macTelnet || sessionId == null || inspectRequestedRef.current) return
    readyForCommandsRef.current = true
    inspectRequestedRef.current = true
    clearInspectTimer()
    void macTelnet.sendInput({
      sessionId,
      data: bytesToBase64(new TextEncoder().encode(INSPECT_COMMAND)),
    })
  }, [clearInspectTimer, macTelnet])

  useEffect(() => {
    if (!isDesktop || !desktopApi) {
      setSnapshot(EMPTY_SNAPSHOT)
      return
    }

    const unsubscribe = desktopApi.onSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })

    void desktopApi.getSnapshot().then(setSnapshot)
    void desktopApi.start().then(setSnapshot)

    return () => {
      unsubscribe()
      void desktopApi.stop()
    }
  }, [desktopApi, isDesktop])

  useEffect(() => {
    if (!selectedDeviceId) {
      return
    }
    const stillExists = snapshot.devices.some(
      (device) => device.id === selectedDeviceId && isSupportedMikroTikDevice(device),
    )
    if (!stillExists) {
      setSelectedDeviceId(null)
    }
  }, [selectedDeviceId, snapshot.devices])

  const visibleDevices = useMemo(
    () => snapshot.devices.filter(isSupportedMikroTikDevice),
    [snapshot.devices],
  )

  const selectedDevice = useMemo(
    () => visibleDevices.find((device) => device.id === selectedDeviceId) ?? null,
    [selectedDeviceId, visibleDevices],
  )

  useEffect(() => {
    return () => {
      clearInspectTimer()
      if (sessionIdRef.current != null && macTelnet) {
        void macTelnet.disconnect({ sessionId: sessionIdRef.current })
      }
      sessionIdRef.current = null
    }
  }, [macTelnet])

  useEffect(() => {
    if (!macTelnet) return
    const offData = macTelnet.onData(({ sessionId, data }) => {
      if (sessionId !== sessionIdRef.current) return
      const bytes = base64ToBytes(data)
      const text = sanitizeMacTelnetText(textDecoderRef.current.decode(bytes, { stream: true }))
      if (!text) return
      outputBufferRef.current = `${outputBufferRef.current}${text}`.slice(-4096)
      setVerificationOutput((prev) => prev + text)
      if (
        connectModeRef.current === 'auto-default' &&
        !readyForCommandsRef.current &&
        /login failed|incorrect username or password/i.test(outputBufferRef.current)
      ) {
        setShowLoginForm(true)
        setLoginHelp(DEFAULT_PASSWORD_HELP)
      }
      if (!inspectRequestedRef.current && PROMPT_PATTERN.test(outputBufferRef.current.trimEnd())) {
        triggerInspect()
      }
    })
    const offEvent = macTelnet.onEvent(({ sessionId, event }) => {
      if (sessionId !== sessionIdRef.current) return
      applyEvent(event)
    })
    return () => {
      offData()
      offEvent()
    }
    function applyEvent(event: MacTelnetEvent) {
      setConnection((prev) => {
        if (event.type === 'phase') {
          const phase = (event as { phase: MacTelnetPhase }).phase
          const authMode = (event as { authMode?: 'md5' | 'ec-srp' }).authMode ?? prev.authMode
          if (phase === 'closed') {
            sessionIdRef.current = null
            inspectRequestedRef.current = false
            clearInspectTimer()
            if (
              connectModeRef.current === 'auto-default' &&
              !readyForCommandsRef.current
            ) {
              setShowLoginForm(true)
              setLoginHelp(DEFAULT_PASSWORD_HELP)
            }
            return { ...prev, phase, sessionId: null, authMode }
          }
          return { ...prev, phase, authMode }
        }
        if (event.type === 'error') {
          const message = (event as { message?: string }).message ?? 'Неизвестная ошибка'
          if (
            connectModeRef.current === 'auto-default' &&
            !readyForCommandsRef.current
          ) {
            setShowLoginForm(true)
            setLoginHelp(DEFAULT_PASSWORD_HELP)
          }
          return { ...prev, error: message }
        }
        if (event.type === 'interface-use') {
          return { ...prev, iface: (event as { interface: string }).interface }
        }
        return prev
      })
    }
  }, [clearInspectTimer, macTelnet, triggerInspect])

  useEffect(() => {
    if (!macTelnet) return
    if (connection.phase !== 'connected') return
    if (sessionIdRef.current == null) return
    if (inspectRequestedRef.current) return

    // RouterOS sometimes prints the banner first and only shows the prompt after
    // an extra Enter. Nudge it once, then wait for the actual prompt in onData().
    inspectTimerRef.current = window.setTimeout(() => {
      const sessionId = sessionIdRef.current
      if (!macTelnet || sessionId == null) return
      void macTelnet.sendInput({
        sessionId,
        data: bytesToBase64(new TextEncoder().encode('\r')),
      })
      inspectTimerRef.current = null
    }, 1200)
  }, [connection.phase, macTelnet])

  const connect = useCallback(async (options?: {
    username?: string
    password?: string
    mode?: ConnectMode
  }) => {
    if (!macTelnet || !selectedDevice?.mac) return
    clearInspectTimer()
    const nextUsername = options?.username ?? username
    const nextPassword = options?.password ?? password
    const mode = options?.mode ?? 'manual'
    connectModeRef.current = mode
    readyForCommandsRef.current = false
    inspectRequestedRef.current = false
    outputBufferRef.current = ''
    if (mode === 'auto-default') {
      setShowLoginForm(false)
      setLoginHelp(null)
      attemptedDefaultAuthRef.current = true
    }
    setVerificationOutput(`Соединение с ${selectedDevice.mac} (${deviceDisplayName(selectedDevice)})...\n`)
    setConnection({ ...INITIAL_CONNECTION_STATE, phase: 'discovering' })

    try {
      const { sessionId } = await macTelnet.connect({
        dstMac: selectedDevice.mac,
        username: nextUsername,
        password: nextPassword,
        cols: 120,
        rows: 40,
        term: 'dumb',
      })
      sessionIdRef.current = sessionId
      setConnection((prev) => ({ ...prev, sessionId }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (mode === 'auto-default') {
        setShowLoginForm(true)
        setLoginHelp(DEFAULT_PASSWORD_HELP)
      }
      setConnection((prev) => ({ ...prev, phase: 'closed', error: message }))
      setVerificationOutput((prev) => `${prev}\nОшибка подключения: ${message}\n`)
    }
  }, [clearInspectTimer, macTelnet, password, selectedDevice, username])

  const disconnect = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (sessionId != null && macTelnet) {
      await macTelnet.disconnect({ sessionId })
    }
    sessionIdRef.current = null
    inspectRequestedRef.current = false
    clearInspectTimer()
    setConnection((prev) => ({ ...prev, phase: 'closed', sessionId: null }))
  }, [clearInspectTimer, macTelnet])

  // Reset auth form whenever the selected device changes so credentials from a
  // previous attempt do not leak into the new session.
  useEffect(() => {
    setConnection(INITIAL_CONNECTION_STATE)
    setVerificationOutput('')
    setShowLoginForm(false)
    setLoginHelp(null)
    inspectRequestedRef.current = false
    attemptedDefaultAuthRef.current = false
    connectModeRef.current = 'manual'
    readyForCommandsRef.current = false
    outputBufferRef.current = ''
    clearInspectTimer()
    if (sessionIdRef.current != null && macTelnet) {
      void macTelnet.disconnect({ sessionId: sessionIdRef.current })
      sessionIdRef.current = null
    }
  }, [clearInspectTimer, macTelnet, selectedDeviceId])

  useEffect(() => {
    if (!selectedDevice || !macTelnet) return
    if (attemptedDefaultAuthRef.current) return
    if (showLoginForm) return
    if (connection.phase !== 'idle') return

    void connect({
      username: 'admin',
      password: '',
      mode: 'auto-default',
    })
  }, [connect, connection.phase, macTelnet, selectedDevice, showLoginForm])

  const connectBusy =
    connection.phase === 'discovering' ||
    connection.phase === 'authenticating' ||
    connection.phase === 'connected'

  return (
    <article className="tool-page tool-page--mikrotik">
      <header className="tool-page__header">
        <h1 className="tool-page__title">Помощник настройки MikroTik</h1>
        <p className="tool-page__lead">
          Инструмент слушает MNDP в desktop-приложении, показывает найденные устройства MikroTik
          и позволяет подключиться к устройству через MAC-Telnet даже если у него ещё нет IP-адреса.
        </p>
      </header>

      {!isDesktop || !desktopApi ? (
        <section className="mikrotik-tool__notice" role="status">
          <h2>Поиск доступен только в desktop-версии</h2>
          <p>
            Прослушивание MNDP и MAC-Telnet используют UDP через Electron main process, поэтому в
            браузере этот инструмент работает только как заглушка.
          </p>
        </section>
      ) : (
        <div className="mikrotik-tool__layout">
          <div className="mikrotik-tool__content">
            {snapshot.status === 'error' && snapshot.lastError ? (
              <div className="mikrotik-tool__inline-error" role="status">
                <p>
                  Не удалось запустить прослушивание MNDP: <strong>{snapshot.lastError}</strong>
                </p>
              </div>
            ) : null}

            {visibleDevices.length === 0 ? (
              <div className="mikrotik-tool__search-loader" role="status" aria-live="polite">
                <div aria-hidden className="mikrotik-tool__spinner-wrap">
                  <div className="mikrotik-tool__spinner" />
                </div>
                <p className="mikrotik-tool__search-caption">
                  Поиск устройств MikroTik в локальной сети…
                </p>
              </div>
            ) : (
              <ul className="mikrotik-tool__device-list">
                {visibleDevices.map((device) => {
                  const isSelected = device.id === selectedDeviceId
                  const imageUrl = boardImageUrl(device)

                  return (
                    <li key={device.id}>
                      <button
                        aria-pressed={isSelected}
                        className={
                          isSelected
                            ? 'mikrotik-tool__device-button mikrotik-tool__device-button--selected'
                            : 'mikrotik-tool__device-button'
                        }
                        type="button"
                        onClick={() => setSelectedDeviceId(device.id)}
                      >
                        <div className="mikrotik-tool__device-image" aria-hidden="true">
                          {imageUrl ? (
                            <img
                              alt=""
                              className="mikrotik-tool__device-image-img"
                              src={imageUrl}
                            />
                          ) : (
                            <span>{device.board?.trim() || 'MikroTik'}</span>
                          )}
                        </div>

                        <div className="mikrotik-tool__device-body">
                          <div className="mikrotik-tool__device-head">
                            <div className="mikrotik-tool__device-title-row">
                              <h3>{device.identity?.trim() || '—'}</h3>
                              <span className="mikrotik-tool__device-board-inline">
                                - {device.board?.trim() || '—'}
                              </span>
                            </div>
                            <span className="mikrotik-tool__device-ip">
                              IP: {devicePrimaryAddress(device)}
                            </span>
                          </div>

                          <dl className="mikrotik-tool__device-fields">
                            <div className="mikrotik-tool__device-field">
                              <dt>MAC</dt>
                              <dd>{device.mac?.trim() || '—'}</dd>
                            </div>
                            <div className="mikrotik-tool__device-field">
                              <dt>Версия ПО</dt>
                              <dd>{formatVersion(device.version)}</dd>
                            </div>
                          </dl>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {selectedDevice ? (
              <aside className="mikrotik-tool__card">
                <h2 className="mikrotik-tool__section-title">Проверка через MAC-Telnet</h2>
                <p className="mikrotik-tool__selected-text">
                  Выбрано устройство <strong>{deviceDisplayName(selectedDevice)}</strong> ({
                    selectedDevice.mac ?? devicePrimaryAddress(selectedDevice)
                  }).
                </p>
                {!macTelnet ? (
                  <p className="mikrotik-tool__selected-text">
                    MAC-Telnet недоступен в этой сборке.
                  </p>
                ) : (
                  <>
                    {showLoginForm ? (
                      <form
                        className="mikrotik-tool__login-form"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void connect({ mode: 'manual' })
                        }}
                      >
                        {loginHelp ? (
                          <p className="mikrotik-tool__login-help">{loginHelp}</p>
                        ) : null}
                        <label>
                          Имя пользователя
                          <input
                            autoComplete="off"
                            disabled={connectBusy}
                            onChange={(event) => setUsername(event.target.value)}
                            type="text"
                            value={username}
                          />
                        </label>
                        <label>
                          Пароль
                          <input
                            autoComplete="off"
                            disabled={connectBusy}
                            onChange={(event) => setPassword(event.target.value)}
                            type="password"
                            value={password}
                          />
                        </label>

                        <div className="mikrotik-tool__login-actions">
                          {connection.phase === 'connected' ||
                          connection.phase === 'authenticating' ||
                          connection.phase === 'discovering' ? (
                            <button
                              className="mikrotik-tool__secondary-btn"
                              type="button"
                              onClick={() => {
                                void disconnect()
                              }}
                            >
                              Отключиться
                            </button>
                          ) : null}
                          <button
                            className="mikrotik-tool__primary-btn"
                            disabled={connectBusy}
                            type="submit"
                          >
                            Подключиться
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p className="mikrotik-tool__selected-text">
                        Пробуем подключиться со стандартным пользователем <strong>admin</strong> и
                        пустым паролем.
                      </p>
                    )}

                    <div className="mikrotik-tool__result-wrap">
                      <div className="mikrotik-tool__terminal-status">
                        <span
                          className={
                            connection.phase === 'connected'
                              ? 'mikrotik-tool__terminal-dot mikrotik-tool__terminal-dot--connected'
                              : connection.error
                                ? 'mikrotik-tool__terminal-dot mikrotik-tool__terminal-dot--error'
                                : 'mikrotik-tool__terminal-dot'
                          }
                        />
                        <span>{phaseCaption(connection.phase)}</span>
                        {connection.authMode ? (
                          <span>
                            · Авторизация: <strong>{connection.authMode.toUpperCase()}</strong>
                          </span>
                        ) : null}
                        {connection.iface ? (
                          <span>
                            · Интерфейс: <strong>{connection.iface}</strong>
                          </span>
                        ) : null}
                      </div>
                      {connection.error ? (
                        <div className="mikrotik-tool__terminal-inline-error">
                          Ошибка: {connection.error}
                        </div>
                      ) : null}
                      <p className="mikrotik-tool__result-caption">
                        После успешного входа приложение автоматически запрашивает краткую
                        информацию об устройстве.
                      </p>
                      <pre className="mikrotik-tool__result-output">
                        {verificationOutput || 'Результат проверки появится здесь.'}
                      </pre>
                    </div>
                  </>
                )}
              </aside>
            ) : null}
          </div>
        </div>
      )}
    </article>
  )
}
