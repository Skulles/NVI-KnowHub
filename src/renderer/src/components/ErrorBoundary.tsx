import React from 'react'

interface Props {
  children: React.ReactNode
  fallbackTitle?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children

    const title = this.props.fallbackTitle ?? 'Что-то пошло не так'

    return (
      <div className="flex min-h-[min(360px,calc(100vh-13rem))] flex-col items-center justify-center px-6 text-center">
        <p className="text-lg font-semibold text-label-primary">{title}</p>
        <p className="mt-2 max-w-md text-[15px] text-label-secondary">
          Интерфейс восстановится после перезагрузки раздела. Если ошибка повторяется, перезапустите приложение.
        </p>
        <button
          type="button"
          className="mt-6 rounded-xl bg-tint-blue px-4 py-2 text-[14px] font-medium text-white hover:bg-tint-blue-hover"
          onClick={this.handleRetry}
        >
          Попробовать снова
        </button>
      </div>
    )
  }
}
