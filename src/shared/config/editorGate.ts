/** Секрет включения режима редактора (задаётся при сборке, попадает в бандл). */
export function getEditorUnlockToken(): string {
  const raw = import.meta.env.VITE_EDITOR_TOKEN
  return typeof raw === 'string' ? raw.trim() : ''
}

export function isEditorUnlockConfigured(): boolean {
  return getEditorUnlockToken().length > 0
}
