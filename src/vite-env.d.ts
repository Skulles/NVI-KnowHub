/// <reference types="vite/client" />

interface Window {
  electronShell?: { isDesktop?: boolean }
}

interface ImportMetaEnv {
  readonly VITE_GITHUB_OWNER: string
  readonly VITE_GITHUB_REPO: string
  readonly VITE_RELEASE_ASSET_NAME: string
  readonly VITE_RELEASE_MANIFEST_ASSET_NAME: string
  /** Если задан, режим редактора включается только после ввода этого значения в диалоге. */
  readonly VITE_EDITOR_TOKEN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
