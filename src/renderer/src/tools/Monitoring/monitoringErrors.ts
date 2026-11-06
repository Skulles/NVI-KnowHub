export function isCredentialAuthError(message: string | undefined): boolean {
  const lower = (message ?? '').toLowerCase()
  return (
    lower.includes('invalid user credentials') ||
    lower.includes('invalid_grant') ||
    lower.includes('unauthorized_client') ||
    lower.includes('unauthorized') ||
    /^http\s*401\b/i.test(message ?? '') ||
    lower.includes('account disabled') ||
    lower.includes('user disabled') ||
    lower.includes('account is not fully set up')
  )
}

export function localizeMonitoringError(message: string | undefined): string {
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
  if (lower.includes('api недоступен') || lower.includes('укажите пароль')) {
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
  if (/^http\s*403\b/i.test(raw)) return 'Доступ запрещён'
  if (/^http\s*404\b/i.test(raw)) return 'Эндпоинт версии не найден'
  if (/^http\s*\d+/i.test(raw)) {
    return `Ошибка сервера (${raw.replace(/^http\s*/i, 'HTTP ')})`
  }

  return raw
}
