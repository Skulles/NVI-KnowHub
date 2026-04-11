/** Сеть недоступна или запрос не дошёл до сервера (Electron IPC, офлайн и т.п.). */
export const NETWORK_FETCH_FAILED_MESSAGE =
  'Не удалось загрузить данные. Проверьте подключение к интернету.'

/** Сообщение для пользователя из неуспешного ответа (в т.ч. JSON GitHub API). */
export function formatFailedFetchError(
  status: number,
  url: string,
  bodyText: string,
): string {
  const t = bodyText.trim()
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as {
        message?: string
        errors?: Array<{ message?: string }>
      }
      const segments: string[] = []
      if (j.message) {
        segments.push(j.message)
      }
      if (Array.isArray(j.errors)) {
        for (const e of j.errors) {
          if (e?.message) {
            segments.push(e.message)
          }
        }
      }
      if (segments.length > 0) {
        return `HTTP ${status}: ${segments.join(' — ')}`
      }
    } catch {
      /* сырой текст ниже */
    }
  }
  return t ? `HTTP ${status}: ${t.slice(0, 800)}` : `HTTP ${status}: ${url}`
}
