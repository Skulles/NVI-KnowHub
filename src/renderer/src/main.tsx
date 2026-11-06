/**
 * Renderer ReactDOM entry: mounts App into #root.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/index.css'

if (navigator.userAgent.includes('Windows')) {
  document.documentElement.classList.add('platform-windows')
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
