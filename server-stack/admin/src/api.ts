import { clearAuthToken, getAuthToken, setAuthToken } from './auth-storage'

/** Vite base is `{BASE_PATH}/admin/`; API lives one level up. */
const BASE = import.meta.env.BASE_URL.replace(/\/admin\/?$/, '').replace(/\/$/, '')

export type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAuthToken()
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) return data.error
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/session') {
    clearAuthToken()
    onUnauthorized?.()
  }
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json() as Promise<T>
}

export interface SessionInfo {
  authenticated: boolean
  authRequired: boolean
  username?: string
}

export interface LoginResult {
  token: string
  expiresAt: number
  username: string
}

export interface ArticleMeta {
  id: string
  title: string
  updatedAt: string
  published: boolean
  publishedAt: string | null
  hasUnpublishedChanges: boolean
  htmlFile: string
  sectionId: string
  subsectionId: string
}

export interface ArticleDraft {
  id: string
  title: string
  lead: string
  blocks: unknown[]
  sectionId: string
  sectionTitle: string
  sectionIcon: string
  subsectionId: string
  subsectionTitle: string
  htmlFile: string
  published: boolean
  publishedAt: string | null
  updatedAt: string
  hasUnpublishedChanges: boolean
}

export interface SaveArticleResult {
  id: string
  htmlFile: string
  published: boolean
  publishedAt: string | null
  updatedAt: string
  hasUnpublishedChanges: boolean
}

export interface ManifestItem {
  id: string
  title: string
  type: 'article' | 'tool'
  htmlFile?: string
  toolId?: string
  version: number
}

export interface Subsection {
  id: string
  title: string
  items: ManifestItem[]
}

export interface Section {
  id: string
  title: string
  icon?: string
  items?: ManifestItem[]
  subsections?: Subsection[]
}

export interface Manifest {
  version: number
  sections: Section[]
}

export interface SectionTarget {
  sectionId: string
  sectionTitle: string
  sectionIcon: string
  subsectionId?: string
  subsectionTitle?: string
}

export interface PublishArticleResult {
  ok: boolean
  htmlFile: string
  published: boolean
  publishedAt: string
  updatedAt: string
  hasUnpublishedChanges: boolean
}

export const api = {
  getSession: () => request<SessionInfo>('GET', '/api/auth/session'),
  login: async (username: string, password: string) => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    if (!res.ok) throw new Error(await parseError(res))
    const data = (await res.json()) as LoginResult
    setAuthToken(data.token)
    return data
  },
  logout: async () => {
    try {
      await request<{ ok: boolean }>('POST', '/api/auth/logout', {})
    } finally {
      clearAuthToken()
    }
  },
  listArticles: () => request<ArticleMeta[]>('GET', '/api/articles'),
  getArticle: (id: string) => request<ArticleDraft>('GET', `/api/articles/${id}`),
  saveArticle: (draft: {
    id?: string | null
    title: string
    lead?: string
    blocks: unknown[]
    sectionId?: string
    sectionTitle?: string
    sectionIcon?: string
    subsectionId?: string
    subsectionTitle?: string
  }) => request<SaveArticleResult>('POST', '/api/articles', draft),
  publishArticle: (id: string) =>
    request<PublishArticleResult>('POST', `/api/articles/${id}/publish`, {}),
  deleteArticle: (id: string) => request<{ ok: boolean }>('DELETE', `/api/articles/${id}`),
  getManifest: () => request<Manifest>('GET', '/api/manifest'),
  updateManifest: (manifest: Manifest) => request<{ ok: boolean }>('PUT', '/api/manifest', manifest)
}
