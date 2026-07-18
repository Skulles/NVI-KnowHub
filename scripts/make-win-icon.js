#!/usr/bin/env node
const { mkdirSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')
const { execFileSync } = require('child_process')

async function main() {
  const root = join(__dirname, '..')
  const src = join(root, 'build', 'icon.png')
  if (!existsSync(src)) {
    console.error('build/icon.png not found')
    process.exit(1)
  }

  const tmp = join(root, 'build', '.icon-sizes')
  mkdirSync(tmp, { recursive: true })
  const sizes = [16, 32, 48, 64, 128, 256]
  const files = []
  for (const size of sizes) {
    const out = join(tmp, `icon-${size}.png`)
    try {
      execFileSync('sips', ['-z', String(size), String(size), src, '--out', out], { stdio: 'ignore' })
      files.push(out)
    } catch {
      // sips unavailable — fall back to source only
    }
  }
  if (files.length === 0) files.push(src)

  const pngToIco = (await import('png-to-ico')).default
  const buf = await pngToIco(files)
  writeFileSync(join(root, 'build', 'icon.ico'), buf)
  console.log(`Wrote build/icon.ico (${files.length} sizes)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
