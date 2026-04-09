/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_OWNER: string
  readonly VITE_GITHUB_REPO: string
  readonly VITE_RELEASE_ASSET_NAME: string
  readonly VITE_RELEASE_MANIFEST_ASSET_NAME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
