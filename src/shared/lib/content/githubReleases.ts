import type { GitHubReleaseSettings } from '../../../entities/knowledge/types'
import type { PlatformBridge } from '../platform'

type ReleaseAsset = {
  id: number
  name: string
  browser_download_url: string
}

type GitHubRelease = {
  id: number
  tag_name: string
  html_url: string
  upload_url: string
  assets: ReleaseAsset[]
  published_at?: string
}

function withAuthHeaders(token: string, headers: Record<string, string> = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...headers,
  }
}

function apiBase(settings: GitHubReleaseSettings) {
  return `https://api.github.com/repos/${settings.owner}/${settings.repo}`
}

export async function fetchLatestRelease(
  bridge: PlatformBridge,
  settings: GitHubReleaseSettings,
) {
  return bridge.requestJson<GitHubRelease>(
    `${apiBase(settings)}/releases/latest`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
}

async function getReleaseByTag(
  bridge: PlatformBridge,
  settings: GitHubReleaseSettings,
  tag: string,
  token: string,
) {
  try {
    return await bridge.requestJson<GitHubRelease>(
      `${apiBase(settings)}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: withAuthHeaders(token),
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('404')) {
      return null
    }
    throw error
  }
}

const RELEASE_422_HINT =
  'Если репозиторий пустой (нет ни одного коммита), GitHub не может создать тег для релиза. Добавьте любой файл (например README.md), сделайте commit и push в основную ветку (обычно main или master), затем повторите публикацию.'

async function createRelease(
  bridge: PlatformBridge,
  settings: GitHubReleaseSettings,
  tag: string,
  releaseNotes: string | undefined,
  token: string,
) {
  try {
    return await bridge.requestJson<GitHubRelease>(
      `${apiBase(settings)}/releases`,
      {
        method: 'POST',
        headers: withAuthHeaders(token, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          tag_name: tag,
          name: tag,
          body: releaseNotes?.trim() || `Snapshot ${tag}`,
          draft: false,
          prerelease: false,
        }),
      },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('HTTP 422')) {
      throw new Error(`${msg}\n\n${RELEASE_422_HINT}`)
    }
    throw error
  }
}

export async function getOrCreateRelease(
  bridge: PlatformBridge,
  settings: GitHubReleaseSettings,
  tag: string,
  releaseNotes: string | undefined,
  token: string,
) {
  const existing = await getReleaseByTag(bridge, settings, tag, token)
  if (existing) {
    return existing
  }

  return createRelease(bridge, settings, tag, releaseNotes, token)
}

export async function deleteReleaseAsset(
  bridge: PlatformBridge,
  settings: GitHubReleaseSettings,
  assetId: number,
  token: string,
) {
  await bridge.requestJson(
    `${apiBase(settings)}/releases/assets/${assetId}`,
    {
      method: 'DELETE',
      headers: withAuthHeaders(token),
    },
  )
}

export async function uploadReleaseAsset(
  bridge: PlatformBridge,
  release: GitHubRelease,
  name: string,
  bytes: Uint8Array,
  token: string,
  contentType: string,
) {
  const uploadBase = release.upload_url.replace('{?name,label}', '')
  const url = `${uploadBase}?name=${encodeURIComponent(name)}`

  return bridge.uploadBinary(url, bytes, {
    headers: withAuthHeaders(token, {
      'Content-Type': contentType,
    }),
  })
}
