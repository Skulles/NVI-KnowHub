const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronShell', {
  isDesktop: true,
})
