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
  if (explicit) return `${explicit}/`

  const server = process.env.KNOWHUB_SERVER_URL?.replace(/\/+$/, '')
  if (server) return `${server}/releases/`

  console.warn(
    '[electron-builder] KNOWHUB_SERVER_URL is not set — publish.url falls back to placeholder'
  )
  return 'https://YOUR_SERVER/releases/'
}

const releasesUrl = resolveReleasesUrl()
console.log(`[electron-builder] publish.url → ${releasesUrl}`)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  publish: {
    provider: 'generic',
    url: releasesUrl
  }
}
