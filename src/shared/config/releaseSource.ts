import type { GitHubReleaseSettings } from '../../entities/knowledge/types'
import { getManifestAssetName } from '../lib/content/schema'

function trimOrEmpty(value: string | undefined) {
  return value?.trim() ?? ''
}

/** Источник GitHub Releases для обновлений и публикации; задаётся при сборке через Vite env. */
export function getReleaseSourceSettings(): GitHubReleaseSettings {
  const owner = trimOrEmpty(import.meta.env.VITE_GITHUB_OWNER)
  const repo = trimOrEmpty(import.meta.env.VITE_GITHUB_REPO)
  const assetName = trimOrEmpty(import.meta.env.VITE_RELEASE_ASSET_NAME)
  const fromEnvManifest = trimOrEmpty(
    import.meta.env.VITE_RELEASE_MANIFEST_ASSET_NAME,
  )
  const manifestAssetName =
    fromEnvManifest || (assetName ? getManifestAssetName(assetName) : '')

  return {
    owner,
    repo,
    assetName,
    manifestAssetName,
  }
}

export function isReleaseSourceConfigured(
  settings: GitHubReleaseSettings = getReleaseSourceSettings(),
) {
  return Boolean(
    settings.owner && settings.repo && settings.assetName.trim(),
  )
}

export const RELEASE_SOURCE_NOT_CONFIGURED_MESSAGE =
  'Источник обновлений не задан: при сборке нужно указать VITE_GITHUB_OWNER, VITE_GITHUB_REPO и VITE_RELEASE_ASSET_NAME (см. .env.example).'
