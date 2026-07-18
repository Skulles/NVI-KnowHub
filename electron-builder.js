const { readFileSync, existsSync } = require('fs')
const { join } = require('path')

function loadDotEnv() {
  const envPath = join(__dirname, '.env')
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function resolveReleasesUrl() {
  loadDotEnv()

  const explicit = process.env.KNOWHUB_RELEASES_URL?.replace(/\/+$/, '')
  if (explicit) {
    if (!/^https:\/\//i.test(explicit)) {
      throw new Error('[electron-builder] KNOWHUB_RELEASES_URL must be an https:// URL')
    }
    return `${explicit}/`
  }

  const server = process.env.KNOWHUB_SERVER_URL?.replace(/\/+$/, '')
  if (!server) {
    throw new Error(
      '[electron-builder] KNOWHUB_SERVER_URL is required for packaging (set it in .env)'
    )
  }
  if (!/^https:\/\//i.test(server) && !/^http:\/\/localhost(?::\d+)?$/i.test(server)) {
    throw new Error(
      '[electron-builder] KNOWHUB_SERVER_URL must be https:// (or http://localhost for local packaging tests)'
    )
  }
  if (/YOUR_SERVER/i.test(server)) {
    throw new Error('[electron-builder] KNOWHUB_SERVER_URL still contains YOUR_SERVER placeholder')
  }

  return `${server}/releases/`
}

const releasesUrl = resolveReleasesUrl()
console.log(`[electron-builder] publish.url → ${releasesUrl}`)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.nvi.knowhub',
  productName: 'NVI KnowHub',
  copyright: 'Copyright © NVI',
  asar: true,
  directories: {
    buildResources: 'build'
  },
  files: [
    'out',
    // Renderer bundles these; keep them out of asar to shrink the package.
    '!node_modules/@fontsource-variable/**/*',
    '!node_modules/react/**/*',
    '!node_modules/react-dom/**/*',
    '!node_modules/scheduler/**/*',
    '!node_modules/zustand/**/*',
    '!node_modules/dompurify/**/*',
    '!node_modules/@types/**/*'
  ],
  extraResources: [
    {
      from: 'build/icon.png',
      to: 'icon.png'
    },
    {
      from: 'resources/content',
      to: 'content'
    }
  ],
  win: {
    target: 'nsis',
    icon: 'build/icon.ico',
    extraResources: [
      {
        from: 'resources/winbox',
        to: 'winbox',
        filter: ['WinBox64.exe']
      }
    ]
  },
  nsis: {
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    createDesktopShortcut: 'always',
    shortcutName: 'NVI KnowHub'
  },
  mac: {
    category: 'public.app-category.reference',
    // Squirrel.Mac / electron-updater скачивает .zip для in-place update; один .dmg ломает автообновление.
    target: ['dmg', 'zip'],
    extraResources: [
      {
        from: 'resources/winbox',
        to: 'winbox',
        filter: ['WinBox.app/**']
      }
    ]
  },
  linux: {
    target: 'AppImage',
    category: 'Education',
    extraResources: [
      {
        from: 'resources/winbox',
        to: 'winbox',
        filter: ['WinBox']
      }
    ]
  },
  publish: {
    provider: 'generic',
    url: releasesUrl
  }
}
