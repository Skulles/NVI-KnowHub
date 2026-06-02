import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

const env = loadEnv('', process.cwd(), '')

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve('src/main/index.ts') }
    },
    define: {
      'process.env.KNOWHUB_SERVER_URL': JSON.stringify(env.KNOWHUB_SERVER_URL || '')
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: { input: resolve('src/preload/index.ts') }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
