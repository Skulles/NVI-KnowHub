import express from 'express'
import cors from 'cors'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'
import { basePath, withBase } from './base-path.js'
import { createApiRouter } from './routes/api.js'
import { createAuthRouter } from './routes/auth.js'
import { initAuth, isAuthConfigured } from './auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// DATA_DIR is configurable via env var (Docker volume mount)
// Default: server-stack/data/ (relative to this file's location)
const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, '..', '..', 'data')
const DRAFTS_DIR = join(DATA_DIR, 'drafts')
const CONTENT_DIR = join(DATA_DIR, 'content')
const RELEASES_DIR = join(DATA_DIR, 'releases')

mkdirSync(DRAFTS_DIR, { recursive: true })
mkdirSync(CONTENT_DIR, { recursive: true })
mkdirSync(RELEASES_DIR, { recursive: true })
initAuth(DATA_DIR)

const PORT = Number(process.env.PORT ?? 3000)
const PREFIX = basePath()

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

const routes = express.Router()

// Static: published content → GET {prefix}/content/*
routes.use('/content', express.static(CONTENT_DIR))

// Static: app releases → GET {prefix}/releases/*
routes.use('/releases', express.static(RELEASES_DIR))

// Admin SPA — served by nginx in production; served here for dev convenience
const adminDist = join(__dirname, '..', '..', 'admin', 'dist')
routes.use('/admin', express.static(adminDist))
routes.get('/admin/*', (_req, res) => {
  res.sendFile(join(adminDist, 'index.html'))
})

// API
routes.use('/api/auth', createAuthRouter())
routes.use('/api', createApiRouter(DRAFTS_DIR, CONTENT_DIR))

routes.get('/health', (_req, res) => {
  res.type('text/plain').send('ok')
})

if (PREFIX) app.use(PREFIX, routes)
else app.use(routes)

app.listen(PORT, () => {
  const root = PREFIX || ''
  console.log(`KnowHub server running on http://localhost:${PORT}`)
  console.log(`  Admin panel: http://localhost:${PORT}${withBase('/admin')}`)
  console.log(`  Content:     http://localhost:${PORT}${withBase('/content/manifest.json')}`)
  if (!isAuthConfigured()) {
    console.warn('  WARNING: ADMIN_PASSWORD is not set — API is unprotected!')
  }
})
