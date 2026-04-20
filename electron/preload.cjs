const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronShell', {
  isDesktop: true,
})

contextBridge.exposeInMainWorld('desktopNet', {
  request: (payload) => ipcRenderer.invoke('net-request', payload),
})

contextBridge.exposeInMainWorld('desktopMikrotikDiscovery', {
  start: () => ipcRenderer.invoke('mikrotik-discovery:start'),
  stop: () => ipcRenderer.invoke('mikrotik-discovery:stop'),
  getSnapshot: () => ipcRenderer.invoke('mikrotik-discovery:get-snapshot'),
  onSnapshot: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('mikrotik-discovery:snapshot', listener)
    return () => {
      ipcRenderer.removeListener('mikrotik-discovery:snapshot', listener)
    }
  },
})

contextBridge.exposeInMainWorld('desktopMacTelnet', {
  connect: (payload) => ipcRenderer.invoke('mac-telnet:connect', payload),
  sendInput: (payload) => ipcRenderer.invoke('mac-telnet:input', payload),
  resize: (payload) => ipcRenderer.invoke('mac-telnet:resize', payload),
  disconnect: (payload) => ipcRenderer.invoke('mac-telnet:disconnect', payload),
  onData: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('mac-telnet:data', listener)
    return () => ipcRenderer.removeListener('mac-telnet:data', listener)
  },
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('mac-telnet:event', listener)
    return () => ipcRenderer.removeListener('mac-telnet:event', listener)
  },
})
