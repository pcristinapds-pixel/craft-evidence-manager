const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, shell, dialog, screen } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { generatePPTX } = require('./ppt-builder');
const video = require('./video-tools');

const store = new Store();

// Esconde no terminal os avisos internos do capturador de tela do Windows
// ("ProcessFrame failed, using existing frame"). São inofensivos no Windows 11 24H2:
// a captura apenas reaproveita o quadro anterior quando a tela não mudou.
app.commandLine.appendSwitch('log-level', '3');

let mainWindow = null;
let floatingWindow = null;
let tempDir = path.join(os.tmpdir(), 'craft-evidence-temp');

function ensureTempDir() {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
}

function createWindow() {
  // tamanho inicial proporcional à tela (notebook, monitor grande, ultrawide)
  const { width: telaW, height: telaH } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1280, Math.round(telaW * 0.9)),
    height: Math.min(850, Math.round(telaH * 0.92)),
    minWidth: 760,
    minHeight: 540,
    center: true,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // continua capturando com o app minimizado
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (!store.get('savePath')) store.set('savePath', app.getPath('documents'));
  if (!store.get('jiraUrl')) store.set('jiraUrl', 'https://suaempresa.atlassian.net/browse/');
  if (!store.get('shortcutPrint')) store.set('shortcutPrint', 'F9');
  if (!store.get('shortcutRecord')) store.set('shortcutRecord', 'CommandOrControl+Shift+R');
  if (!store.get('shortcutFinish')) store.set('shortcutFinish', 'CommandOrControl+Shift+F');
  if (!store.get('shortcutPause')) store.set('shortcutPause', 'CommandOrControl+Shift+P');
  if (store.get('drawCursor') === undefined) store.set('drawCursor', true);

  mainWindow.on('closed', () => {
    mainWindow = null;
    unregisterShortcuts();
  });
}

function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const largura = 600;
  floatingWindow = new BrowserWindow({
    width: largura,
    height: 60,
    x: Math.round(area.x + (area.width - largura) / 2),
    y: area.y + 10,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  floatingWindow.loadFile(path.join(__dirname, '../renderer/floating.html'));
  floatingWindow.setContentProtection(true); // a barra não aparece nos prints/vídeo
  floatingWindow.setAlwaysOnTop(true, 'screen-saver');
}

function formatShortcut(sc) {
  if (!sc) return '';
  return sc.replace(/ctrl/i, 'CommandOrControl')
           .replace(/cmd/i, 'CommandOrControl')
           .replace(/command/i, 'CommandOrControl')
           .replace(/\s+/g, '');
}

function registerShortcuts() {
  unregisterShortcuts();

  const scPrint = formatShortcut(store.get('shortcutPrint') || 'F9');
  const scRecord = formatShortcut(store.get('shortcutRecord') || 'CommandOrControl+Shift+R');
  const scFinish = formatShortcut(store.get('shortcutFinish') || 'CommandOrControl+Shift+F');
  const scPause = formatShortcut(store.get('shortcutPause') || 'CommandOrControl+Shift+P');

  try {
    if (scPrint) globalShortcut.register(scPrint, () => {
      if (mainWindow) mainWindow.webContents.send('trigger-print');
    });
    if (scRecord) globalShortcut.register(scRecord, () => {
      if (mainWindow) mainWindow.webContents.send('trigger-toggle-record');
    });
    if (scFinish) globalShortcut.register(scFinish, () => {
      if (mainWindow) mainWindow.webContents.send('trigger-finish');
    });
    if (scPause) globalShortcut.register(scPause, () => {
      if (mainWindow) mainWindow.webContents.send('trigger-pause');
    });
  } catch (err) {
    console.error('Erro ao registrar atalhos globais:', err);
  }
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

app.whenReady().then(() => {
  ensureTempDir();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ------------------------------------------------------------------
// IPC HANDLERS - Ponte de comunicação
// ------------------------------------------------------------------

// Pop-ups nativos do Windows acionados pela tela
ipcMain.on('show-error', (event, title, msg) => {
  dialog.showErrorBox(title, msg);
});

ipcMain.on('show-message', (event, title, msg) => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: title,
    message: msg,
    buttons: ['OK']
  });
});

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 300, height: 200 }
    });
    return sources.map(src => ({
      id: src.id,
      name: src.name,
      thumbnail: src.thumbnail.toDataURL()
    }));
  } catch (error) {
    console.error('Erro na captura de telas:', error);
    return [];
  }
});

ipcMain.handle('get-settings', () => {
  return {
    savePath: store.get('savePath'),
    jiraUrl: store.get('jiraUrl'),
    shortcutPrint: store.get('shortcutPrint'),
    shortcutRecord: store.get('shortcutRecord'),
    shortcutFinish: store.get('shortcutFinish'),
    shortcutPause: store.get('shortcutPause'),
    drawCursor: store.get('drawCursor')
  };
});

ipcMain.handle('save-settings', (event, newSettings) => {
  Object.keys(newSettings).forEach(key => store.set(key, newSettings[key]));
  
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    registerShortcuts();
  }
  return true;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    store.set('savePath', result.filePaths[0]);
    return result.filePaths[0];
  }
  return store.get('savePath');
});

ipcMain.on('start-session', () => {
  if (mainWindow) mainWindow.minimize();
  createFloatingWindow();
  registerShortcuts();
});

ipcMain.on('update-floating-stats', (event, stats) => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send('update-stats', stats);
  }
});

ipcMain.on('stop-session', () => {
  unregisterShortcuts();
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.close();
    floatingWindow = null;
  }
  if (mainWindow) {
    mainWindow.restore();
    mainWindow.focus();
  }
});

ipcMain.on('cmd-print', () => {
  if (mainWindow) mainWindow.webContents.send('trigger-print');
});
ipcMain.on('cmd-record', () => {
  if (mainWindow) mainWindow.webContents.send('trigger-toggle-record');
});
ipcMain.on('cmd-finish', () => {
  if (mainWindow) mainWindow.webContents.send('trigger-finish');
});
ipcMain.on('cmd-pause', () => {
  if (mainWindow) mainWindow.webContents.send('trigger-pause');
});

// Salva o vídeo gravado na pasta temporária e padroniza em MP4 (H.264),
// com duração correta: é o formato que o PowerPoint reproduz e que o editor usa.
ipcMain.handle('save-video', async (event, { bytes, ext }) => {
  ensureTempDir();
  const bruto = path.join(tempDir, `gravacao_${Date.now()}.${ext === 'mp4' ? 'mp4' : 'webm'}`);
  fs.writeFileSync(bruto, Buffer.from(bytes));
  if (!video.disponivel()) return { filePath: bruto, fileUrl: pathToFileURL(bruto).href, editavel: false };
  try {
    const r = await video.padronizar(bruto, tempDir);
    fs.rm(bruto, () => {});
    return { ...r, fileUrl: pathToFileURL(r.filePath).href, editavel: true };
  } catch (err) {
    console.error('Falha ao padronizar vídeo:', err);
    return { filePath: bruto, fileUrl: pathToFileURL(bruto).href, editavel: false };
  }
});

// Aplica recorte / exclusão de trechos / divisão. Cada parte vira um vídeo novo.
ipcMain.handle('edit-video', async (event, { filePath, partes }) => {
  ensureTempDir();
  const r = await video.editar(filePath, partes, tempDir);
  return r.map(v => ({ ...v, fileUrl: pathToFileURL(v.filePath).href }));
});

ipcMain.handle('video-available', () => video.disponivel());

ipcMain.handle('generate-pptx', async (event, data) => {
  try {
    const targetFolder = store.get('savePath') || app.getPath('documents');
    const logoPath = path.join(__dirname, '../../assets/logo.png');
    
    const savedFilePath = await generatePPTX(data, targetFolder, logoPath);
    shell.showItemInFolder(savedFilePath);
    return { success: true, filePath: savedFilePath };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});