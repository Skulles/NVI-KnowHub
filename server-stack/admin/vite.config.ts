import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const stackDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function normalizeBasePath(raw: string | undefined): string {
  const trimmed = raw?.trim()
  if (!trimmed) return ''
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeading.replace(/\/+$/, '')
}

const basePath = normalizeBasePath(process.env.BASE_PATH)
const adminBase = `${basePath}/admin/`

export default defineConfig({
    plugins: [react()],
    base: adminBase,
    envDir: stackDir,
    server: {
      port: 5173,
      proxy: {
        [`${basePath}/api`]: {
          target: 'http://localhost:3000',
          changeOrigin: true
        },
        [`${basePath}/content`]: {
          target: 'http://localhost:3000',
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist'
    }
})
