import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    include: [
      '@tiptap/core',
      '@tiptap/html',
      '@tiptap/react',
      '@tiptap/react/menus',
      '@tiptap/starter-kit',
      '@tiptap/extension-bubble-menu',
      '@tiptap/extension-image',
      '@tiptap/extension-link',
      '@tiptap/extension-placeholder',
      '@tiptap/extension-table',
      '@tiptap/extension-underline',
    ],
  },
})
