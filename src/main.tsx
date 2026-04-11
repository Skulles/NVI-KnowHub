import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import 'prosemirror-tables/style/tables.css'
import { setPlatformBridge } from './shared/lib/platform'
import { createDesktopPlatformBridge } from './shared/lib/platform/desktopBridge'
import { ThemeSync } from './shared/ui/ThemeSync'

if (window.electronShell?.isDesktop) {
  setPlatformBridge(createDesktopPlatformBridge())
}

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
