const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronShell', {
  isDesktop: true,
})

contextBridge.exposeInMainWorld('desktopNet', {
  request: (payload) => ipcRenderer.invoke('net-request', payload),
})
