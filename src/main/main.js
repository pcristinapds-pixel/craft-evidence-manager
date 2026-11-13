const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, shell, dialog, screen, nativeImage, safeStorage } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { generatePPTX } = require('./ppt-builder');
const video = require('./video-tools');
const evidencias = require('./evidence-store');
const { gerarRelatorio, gerarRelatorioBug, ehBug, nomeBug } = require('./report-builder');
const { criarCliente, normalizarSite } = require('./jira');
const { criarServico } = require('./jira-servico');
const credenciais = require('./credenciais');
const { montarVisao } = require('./visao');

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

// Anexar prints ou vídeos que já existem no computador (feitos fora do app)
ipcMain.handle('attach-files', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Anexar print ou vídeo',
    filters: [
      { name: 'Imagens e vídeos', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mkv', 'avi'] },
      { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] },
      { name: 'Vídeos', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  if (r.canceled) return [];
  ensureTempDir();
  const itens = [];
  for (const arq of r.filePaths) {
    const ext = path.extname(arq).slice(1).toLowerCase();
    try {
      if (['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'].includes(ext)) {
        const img = nativeImage.createFromPath(arq);
        if (img.isEmpty()) throw new Error('imagem inválida');
        const { width, height } = img.getSize();
        itens.push({ type: 'image', dataUrl: img.toDataURL(), width, height, nome: path.basename(arq) });
      } else {
        // copia para a pasta temporária e padroniza em MP4, igual à gravação do app
        const copia = path.join(tempDir, `anexo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
        fs.copyFileSync(arq, copia);
        let v = { filePath: copia, editavel: false };
        if (video.disponivel()) {
          try { v = { ...(await video.padronizar(copia, tempDir)), editavel: true }; fs.rm(copia, () => {}); } catch (e) { console.error(e); }
        }
        itens.push({ type: 'video', ...v, fileUrl: pathToFileURL(v.filePath).href, nome: path.basename(arq) });
      }
    } catch (e) {
      itens.push({ type: 'erro', nome: path.basename(arq), erro: e.message });
    }
  }
  return itens;
});

// ---------------- Relatório one-page e testes de back-end ----------------
const pastaEvidencias = () => store.get('savePath') || app.getPath('documents');
const LOGO = path.join(__dirname, '../../assets/logo.png');

// Escolher arquivo de collection (Postman/Insomnia)
ipcMain.handle('collection-pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Anexar collection', filters: [{ name: 'Collection', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], nome: path.basename(r.filePaths[0]) };
});

// Informações da última execução de um cenário (para reexecução)
ipcMain.handle('historia-info', (event, storyId) => evidencias.infoHistoria(pastaEvidencias(), storyId));
ipcMain.handle('cenario-info', (event, { storyId, ct }) => {
  if (!storyId || !ct) return null;
  return evidencias.ultimaExecucao(pastaEvidencias(), storyId, ct);
});

// Pergunta com botões (retorna o índice escolhido)
ipcMain.handle('ask', async (event, { titulo, mensagem, detalhe, botoes, cancelar = botoes.length - 1 }) => {
  const r = await dialog.showMessageBox(mainWindow, { type: 'question', title: titulo, message: mensagem, detail: detalhe, buttons: botoes, defaultId: 0, cancelId: cancelar, noLink: true });
  return r.response;
});

ipcMain.handle('open-path', (event, p) => shell.openPath(p));
ipcMain.handle('show-item', (event, p) => shell.showItemInFolder(p));

// Salva a execução do cenário e gera o relatório da história e/ou o PPT
ipcMain.handle('generate-evidence', async (event, { dados, modo, saidas }) => {
  try {
    const base = pastaEvidencias();
    const salvo = evidencias.salvarExecucao(base, dados, modo);
    const out = { success: true, pasta: salvo.pastaHistoria, execucao: salvo.execucao };
    const bug = ehBug(dados.status);
    const jpeg = arq => 'data:image/jpeg;base64,' + nativeImage.createFromPath(arq).toJPEG(85).toString('base64');
    // versão leve dos vídeos (sempre: o relatório pode ser gerado depois, por outro CT)
    if (video.disponivel()) {
      for (const v of salvo.videos) {
        try { await video.compactar(v.original, v.relatorio); } catch (e) { console.error(e); }
      }
    }
    // ao substituir uma execução, o relatório de bug dela deixa de valer
    if (modo === 'substituir') {
      const antigo = path.join(salvo.pastaHistoria, 'Bugs', nomeBug(dados.storyId, dados.testCaseId, salvo.execucao));
      fs.rmSync(antigo, { force: true });
    }
    // cenário que não passou: relatório sozinho para anexar no bug
    // (gerado antes do relatório da história, que aponta para ele)
    if (bug) out.bug = gerarRelatorioBug(base, dados.storyId, dados.testCaseId, { jiraBaseUrl: dados.jiraBaseUrl, logoPath: LOGO, imagemParaDataUrl: jpeg });
    if (saidas.relatorio) {
      out.relatorio = gerarRelatorio(base, dados.storyId, {
        jiraBaseUrl: dados.jiraBaseUrl, logoPath: LOGO, out,
        imagemParaDataUrl: jpeg // prints entram como JPEG (bem mais leve que PNG)
      });
    }
    if (saidas.ppt) out.ppt = await generatePPTX(dados, salvo.pastaHistoria, LOGO);
    return out;
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

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

// ---------------- Integração com o Jira ----------------
const prefixoPlano = () => store.get('jiraPrefixoPlano') || '[QA]';
function clienteJira() {
  return criarCliente({ site: store.get('jiraSite'), email: store.get('jiraEmail'), token: credenciais.lerToken(store, safeStorage) });
}
const servicoJira = () => criarServico({ cliente: clienteJira(), base: pastaEvidencias(), prefixo: prefixoPlano() });
// Respostas para a tela: { ok, dados } ou { ok: false, erro, tipo } (tipo "token" = token recusado)
async function responder(fn) {
  try { return { ok: true, dados: await fn() }; }
  catch (e) { console.error(e); return { ok: false, erro: e.message, tipo: e.tipo || 'erro' }; }
}

ipcMain.handle('jira-config', () => credenciais.configJira(store, safeStorage));

ipcMain.handle('jira-config-salvar', (event, { site, email, token, prefixo }) => responder(() => {
  const s = normalizarSite(site);
  store.set('jiraSite', s);
  store.set('jiraEmail', String(email || '').trim());
  store.set('jiraPrefixoPlano', String(prefixo || '').trim() || '[QA]');
  if (token) credenciais.salvarToken(store, safeStorage, token); // vazio = mantém o token guardado
  if (s) store.set('jiraUrl', s + '/browse/');                  // links do relatório
  return credenciais.configJira(store, safeStorage);
}));

ipcMain.handle('jira-testar', () => responder(() => clienteJira().eu()));

// Sub-tasks abertas no meu nome, com o andamento do plano de cada história
ipcMain.handle('jira-minhas', (event, { soQa = true } = {}) => responder(async () => {
  try {
    const lista = await clienteJira().minhasSubtarefas({ prefixo: soQa ? prefixoPlano() : '' });
    const base = pastaEvidencias();
    const comAndamento = lista.map(s => {
      if (!s.pai) return s;
      const v = montarVisao(base, s.pai.chave);
      return { ...s, andamento: { executados: v.executados, total: v.cenarios.length, falharam: v.cenarios.filter(c => c.status === 'Falhou').length } };
    });
    store.set('jiraMinhasCache', { lista: comAndamento, lidoEm: new Date().toISOString(), soQa });
    return { lista: comAndamento, lidoEm: new Date().toISOString() };
  } catch (e) {
    // token recusado ou sem internet: mostra a última lista lida
    const cache = store.get('jiraMinhasCache');
    if (cache && (e.tipo === 'token' || e.tipo === 'rede')) return { lista: cache.lista, lidoEm: cache.lidoEm, doCache: true, erro: e.message, tipo: e.tipo };
    throw e;
  }
}));

ipcMain.handle('jira-historia', (event, chave) => responder(() => servicoJira().carregarHistoria(chave)));
ipcMain.handle('jira-escolher-plano', (event, { storyId, subtarefa }) => responder(() => servicoJira().escolherPlano(storyId, subtarefa)));
ipcMain.handle('historia-local', (event, storyId) => responder(() => montarVisao(pastaEvidencias(), storyId)));

ipcMain.handle('criterios-ajustes', (event, { storyId, ajustes }) => responder(() => {
  evidencias.salvarAjustesCriterios(pastaEvidencias(), storyId, ajustes);
  return montarVisao(pastaEvidencias(), storyId);
}));
ipcMain.handle('cobertura-definir', (event, { storyId, ct, ids }) => responder(() => {
  evidencias.definirCobertura(pastaEvidencias(), storyId, ct, ids);
  return montarVisao(pastaEvidencias(), storyId);
}));
ipcMain.handle('natureza-definir', (event, { storyId, ct, natureza }) => responder(() => {
  evidencias.definirNatureza(pastaEvidencias(), storyId, ct, natureza);
  return montarVisao(pastaEvidencias(), storyId);
}));

// Edição de um cenário: no app e, se pedido, também na sub-task do plano no Jira
ipcMain.handle('cenario-salvar', (event, { storyId, ct, titulo, bdd, gravarNoJira }) => responder(async () => {
  const base = pastaEvidencias();
  let jira = null;
  if (gravarNoJira) {
    jira = await servicoJira().gravarCenarioNoJira(storyId, ct, { titulo, bdd });
    if (jira.conflito) return { conflito: true, noJira: jira.noJira, visao: montarVisao(base, storyId) };
  } else {
    evidencias.atualizarCenario(base, storyId, ct, { titulo, bdd });
  }
  return { jira, visao: montarVisao(base, storyId) };
}));

// Cenário novo (para um critério sem cenário ou uma regra dos comentários)
ipcMain.handle('cenario-novo', (event, { storyId, titulo, bdd, natureza, criterios, origem, origemDetalhe, gravarNoJira }) => responder(async () => {
  const base = pastaEvidencias();
  const { ct } = evidencias.adicionarCenario(base, storyId, { titulo, bdd, origem, origemDetalhe, criterios });
  if (natureza) evidencias.definirNatureza(base, storyId, ct, natureza);
  let jira = null;
  if (gravarNoJira) jira = await servicoJira().gravarCenarioNoJira(storyId, ct, { titulo, bdd });
  return { ct, jira, visao: montarVisao(base, storyId) };
}));

// Abre no navegador só links do Jira configurado e a página de tokens da Atlassian
ipcMain.handle('abrir-link', (event, url) => {
  const site = store.get('jiraSite');
  const ok = /^https:\/\/id\.atlassian\.com\//.test(url) || (site && String(url).startsWith(site + '/'));
  if (ok) shell.openExternal(url);
  return ok;
});
