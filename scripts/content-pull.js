#!/usr/bin/env node
// Fetches the latest published content from SERVER_URL into resources/content/
// Run before packaging so the bundled fallback content is up to date.
// Usage: node scripts/content-pull.js
//        KNOWHUB_SERVER_URL=https://myserver.com node scripts/content-pull.js

import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'resources', 'content')
const SERVER_URL = (process.env.KNOWHUB_SERVER_URL ?? 'https://YOUR_SERVER').replace(/\/$/, '')

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function collectHtmlFiles(sections) {
  const files = []
  for (const section of sections) {
    for (const item of section.items ?? []) {
      if (item.htmlFile) files.push(item.htmlFile)
    }
    for (const sub of section.subsections ?? []) {
      for (const item of sub.items ?? []) {
        if (item.htmlFile) files.push(item.htmlFile)
      }
    }
  }
  return files
}

async function main() {
  console.log(`Pulling content from ${SERVER_URL}`)

  const manifest = await fetchJson(`${SERVER_URL}/content/manifest.json`)
  await download(`${SERVER_URL}/content/manifest.json`, join(OUT_DIR, 'manifest.json'))
  console.log('  manifest.json ✓')

  const htmlFiles = collectHtmlFiles(manifest.sections ?? [])
  for (const file of htmlFiles) {
    await download(`${SERVER_URL}/content/${file}`, join(OUT_DIR, file))
    console.log(`  ${file} ✓`)
  }

  console.log(`Done — ${htmlFiles.length + 1} files written to resources/content/`)
}

main().catch((err) => {
  console.error('content-pull failed:', err.message)
  process.exit(1)
})
