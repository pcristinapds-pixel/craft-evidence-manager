const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Chamadas para o sistema operacional
  getSources: () => ipcRenderer.invoke('get-sources'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startSession: () => ipcRenderer.send('start-session'),
  stopSession: () => ipcRenderer.send('stop-session'),
  updateStats: (stats) => ipcRenderer.send('update-floating-stats', stats),
  generatePptx: (data) => ipcRenderer.invoke('generate-pptx', data),
  saveVideo: (bytes, ext) => ipcRenderer.invoke('save-video', { bytes, ext }),
  editVideo: (filePath, partes) => ipcRenderer.invoke('edit-video', { filePath, partes }),
  pickCollection: () => ipcRenderer.invoke('collection-pick'),
  historiaInfo: (storyId) => ipcRenderer.invoke('historia-info', storyId),
  cenarioInfo: (storyId, ct) => ipcRenderer.invoke('cenario-info', { storyId, ct }),
  ask: (opcoes) => ipcRenderer.invoke('ask', opcoes),
  generateEvidence: (dados, modo, saidas) => ipcRenderer.invoke('generate-evidence', { dados, modo, saidas }),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
  videoAvailable: () => ipcRenderer.invoke('video-available'),
  
  // Comandos enviados pela barra flutuante
  sendPrintCmd: () => ipcRenderer.send('cmd-print'),
  sendRecordCmd: () => ipcRenderer.send('cmd-record'),
  sendFinishCmd: () => ipcRenderer.send('cmd-finish'),
  sendPauseCmd: () => ipcRenderer.send('cmd-pause'),
  
  // Pop-ups Nativos do Windows
  showError: (title, msg) => ipcRenderer.send('show-error', title, msg),
  showMessage: (title, msg) => ipcRenderer.send('show-message', title, msg),

  // Escutas de eventos do sistema repassados para a tela (app.js e floating.html)
  attachFiles: () => ipcRenderer.invoke('attach-files'),
  onTriggerPrint: (callback) => ipcRenderer.on('trigger-print', (event, ...args) => callback(...args)),
  onTriggerToggleRecord: (callback) => ipcRenderer.on('trigger-toggle-record', (event, ...args) => callback(...args)),
  onTriggerFinish: (callback) => ipcRenderer.on('trigger-finish', (event, ...args) => callback(...args)),
  onTriggerPause: (callback) => ipcRenderer.on('trigger-pause', (event, ...args) => callback(...args)),
  onUpdateStats: (callback) => ipcRenderer.on('update-stats', (event, stats) => callback(stats))
});