let selectedSourceId = null;
let evidences = []; 
let activeIndex = -1;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordStartTime = 0;
let recordTimerInterval = null;
let videoSaving = Promise.resolve();
let isPaused = false;
let pausedTotal = 0;   // ms pausados (não contam no cronômetro)
let pausedAt = 0;

const screenSetup = document.getElementById('screenSetup');
const screenReview = document.getElementById('screenReview');
const sourcesList = document.getElementById('sourcesList');
const canvas = document.getElementById('annotationCanvas');
const ctx = canvas.getContext('2d');
const videoPreview = document.getElementById('videoPreview');

// 1. Carregar Seleção de Fontes com Feedback Visual
async function loadSources() {
  sourcesList.innerHTML = '<div style="grid-column: span 4; text-align: center; padding: 20px; color: var(--navy); font-weight: bold;">⏳ Carregando telas e janelas disponíveis...</div>';
  
  try {
    const sources = await window.api.getSources();
    sourcesList.innerHTML = '';
    
    if (!sources || sources.length === 0) {
      sourcesList.innerHTML = '<div style="grid-column: span 4; text-align: center; padding: 20px; color: #D31227; font-weight: bold;">⚠️ Nenhuma tela encontrada. Verifique as permissões de captura do sistema.</div>';
      return;
    }

    sources.forEach((src, index) => {
      const div = document.createElement('div');
      div.className = `source-item ${index === 0 ? 'selected' : ''}`;
      if (index === 0) selectedSourceId = src.id;

      div.innerHTML = `
        <img src="${src.thumbnail}">
        <div style="font-size:11px; margin-top:4px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${src.name}</div>
      `;
      div.onclick = () => {
        document.querySelectorAll('.source-item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedSourceId = src.id;
      };
      sourcesList.appendChild(div);
    });
  } catch (err) {
    sourcesList.innerHTML = `<div style="grid-column: span 4; text-align: center; color: red; font-weight: bold;">Erro ao carregar telas: ${err.message}</div>`;
  }
}

loadSources();

// ---------------------------------------------------------------
// Captura: um único stream da tela escolhida fica aberto durante a sessão.
// Prints e vídeo usam esse mesmo stream. Os frames são lidos direto do stream
// (ImageCapture), então funciona com o app minimizado.
// ---------------------------------------------------------------
let sessionStream = null;
let sessionSourceId = null;

async function ensureStream() {
  const vivo = sessionStream && sessionStream.getVideoTracks().some(t => t.readyState === 'live');
  if (vivo && sessionSourceId === selectedSourceId) return sessionStream;
  stopStream();
  sessionStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSourceId, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } }
  });
  sessionSourceId = selectedSourceId;
  return sessionStream;
}

function stopStream() {
  if (sessionStream) sessionStream.getTracks().forEach(t => t.stop());
  sessionStream = null;
  sessionSourceId = null;
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

// Pega o frame atual do stream e devolve um canvas
async function grabFrame() {
  const stream = await ensureStream();
  const track = stream.getVideoTracks()[0];

  if ('ImageCapture' in window) {
    try {
      const bmp = await Promise.race([
        new ImageCapture(track).grabFrame(),
        esperar(3000).then(() => { throw new Error('tempo esgotado'); })
      ]);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      return c;
    } catch (e) { console.warn('ImageCapture falhou, usando vídeo:', e); }
  }

  // Plano B: elemento de vídeo, aguardando o tamanho ficar disponível (sem depender de renderização)
  const v = document.createElement('video');
  v.muted = true; v.srcObject = stream;
  v.play().catch(() => {});
  for (let i = 0; i < 40 && (!v.videoWidth || v.readyState < 2); i++) await esperar(50);
  if (!v.videoWidth) throw new Error('não foi possível ler a tela selecionada');
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  v.srcObject = null;
  return c;
}

async function iniciarSessao() {
  try {
    await ensureStream();          // abre a captura antes de minimizar o app
  } catch (err) {
    return window.api.showError('Não foi possível capturar a tela', String(err && err.message || err));
  }
  window.api.startSession();
  updateStats();
}

// 2. Iniciar Sessão com Alertas Nativos
document.getElementById('btnStartCapture').addEventListener('click', () => {
  if (!selectedSourceId) return window.api.showError('Seleção Obrigatória', 'Selecione uma tela na lista de capturas.');
  if (!document.getElementById('storyId').value) return window.api.showError('Campo Obrigatório', 'Informe o ID da História antes de continuar.');
  if (!document.getElementById('testTitle').value) return window.api.showError('Campo Obrigatório', 'Informe o Título do Teste antes de continuar.');
  iniciarSessao();
});

function updateStats() {
  const agora = isPaused ? pausedAt : Date.now();
  const elapsed = isRecording ? Math.max(0, Math.floor((agora - recordStartTime - pausedTotal) / 1000)) : 0;
  window.api.updateStats({
    printCount: evidences.filter(e => e.type === 'image').length,
    isRecording: isRecording,
    isPaused: isRecording && isPaused,
    recordTime: elapsed
  });
}

// 3. Capturar Print
let tirandoPrint = false;
window.api.onTriggerPrint(async () => {
  if (tirandoPrint) return;      // evita prints duplicados se a tecla for segurada
  tirandoPrint = true;
  try {
    const c = await grabFrame();
    const dataUrl = c.toDataURL('image/png');
    evidences.push({
      id: Date.now(), type: 'image',
      original: dataUrl,   // print limpo, usado para redesenhar os destaques
      dataUrl: dataUrl,    // print com destaques (vai para o PPT)
      width: c.width, height: c.height,
      highlights: []
    });
    updateStats();
  } catch (err) {
    console.error('Erro na captura:', err);
    window.api.showError('Erro ao tirar print', String(err && err.message || err));
  } finally {
    tirandoPrint = false;
  }
});

// 4. Alternar Gravação
window.api.onTriggerToggleRecord(async () => {
  if (!isRecording) {
    try {
      const stream = await ensureStream();
      const c = await grabFrame();                       // capa do vídeo
      const cover = c.toDataURL('image/jpeg', 0.8);
      const largura = c.width, altura = c.height;

      const formatos = [['video/mp4;codecs=avc1.640028', 'mp4'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9', 'webm'], ['video/webm', 'webm']];
      const [mime, ext] = formatos.find(([m]) => MediaRecorder.isTypeSupported(m)) || ['', 'webm'];

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 6000000 });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };

      videoSaving = new Promise(resolve => {
        mediaRecorder.onstop = async () => {
          try {
            const blob = new Blob(recordedChunks, { type: mime || 'video/webm' });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const saved = await window.api.saveVideo(bytes, ext);
            evidences.push({
              id: Date.now(), type: 'video', filePath: saved.filePath, fileUrl: saved.fileUrl,
              cover: saved.cover || cover, width: saved.width || largura, height: saved.height || altura,
              duration: saved.duration || null, editavel: !!saved.editavel
            });
          } catch (err) {
            window.api.showError('Erro ao salvar vídeo', String(err && err.message || err));
          }
          recordedChunks = [];
          updateStats();
          resolve();
        };
      });

      mediaRecorder.start(1000);
      isRecording = true;
      isPaused = false; pausedTotal = 0;
      recordStartTime = Date.now();
      recordTimerInterval = setInterval(updateStats, 1000);
      updateStats();
    } catch (err) {
      console.error('Erro ao iniciar vídeo:', err);
      window.api.showError('Erro ao iniciar gravação', String(err && err.message || err));
    }
  } else {
    isRecording = false;
    isPaused = false;
    clearInterval(recordTimerInterval);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    updateStats();
  }
});

// 4b. Pausar / retomar a gravação (o trecho pausado não entra no vídeo)
window.api.onTriggerPause(() => {
  if (!isRecording || !mediaRecorder) return;
  if (!isPaused && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    isPaused = true; pausedAt = Date.now();
  } else if (isPaused && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    pausedTotal += Date.now() - pausedAt;
    isPaused = false;
  }
  updateStats();
});

// 5. Finalizar Captura
window.api.onTriggerFinish(async () => {
  if (isRecording) {
    isRecording = false;
    isPaused = false;
    clearInterval(recordTimerInterval);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }
  await videoSaving; // garante que o vídeo foi salvo antes da revisão
  stopStream();      // libera a captura da tela
  window.api.stopSession();
  showReviewScreen();
});

function showReviewScreen() {
  screenSetup.classList.add('hidden');
  screenReview.classList.remove('hidden');
  renderThumbnails();
}

function renderThumbnails() {
  const thumbList = document.getElementById('thumbList');
  thumbList.innerHTML = '';

  evidences.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = `thumb-item ${idx === activeIndex ? 'active' : ''}`;
    
    const rotulo = item.type === 'image'
      ? `Passo ${evidences.slice(0, idx + 1).filter(e => e.type === 'image').length}`
      : `Vídeo ${evidences.slice(0, idx + 1).filter(e => e.type === 'video').length}` +
        (item.duration ? ` (${fmtCurto(item.duration)})` : '') + (item.origem ? ' • editado' : '');
    const midia = item.type === 'image' ? `<img src="${item.dataUrl}">` : `<video src="${item.fileUrl || item.filePath}" muted></video>`;
    div.innerHTML = `${midia}
      <div class="thumb-rodape">
        <span>${rotulo}${item.highlights && item.highlights.length ? ' • destacado' : ''}</span>
        <button class="btn-move" title="Mover para antes" onclick="moveItem(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-move" title="Mover para depois" onclick="moveItem(${idx}, 1)" ${idx === evidences.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <button class="btn-del" title="Excluir" onclick="deleteItem(${idx})">✕</button>`;

    div.onclick = (e) => {
      if (e.target.closest('button')) return;
      selectEvidence(idx);
    };
    thumbList.appendChild(div);
  });

  if (evidences.length > 0 && activeIndex === -1) selectEvidence(0);
}

window.moveItem = function(idx, dir) {
  const alvo = idx + dir;
  if (alvo < 0 || alvo >= evidences.length) return;
  [evidences[idx], evidences[alvo]] = [evidences[alvo], evidences[idx]];
  if (activeIndex === idx) activeIndex = alvo; else if (activeIndex === alvo) activeIndex = idx;
  renderThumbnails();
};

window.deleteItem = function(idx) {
  if (!confirm('Excluir esta evidência?')) return;
  evidences.splice(idx, 1);
  if (activeIndex >= evidences.length) activeIndex = evidences.length - 1;
  renderThumbnails();
  if (evidences.length > 0) selectEvidence(Math.max(0, activeIndex));
  else { canvas.classList.add('hidden'); videoPreview.classList.add('hidden'); document.getElementById('canvasToolbar').classList.add('hidden'); fecharEditorVideo(); }
};

// 6. Editor de Anotações
let isDrawing = false;
let startX, startY;
let currentImage = new Image();

function selectEvidence(idx) {
  activeIndex = idx;
  renderThumbnails();

  const item = evidences[idx];
  const toolbar = document.getElementById('canvasToolbar');

  if (item.type === 'image') {
    fecharEditorVideo();
    videoPreview.classList.add('hidden');
    canvas.classList.remove('hidden');
    toolbar.classList.remove('hidden');

    currentImage = new Image();
    currentImage.onload = () => {
      canvas.width = currentImage.width;
      canvas.height = currentImage.height;
      drawCanvas();
    };
    currentImage.src = item.original || item.dataUrl;
  } else {
    canvas.classList.add('hidden');
    toolbar.classList.add('hidden');
    videoPreview.classList.remove('hidden');
    abrirEditorVideo(item);
  }
}

function drawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(currentImage, 0, 0);

  const item = evidences[activeIndex];
  if (item && item.highlights) item.highlights.forEach(desenharDestaque);
}

// Espessura proporcional ao tamanho do print, para continuar visível no slide
function espessura() { return Math.max(5, Math.round(Math.max(canvas.width, canvas.height) / 300)); }
function desenharDestaque(r) {
  ctx.save();
  ctx.strokeStyle = '#E30613';
  ctx.lineWidth = espessura();
  ctx.lineJoin = 'round';
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  startX = (e.clientX - rect.left) * scaleX;
  startY = (e.clientY - rect.top) * scaleY;
  isDrawing = true;
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const currentX = (e.clientX - rect.left) * scaleX;
  const currentY = (e.clientY - rect.top) * scaleY;

  drawCanvas();
  desenharDestaque({ x: startX, y: startY, w: currentX - startX, h: currentY - startY });
});

canvas.addEventListener('mouseup', (e) => {
  if (!isDrawing) return;
  isDrawing = false;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const endX = (e.clientX - rect.left) * scaleX;
  const endY = (e.clientY - rect.top) * scaleY;

  const item = evidences[activeIndex];
  const r = { x: Math.min(startX, endX), y: Math.min(startY, endY), w: Math.abs(endX - startX), h: Math.abs(endY - startY) };
  if (r.w > 8 && r.h > 8) item.highlights.push(r); // ignora cliques sem arrastar
  drawCanvas();
  item.dataUrl = canvas.toDataURL('image/png');
  renderThumbnails();
});
canvas.addEventListener('mouseleave', () => { if (isDrawing) { isDrawing = false; drawCanvas(); } });

document.getElementById('btnUndoHighlight').addEventListener('click', () => {
  const item = evidences[activeIndex];
  if (item && item.highlights) {
    item.highlights.pop();
    drawCanvas();
    item.dataUrl = item.highlights.length ? canvas.toDataURL('image/png') : item.original;
    renderThumbnails();
  }
});

document.getElementById('btnClearHighlights').addEventListener('click', () => {
  const item = evidences[activeIndex];
  if (item && item.highlights) {
    item.highlights = [];
    drawCanvas();
    item.dataUrl = item.original || item.dataUrl;
    renderThumbnails();
  }
});

// 7. Geração com Alertas Nativos
document.getElementById('btnGeneratePPT').addEventListener('click', async () => {
  const status = document.getElementById('finalStatus').value;
  if (!status) return window.api.showError('Informação Faltante', 'Por favor, escolha o Status Final do Teste antes de gerar.');

  const settings = await window.api.getSettings();

  const payload = {
    storyId: document.getElementById('storyId').value,
    testCaseId: document.getElementById('testCaseId').value,
    author: document.getElementById('author').value,
    environment: document.getElementById('environment').value,
    version: document.getElementById('version').value,
    title: document.getElementById('testTitle').value,
    bddText: document.getElementById('bddText').value,
    status: status,
    dateTime: new Date().toLocaleString('pt-BR'),
    jiraBaseUrl: settings.jiraUrl,
    evidences: evidences.map(e => e.type === 'image'
      ? { type: 'image', dataUrl: e.dataUrl, width: e.width, height: e.height }
      : { type: 'video', filePath: e.filePath, cover: e.cover, width: e.width, height: e.height })
  };

  const res = await window.api.generatePptx(payload);
  if (res.success) {
    window.api.showMessage('Apresentação Gerada', `PPTX gerado com sucesso!\nSalvo em:\n${res.filePath}`);
    
    let currentCT = document.getElementById('testCaseId').value;
    let ctMatch = currentCT.match(/\d+/);
    if (ctMatch) {
      let num = parseInt(ctMatch[0]) + 1;
      let nextCT = currentCT.replace(/\d+/, num.toString().padStart(ctMatch[0].length, '0'));
      document.getElementById('testCaseId').value = nextCT;
    }

    document.getElementById('bddText').value = '';
    document.getElementById('testTitle').value = '';
    document.getElementById('finalStatus').value = '';
    evidences = [];
    activeIndex = -1;

    screenReview.classList.add('hidden');
    screenSetup.classList.remove('hidden');
  } else {
    window.api.showError('Erro ao Gerar', 'Ocorreu um erro ao gerar o PPTX: ' + res.error);
  }
});

// Modal de Configurações
document.getElementById('btnSettings').addEventListener('click', async () => {
  const cfg = await window.api.getSettings();
  document.getElementById('cfgSavePath').value = cfg.savePath;
  document.getElementById('cfgJiraUrl').value = cfg.jiraUrl;
  document.getElementById('cfgShortcutPrint').value = cfg.shortcutPrint;
  document.getElementById('cfgShortcutRecord').value = cfg.shortcutRecord.replace(/CommandOrControl/gi, 'Ctrl');
  document.getElementById('cfgShortcutFinish').value = cfg.shortcutFinish.replace(/CommandOrControl/gi, 'Ctrl');
  document.getElementById('cfgShortcutPause').value = (cfg.shortcutPause || 'CommandOrControl+Shift+P').replace(/CommandOrControl/gi, 'Ctrl');
  document.getElementById('cfgDrawCursor').checked = cfg.drawCursor;
  document.getElementById('modalSettings').classList.remove('hidden');
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  await window.api.saveSettings({
    jiraUrl: document.getElementById('cfgJiraUrl').value,
    shortcutPrint: document.getElementById('cfgShortcutPrint').value,
    shortcutRecord: document.getElementById('cfgShortcutRecord').value,
    shortcutFinish: document.getElementById('cfgShortcutFinish').value,
    shortcutPause: document.getElementById('cfgShortcutPause').value,
    drawCursor: document.getElementById('cfgDrawCursor').checked
  });
  document.getElementById('modalSettings').classList.add('hidden');
});

document.getElementById('btnSelectFolder').addEventListener('click', async () => {
  const newPath = await window.api.selectFolder();
  document.getElementById('cfgSavePath').value = newPath;
});

document.getElementById('btnCloseSettings').addEventListener('click', () => {
  document.getElementById('modalSettings').classList.add('hidden');
});

// Capturar mais: volta ao teste mantendo o que já foi capturado
document.getElementById('btnResumeCapture').addEventListener('click', () => {
  screenReview.classList.add('hidden');
  screenSetup.classList.remove('hidden');
  iniciarSessao();
});

// Descartar tudo
document.getElementById('btnDiscardAll').addEventListener('click', () => {
  if (!confirm('Descartar todos os prints e vídeos deste cenário?')) return;
  stopStream();
  fecharEditorVideo();
  evidences = [];
  activeIndex = -1;
  document.getElementById('finalStatus').value = '';
  screenReview.classList.add('hidden');
  screenSetup.classList.remove('hidden');
});


// ---------------------------------------------------------------
// 7. Editor de vídeo: recortar início/fim, excluir trechos e dividir.
//    A edição só é aplicada (com corte exato) ao clicar em "Aplicar edição".
// ---------------------------------------------------------------
const ve = {
  el: id => document.getElementById(id),
  item: null, dur: 0, marcando: null, raf: null, tocando: false, processando: false
};

function fmt(t) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
function fmtCurto(t) {
  const m = Math.floor(t / 60), s = Math.round(t - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function edicao() { return ve.item && ve.item.edicao; }

function abrirEditorVideo(item) {
  ve.item = item;
  ve.marcando = null;
  pararPrevia();
  videoPreview.src = item.fileUrl || item.filePath;
  const podeEditar = item.editavel;
  ve.el('videoEditor').classList.toggle('hidden', !podeEditar);
  ve.el('videoSemEdicao').classList.toggle('hidden', !!podeEditar);
  videoPreview.controls = !podeEditar;
  if (!podeEditar) return;
  ve.dur = item.duration || 0;
  if (!item.edicao) item.edicao = { ini: 0, fim: ve.dur, removidos: [], cortes: [] };
  videoPreview.onloadedmetadata = () => {
    if (isFinite(videoPreview.duration) && videoPreview.duration > 0 && !item.duration) {
      ve.dur = videoPreview.duration; item.duration = ve.dur;
      if (!item.edicao.fim) item.edicao.fim = ve.dur;
    }
    videoPreview.currentTime = item.edicao.ini || 0;
    renderEditorVideo();
  };
  renderEditorVideo();
}

function fecharEditorVideo() {
  pararPrevia();
  ve.item = null;
  ve.el('videoEditor').classList.add('hidden');
  ve.el('videoSemEdicao').classList.add('hidden');
  videoPreview.controls = true;
}

const pct = t => (ve.dur ? (t / ve.dur) * 100 : 0) + '%';

function renderEditorVideo() {
  const e = edicao();
  if (!e || !ve.dur) return;
  const t = videoPreview.currentTime || 0;
  ve.el('veTempo').textContent = `${fmt(t)} / ${fmt(ve.dur)}`;
  ve.el('veForaIni').style.width = pct(e.ini);
  ve.el('veForaFim').style.width = ((ve.dur - e.fim) / ve.dur * 100) + '%';
  ve.el('veAlcaIni').style.left = pct(e.ini);
  ve.el('veAlcaFim').style.left = pct(e.fim);
  ve.el('veCabeca').style.left = pct(t);

  ve.el('veRemovidos').innerHTML = e.removidos.map(([a, b], i) =>
    `<div class="ve-removido" style="left:${pct(a)};width:${((b - a) / ve.dur * 100)}%" title="Trecho excluído: ${fmt(a)} a ${fmt(b)}">
       <button data-rem="${i}" title="Manter este trecho">✕</button></div>`).join('');
  ve.el('veCortes').innerHTML = e.cortes.map((c, i) =>
    `<div class="ve-corte" style="left:${pct(c)}" title="Divisão em ${fmt(c)}"><button data-corte="${i}" title="Remover divisão">✕</button></div>`).join('');

  const m = ve.el('veMarcando');
  if (ve.marcando !== null) {
    const a = Math.min(ve.marcando, t), b = Math.max(ve.marcando, t);
    m.style.left = pct(a); m.style.width = ((b - a) / ve.dur * 100) + '%';
    m.classList.remove('hidden');
  } else m.classList.add('hidden');

  const bt = ve.el('veTrecho');
  bt.textContent = ve.marcando === null ? 'Excluir trecho' : 'Fim do trecho';
  bt.classList.toggle('ativo', ve.marcando !== null);
  ve.el('vePlay').textContent = ve.tocando ? '❚❚' : '▶';

  // resumo do resultado
  const partes = calcularPartes();
  const total = partes.flat().reduce((s, [a, b]) => s + (b - a), 0);
  const alterado = temEdicao();
  ve.el('veResumo').innerHTML = ve.processando
    ? '<span class="ve-processando">Aplicando edição… isso leva alguns segundos.</span>'
    : alterado
      ? `Resultado: <b>${fmt(total)}</b> de vídeo${partes.length > 1 ? `, dividido em <b>${partes.length} vídeos</b> (cada um vira um slide)` : ''}. Clique em <b>Aplicar edição</b> para confirmar.`
      : (ve.item && ve.item.origem ? 'Vídeo editado. Use "Desfazer edição" para voltar ao original.' : 'Sem edições.');
  ve.el('veAplicar').disabled = !alterado || ve.processando;
  ve.el('veDesfazer').disabled = ve.processando || (!alterado && !(ve.item && ve.item.origem));
  ['veIni', 'veFim', 'veTrecho', 'veDividir'].forEach(id => ve.el(id).disabled = ve.processando);
}

function temEdicao() {
  const e = edicao();
  if (!e) return false;
  return e.ini > 0.05 || e.fim < ve.dur - 0.05 || e.removidos.length > 0 || e.cortes.length > 0;
}

// Intervalos mantidos, agrupados por parte (cada divisão inicia uma nova parte)
function calcularPartes() {
  const e = edicao();
  if (!e) return [];
  let mantidos = [[e.ini, e.fim]];
  [...e.removidos].sort((x, y) => x[0] - y[0]).forEach(([a, b]) => {
    mantidos = mantidos.flatMap(([s, f]) => {
      if (b <= s || a >= f) return [[s, f]];
      const r = [];
      if (a > s) r.push([s, a]);
      if (b < f) r.push([b, f]);
      return r;
    });
  });
  const cortes = [...e.cortes].filter(c => c > e.ini && c < e.fim).sort((x, y) => x - y);
  const limites = [e.ini, ...cortes, e.fim];
  const partes = [];
  for (let i = 0; i < limites.length - 1; i++) {
    const [p0, p1] = [limites[i], limites[i + 1]];
    const parte = mantidos.map(([s, f]) => [Math.max(s, p0), Math.min(f, p1)]).filter(([s, f]) => f - s >= 0.1);
    if (parte.length) partes.push(parte);
  }
  return partes;
}

function tempoNaLinha(clientX) {
  const r = ve.el('veLinha').getBoundingClientRect();
  return Math.min(ve.dur, Math.max(0, (clientX - r.left) / r.width * ve.dur));
}

function irPara(t) {
  videoPreview.currentTime = Math.min(ve.dur, Math.max(0, t));
  renderEditorVideo();
}

// Clique / arraste na linha do tempo e nas alças
(function () {
  const linha = ve.el('veLinha');
  let arrastando = null;
  linha.addEventListener('pointerdown', ev => {
    if (!ve.item || ve.processando) return;
    const rem = ev.target.closest('[data-rem]'), cor = ev.target.closest('[data-corte]');
    if (rem) { edicao().removidos.splice(+rem.dataset.rem, 1); renderEditorVideo(); return; }
    if (cor) { edicao().cortes.splice(+cor.dataset.corte, 1); renderEditorVideo(); return; }
    arrastando = ev.target.id === 'veAlcaIni' ? 'ini' : ev.target.id === 'veAlcaFim' ? 'fim' : 'cabeca';
    linha.setPointerCapture(ev.pointerId);
    pararPrevia();
    mover(ev);
  });
  linha.addEventListener('pointermove', ev => { if (arrastando) mover(ev); });
  linha.addEventListener('pointerup', () => { arrastando = null; });
  function mover(ev) {
    const t = tempoNaLinha(ev.clientX), e = edicao();
    if (arrastando === 'ini') e.ini = Math.min(t, e.fim - 0.2);
    if (arrastando === 'fim') e.fim = Math.max(t, e.ini + 0.2);
    irPara(arrastando === 'ini' ? e.ini : arrastando === 'fim' ? e.fim : t);
  }
})();

videoPreview.addEventListener('timeupdate', () => { if (ve.item && !ve.tocando) renderEditorVideo(); });

// Prévia: reproduz pulando os trechos excluídos e respeitando início/fim
function tocarPrevia() {
  const e = edicao();
  if (!e) return;
  if (videoPreview.currentTime >= e.fim - 0.05 || videoPreview.currentTime < e.ini) videoPreview.currentTime = e.ini;
  ve.tocando = true;
  videoPreview.play().catch(() => {});
  const passo = () => {
    if (!ve.tocando) return;
    const t = videoPreview.currentTime;
    const rem = e.removidos.find(([a, b]) => t >= a && t < b);
    if (rem) videoPreview.currentTime = rem[1];
    if (t >= e.fim) { pararPrevia(); videoPreview.currentTime = e.fim; }
    renderEditorVideo();
    ve.raf = requestAnimationFrame(passo);
  };
  passo();
}
function pararPrevia() {
  ve.tocando = false;
  cancelAnimationFrame(ve.raf);
  if (!videoPreview.paused) videoPreview.pause();
  if (ve.item) renderEditorVideo();
}
ve.el('vePlay').onclick = () => (ve.tocando ? pararPrevia() : tocarPrevia());
videoPreview.addEventListener('ended', () => pararPrevia());

// Botões de edição (usam a posição atual da linha vermelha)
ve.el('veIni').onclick = () => { const e = edicao(); e.ini = Math.min(videoPreview.currentTime, e.fim - 0.2); renderEditorVideo(); };
ve.el('veFim').onclick = () => { const e = edicao(); e.fim = Math.max(videoPreview.currentTime, e.ini + 0.2); renderEditorVideo(); };
ve.el('veTrecho').onclick = () => {
  const t = videoPreview.currentTime;
  if (ve.marcando === null) { ve.marcando = t; pararPrevia(); }
  else {
    const a = Math.min(ve.marcando, t), b = Math.max(ve.marcando, t);
    if (b - a >= 0.1) edicao().removidos.push([a, b]);
    ve.marcando = null;
  }
  renderEditorVideo();
};
ve.el('veDividir').onclick = () => {
  const e = edicao(), t = videoPreview.currentTime;
  if (t <= e.ini + 0.1 || t >= e.fim - 0.1) return window.api.showError('Dividir vídeo', 'Posicione a linha vermelha dentro do trecho que será mantido para dividir.');
  if (!e.cortes.some(c => Math.abs(c - t) < 0.1)) e.cortes.push(t);
  renderEditorVideo();
};

ve.el('veDesfazer').onclick = () => {
  const item = ve.item;
  if (!item) return;
  if (temEdicao()) {                       // limpa marcações ainda não aplicadas
    item.edicao = { ini: 0, fim: ve.dur, removidos: [], cortes: [] };
    ve.marcando = null;
    renderEditorVideo();
    return;
  }
  if (item.origem) {                       // volta ao vídeo antes da edição aplicada
    const grupo = item.grupo;
    const pos = evidences.findIndex(x => x.grupo === grupo);
    const original = item.origem;
    evidences = evidences.filter(x => x.grupo !== grupo);
    evidences.splice(pos, 0, original);
    selectEvidence(pos);
  }
};

ve.el('veAplicar').onclick = async () => {
  const item = ve.item;
  if (!item || !temEdicao() || ve.processando) return;
  const partes = calcularPartes();
  if (!partes.length) return window.api.showError('Aplicar edição', 'Nenhum trecho do vídeo seria mantido. Ajuste o início, o fim ou os trechos excluídos.');
  pararPrevia();
  ve.processando = true; renderEditorVideo();
  try {
    const novos = await window.api.editVideo(item.filePath, partes);
    const grupo = 'g' + Date.now();
    const pos = evidences.indexOf(item);
    const itens = novos.map((v, i) => ({
      id: Date.now() + i, type: 'video', filePath: v.filePath, fileUrl: v.fileUrl, cover: v.cover,
      width: v.width, height: v.height, duration: v.duration, editavel: true, grupo, origem: item
    }));
    evidences.splice(pos, 1, ...itens);
    ve.processando = false;
    selectEvidence(pos);
  } catch (err) {
    ve.processando = false; renderEditorVideo();
    window.api.showError('Erro ao editar vídeo', String(err && err.message || err));
  }
};

// Atalhos do editor: Espaço reproduz/pausa, ← → avançam meio segundo
document.addEventListener('keydown', ev => {
  if (!ve.item || ve.el('videoEditor').classList.contains('hidden')) return;
  if (ev.target.closest('input, textarea, select')) return;
  if (ev.code === 'Space') { ev.preventDefault(); ve.tocando ? pararPrevia() : tocarPrevia(); }
  if (ev.key === 'ArrowRight') { ev.preventDefault(); irPara(videoPreview.currentTime + 0.5); }
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); irPara(videoPreview.currentTime - 0.5); }
});
