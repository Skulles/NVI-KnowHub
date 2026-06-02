import React, { useState } from 'react'
import { api } from '../api'

interface Props {
  onLoggedIn: () => void
}

export function LoginScreen({ onLoggedIn }: Props): React.ReactElement {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.login(username.trim(), password)
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-surface-window text-label-primary flex items-center justify-center px-6">
      <div className="pointer-events-none absolute inset-0 bg-[var(--page-glow)]" aria-hidden />
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="relative z-[1] admin-card w-full max-w-sm px-8 py-10"
      >
        <h1 className="text-[17px] font-semibold text-label-primary tracking-tight text-center">
          NVI KnowHub
        </h1>
        <p className="mt-1 text-[13px] text-label-secondary text-center">Админ-панель</p>

        <label className="mt-8 block">
          <span className="text-[12px] font-medium text-label-secondary">Логин</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-surface-border bg-surface-input px-3 py-2 text-[14px] text-label-primary outline-none focus:border-tint-blue/50 focus:shadow-focus"
            disabled={loading}
          />
        </label>

        <label className="mt-4 block">
          <span className="text-[12px] font-medium text-label-secondary">Пароль</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-surface-border bg-surface-input px-3 py-2 text-[14px] text-label-primary outline-none focus:border-tint-blue/50 focus:shadow-focus"
            disabled={loading}
            required
          />
        </label>

        {error ? (
          <p className="mt-4 text-[13px] text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading || !password}
          className="admin-btn-primary w-full mt-6 disabled:opacity-50"
        >
          {loading ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
