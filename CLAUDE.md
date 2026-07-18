# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NVI KnowHub** — cross-platform desktop knowledge base (Electron + React + TypeScript). Displays company instructions (HTML articles) and interactive tools (React components). Works fully offline; checks for content and app updates from an external server on startup.

Platforms: Windows, macOS, Linux.

## Commands

```bash
npm run dev             # Start electron-vite dev server + Electron window
npm run build           # content:pull + winbox:download + vite build + electron-builder
npm run build:unpack    # Same but skip installer (outputs unpacked dir)
npm run preview         # Preview the built app without packaging
npm run typecheck       # Type-check without emitting
npm run content:pull    # Fetch latest articles from KNOWHUB_SERVER_URL → resources/content/
npm run winbox:download # Download WinBox64.exe from MikroTik → resources/winbox/
```

> **Important for `npm run dev`**: The `dev` script uses `scripts/dev.js` which removes `ELECTRON_RUN_AS_NODE` from the environment before spawning electron-vite. This env var is set by Electron-based host tools (Claude Code, VS Code) and, if left set, causes Electron to start in Node.js mode — breaking `require('electron')` in the main process.

> **Environment**: Copy `.env.example` to `.env` and set `KNOWHUB_SERVER_URL`. `content:pull` requires this variable.

## Architecture

### Process structure (Electron)

```
src/
├── main/                Electron main process (Node.js)
│   ├── index.ts         Window creation, IPC handlers, app lifecycle
│   ├── contentSync.ts   Download content from server into userData/content/
│   ├── updater.ts       electron-updater: check / download / install app updates
│   └── winbox.ts        Launch bundled WinBox64.exe via IPC
├── preload/
│   └── index.ts         contextBridge — exposes window.api to the renderer
├── renderer/            React SPA (Vite dev server in dev, static in prod)
│   └── src/
│       ├── App.tsx                Root component, IPC subscriptions
│       ├── store/
│       │   ├── content.ts         Zustand: manifest, selectedItem, article HTML
│       │   ├── updates.ts         Zustand: contentUpdated, appUpdateVersion
│       │   └── winbox.ts          Zustand: WinBox launch state
│       ├── components/
│       │   ├── AppHeader/         Title bar with app name and version
│       │   ├── Sidebar/           Collapsible section/item navigation
│       │   ├── ContentArea/       Renders article HTML or tool component
│       │   └── UpdateBanner/      Top bar for content/app update notifications
│       └── tools/
│           ├── registry.tsx       Map<toolId, ReactComponent>
│           ├── FuelCalculator/    Fuel cost calculator tool
│           └── WinBox/            WinBox launcher tool (Windows only)
└── shared/
    ├── types.ts    ContentManifest, Section, Subsection, ContentItem
    ├── api.ts      ElectronAPI interface (window.api shape)
    └── manifest.ts flattenSectionItems / flattenManifestItems helpers
```

### Path aliases (renderer imports)

| Alias | Resolves to |
|---|---|
| `@renderer` | `src/renderer/src` |
| `@shared` | `src/shared` |

### Content system

- Content lives in `userData/content/` (platform app data dir)
- `manifest.json` describes all sections/items with version numbers
- On startup, `contentSync.ts` fetches `{SERVER_URL}/content/manifest.json` and downloads any changed HTML files; signals renderer via IPC `content:updated`
- When `window.api` is unavailable (browser/test context) or returns `null`, `store/content.ts` falls back to `MOCK_MANIFEST` / `MOCK_ARTICLES`

#### Manifest structure

A `Section` can have `items` (flat list), `subsections` (grouped sub-lists), or both. `flattenSectionItems` in `src/shared/manifest.ts` handles both layouts — always use it instead of reading `section.items` directly.

```ts
// Section with subsections (e.g. "Instructions" grouped by topic)
{ id, title, subsections: [{ id, title, items: ContentItem[] }] }

// Section with flat items (e.g. "Tools")
{ id, title, items: ContentItem[] }
```

### Tools

Tools are React components registered in `src/renderer/src/tools/registry.tsx`. They are bundled with the app and only updated via a full app release. Add a new tool by:
1. Creating `src/renderer/src/tools/YourTool/YourTool.tsx`
2. Registering it: `'your-tool-id': YourTool` in `registry.tsx`
3. Adding a `ContentItem` with `type: 'tool', toolId: 'your-tool-id'` to the manifest

### IPC API (`window.api`)

Defined in `src/shared/api.ts`, implemented in `src/preload/index.ts`, typed as `Window.api` via `src/renderer/src/env.d.ts`:

- `getManifest()` → loads local manifest from userData
- `getArticleHtml(file)` → reads HTML file from userData/content/
- `getAppVersion()` → returns the app version string
- `onContentUpdated(cb)` → fires when contentSync downloads new content; returns unsubscribe fn
- `onAppUpdateAvailable(cb)` / `onAppUpdateDownloaded(cb)` → electron-updater events; return unsubscribe fn
- `installAppUpdate()` → calls `autoUpdater.quitAndInstall()`

### Article HTML conventions

Articles are raw HTML files. `ContentArea` strips the `<h1>` and leading `.lead` paragraph before rendering, so the file structure is:

```html
<h1>Article Title</h1>           <!-- shown as page header via React, not innerHTML -->
<p class="lead">Summary text</p> <!-- shown as subtitle -->

<!-- Body — use these CSS classes defined in src/renderer/src/assets/index.css -->
<section class="article-section-card">
  <h2>Section heading</h2>
  <ul class="article-task-list article-task-list--checks">   <!-- circle bullets -->
    <li>Item</li>
  </ul>
  <ol class="article-task-list article-task-list--numbered"> <!-- counter badges -->
    <li>Step</li>
  </ol>
  <ul class="article-task-list">                            <!-- plain, no icon -->
    <li>Item</li>
  </ul>
  <div class="article-table-wrap"><table>…</table></div>
</section>
<blockquote class="article-callout">Tip text</blockquote>
```

### Tailwind design tokens

Custom tokens defined in `tailwind.config.js` — use these instead of raw hex values:

| Token | Usage |
|---|---|
| `surface-window` / `surface-sidebar` / `surface-card` / `surface-raised` | Background layers (darkest → lightest) |
| `surface-input` / `surface-border` / `surface-divider` | Form inputs, borders, subtle dividers |
| `label-primary` / `label-secondary` / `label-tertiary` | Text hierarchy |
| `tint-blue` / `tint-blue-hover` | Interactive accent |
| `sidebar-bg` / `sidebar-hover` / `sidebar-active` / `sidebar-text` / `sidebar-muted` | Sidebar-specific |
| `shadow-sheet` / `shadow-chromeTop` / `shadow-focus` | Standard shadow styles |

### Resources

Bundled assets that ship inside the app package:

```
resources/
├── content/          Seed articles (manifest.json + HTML files); refreshed by content:pull
└── winbox/
    ├── .gitkeep
    └── WinBox64.exe  Downloaded by winbox:download (gitignored — not committed)
```

`extraResources` in `package.json` copies `resources/content/` → `resources/content/` and `resources/winbox/` → `resources/winbox/` inside the packaged app.

### Server stack

`server-stack/` is a self-contained backend that runs alongside the desktop app:

```
server-stack/
├── server/           Express.js API + static file server (TypeScript)
├── admin/            React admin panel — block-based article editor (BlockNote)
├── nginx/            Reverse-proxy config: /admin → SPA, /api → Node, /content & /releases → files
├── Dockerfile        2-stage build for the Node.js server
├── Dockerfile.nginx  Builds Nginx with the admin SPA baked in
└── docker-compose.yml  Production deployment (server + nginx, shared data volume)
```

The admin panel writes articles as HTML to `data/content/` (Docker volume); `content:pull` script fetches from `/content/manifest.json` on the running server.

### Update server config

Set `KNOWHUB_SERVER_URL` env var (in `.env`, see `.env.example`) for content sync.  
`electron-builder.js` publish URL (`https://YOUR_SERVER/releases/`) is used for app auto-updates.

## Key config files

| File | Purpose |
|---|---|
| `electron.vite.config.ts` | Vite config for main/preload/renderer; defines `@renderer`/`@shared` aliases |
| `tsconfig.node.json` | TS config for main + preload + shared |
| `tsconfig.web.json` | TS config for renderer + shared |
| `tailwind.config.js` | Tailwind — content paths for tree-shaking, design token extensions |
| `electron-builder.js` | electron-builder config (targets, publish URL) |
| `.env` / `.env.example` | `KNOWHUB_SERVER_URL` for content sync; `WINBOX_DOWNLOAD_VERSION` for winbox:download |
| `server-stack/docker-compose.yml` | Production server deployment |
| `server-stack/docker-compose.dev.yml` | Local server development |
