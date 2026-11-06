#!/usr/bin/env node
const { mkdirSync, writeFileSync, existsSync, rmSync } = require('fs')
const { join } = require('path')

async function main() {
  const root = join(__dirname, '..')
  const src = join(root, 'build', 'icon.png')
  if (!existsSync(src)) {
    console.error('build/icon.png not found')
    process.exit(1)
  }

  const sharp = (await import('sharp')).default
  const tmp = join(root, 'build', '.icon-sizes')
  mkdirSync(tmp, { recursive: true })

  const sizes = [16, 32, 48, 64, 128, 256]
  const files = []
  for (const size of sizes) {
    const out = join(tmp, `icon-${size}.png`)
    await sharp(src).resize(size, size).png().toFile(out)
    files.push(out)
  }

  const pngToIco = (await import('png-to-ico')).default
  const buf = await pngToIco(files)
  writeFileSync(join(root, 'build', 'icon.ico'), buf)
  rmSync(tmp, { recursive: true, force: true })
  console.log(`Wrote build/icon.ico (${files.length} sizes)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
