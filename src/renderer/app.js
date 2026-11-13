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
let tipoTeste = 'front';        // 'front' | 'back'
let collectionPath = null;      // collection anexada (back-end)
let modoExecucao = 'nova';      // 'nova' | 'substituir' quando o CT já existe

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
const val = id => document.getElementById(id).value.trim();

function validarCaso() {
  if (!val('storyId')) { window.api.showError('Campo Obrigatório', 'Informe o ID da História antes de continuar.'); return false; }
  if (!val('testCaseId')) { window.api.showError('Campo Obrigatório', 'Informe o Caso de Teste antes de continuar.'); return false; }
  if (!val('testTitle')) { window.api.showError('Campo Obrigatório', 'Informe o Título do Teste antes de continuar.'); return false; }
  if (!val('bddText')) { window.api.showError('Campo Obrigatório', 'Descreva o cenário em BDD (Dado / Quando / Então ou Given / When / Then) antes de continuar.'); return false; }
  const erroBdd = validarBdd(val('bddText'));
  if (erroBdd) { window.api.showError('Cenário BDD incompleto', erroBdd); return false; }
  return true;
}


// Se o CT já existe na história, pergunta se é uma nova execução ou se substitui a última
async function confirmarReexecucao() {
  if (evidences.length) return true; // já está no meio deste cenário ("Capturar mais")
  modoExecucao = 'nova';
  const info = await window.api.cenarioInfo(val('storyId'), val('testCaseId'));
  if (!info) return true;
  const escolha = await window.api.ask({
    titulo: 'Cenário já evidenciado',
    mensagem: `O ${val('testCaseId')} já existe no relatório da ${val('storyId')}.`,
    detalhe: `Última execução: ${info.data}, ${info.status}` + (info.total > 1 ? ` (${info.total} execuções até agora)` : '') +
      `.\n\n"Registrar nova execução" mantém as anteriores no histórico do relatório.\n"Substituir a última" descarta a execução de ${info.data}.`,
    botoes: ['Registrar nova execução', 'Substituir a última', 'Cancelar'],
    cancelar: 2
  });
  if (escolha === 2) return false;
  modoExecucao = escolha === 1 ? 'substituir' : 'nova';
  return true;
}

document.getElementById('btnStartCapture').addEventListener('click', async () => {
  if (!validarCaso()) return;
  if (!selectedSourceId) return window.api.showError('Seleção Obrigatória', 'Selecione uma tela na lista de capturas.');
  if (!(await confirmarReexecucao())) return;
  iniciarSessao();
});

// Back-end sem prints: vai direto para a revisão
document.getElementById('btnReviewNoCapture').addEventListener('click', async () => {
  if (!validarCaso()) return;
  if (!val('apiCurl')) return window.api.showError('Campo Obrigatório', 'Cole o cURL da requisição ou capture ao menos um print.');
  if (!(await confirmarReexecucao())) return;
  showReviewScreen();
});

// Tipo de teste: front-end / back-end
function definirTipo(t) {
  tipoTeste = t === 'back' ? 'back' : 'front';
  document.querySelectorAll('#tipoTeste button').forEach(b => b.classList.toggle('ativo', b.dataset.v === tipoTeste));
  const back = tipoTeste === 'back';
  document.getElementById('cardApi').classList.toggle('hidden', !back);
  document.getElementById('btnReviewNoCapture').classList.toggle('hidden', !back || evidences.length > 0);
  document.getElementById('dicaCapturaBack').classList.toggle('hidden', !back);
  document.getElementById('tituloCaptura').textContent = back ? 'Print do sucesso (tela ou janela para captura)' : 'Selecione a Tela ou Janela para Captura';
  document.getElementById('btnStartCapture').textContent = back ? 'Capturar prints' : 'Iniciar captura';
}
document.querySelectorAll('#tipoTeste button').forEach(b => b.onclick = () => definirTipo(b.dataset.v));

// Collection (opcional)
function mostrarCollection(nome) {
  const el = document.getElementById('collectionNome');
  if (nome) el.textContent = '📎 ' + nome;
  else el.innerHTML = 'Nenhuma collection anexada <b class="recomendado">(recomendado)</b>';
  document.getElementById('btnCollectionRemover').classList.toggle('hidden', !nome);
}
document.getElementById('btnCollection').onclick = async () => {
  const r = await window.api.pickCollection();
  if (r) { collectionPath = r.path; mostrarCollection(r.nome); }
};
document.getElementById('btnCollectionRemover').onclick = () => { collectionPath = null; mostrarCollection(null); };

// Ao informar um CT que já existe, preenche título, BDD, tipo e cURL da última execução
// Ao digitar uma história/CT que já existem, traz os dados salvos.
// Só preenche campos vazios (ou preenchidos automaticamente antes), nunca apaga o que a pessoa digitou.
const auto = {};
function preencher(id, valor) {
  const el = document.getElementById(id);
  if (!el.value.trim() || el.value === auto[id]) { el.value = valor || ''; auto[id] = el.value; }
}
let consulta = 0;
async function carregarExistente() {
  const n = ++consulta;
  const story = val('storyId'), ct = val('testCaseId');
  const [hist, info] = await Promise.all([window.api.historiaInfo(story), window.api.cenarioInfo(story, ct)]);
  if (n !== consulta) return; // chegou uma digitação mais nova
  if (hist && hist.titulo) preencher('storyTitle', hist.titulo);
  const box = document.getElementById('ctInfo');
  if (!info) {
    ['testTitle', 'bddText', 'apiCurl'].forEach(id => { if (auto[id] && val(id) === auto[id]) preencher(id, ''); });
    box.classList.add('hidden');
    if (typeof jiraAposCarregar === 'function') jiraAposCarregar(story, ct, null); // preenche pelo plano do Jira
    return;
  }
  if (info.tipo) definirTipo(info.tipo);
  preencher('testTitle', info.titulo);
  preencher('bddText', info.bdd);
  if (info.api) preencher('apiCurl', info.api.curl);
  box.textContent = `Já evidenciado · ${info.status} · ${info.data}` + (info.total > 1 ? ` · ${info.total} execuções` : '');
  box.title = 'Título e BDD preenchidos com a última execução deste cenário';
  box.classList.remove('hidden');
  if (typeof jiraAposCarregar === 'function') jiraAposCarregar(story, ct, info);
}
let espera;
['storyId', 'testCaseId'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(carregarExistente, 350); });
  el.addEventListener('change', carregarExistente);
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
  const resumo = document.getElementById('apiResumo');
  const curl = val('apiCurl');
  if (tipoTeste === 'back' && (curl || collectionPath)) {
    resumo.innerHTML = '<b>Requisição</b>' + (collectionPath ? ` <span class="opcional">(com collection anexada)</span>` : '') + (curl ? `<pre></pre>` : '');
    if (curl) resumo.querySelector('pre').textContent = curl;
    resumo.classList.remove('hidden');
  } else resumo.classList.add('hidden');
  renderThumbnails();
  atualizarVazio();
}

function atualizarVazio() {
  document.getElementById('semEvidencias').classList.toggle('hidden', evidences.length > 0);
  if (!evidences.length) {
    canvas.classList.add('hidden'); videoPreview.classList.add('hidden');
    document.getElementById('canvasToolbar').classList.add('hidden');
    document.getElementById('legendaLinha').classList.add('hidden');
  }
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
  else { fecharEditorVideo(); atualizarVazio(); }
};

// ---- Prints e vídeos de fora do app: anexar arquivo ou colar (Ctrl+V) ----
function adicionarImagem(dataUrl, width, height, legenda = '') {
  evidences.push({ id: Date.now() + Math.random(), type: 'image', original: dataUrl, dataUrl, width, height, highlights: [], legenda });
}
function aposAdicionar(qtd) {
  if (!qtd) return;
  activeIndex = evidences.length - qtd;
  updateStats();
  renderThumbnails();
  selectEvidence(activeIndex);
  atualizarVazio();
}

document.getElementById('btnAnexar').addEventListener('click', async () => {
  const btn = document.getElementById('btnAnexar');
  const texto = btn.textContent;
  btn.disabled = true; btn.textContent = 'Anexando…';
  try {
    const itens = await window.api.attachFiles();
    const erros = itens.filter(i => i.type === 'erro');
    let qtd = 0;
    for (const i of itens) {
      if (i.type === 'image') { adicionarImagem(i.dataUrl, i.width, i.height); qtd++; }
      else if (i.type === 'video') {
        evidences.push({ id: Date.now() + Math.random(), type: 'video', filePath: i.filePath, fileUrl: i.fileUrl, cover: i.cover,
          width: i.width, height: i.height, duration: i.duration || null, editavel: !!i.editavel });
        qtd++;
      }
    }
    aposAdicionar(qtd);
    if (erros.length) window.api.showError('Anexar', 'Não foi possível anexar: ' + erros.map(e => e.nome).join(', '));
  } finally {
    btn.disabled = false; btn.textContent = texto;
  }
});

document.addEventListener('paste', e => {
  if (screenReview.classList.contains('hidden')) return;
  const itens = [...(e.clipboardData && e.clipboardData.items || [])];
  const imgs = itens.filter(i => i.type.startsWith('image/'));
  if (!imgs.length) return;
  // colando texto num campo (ex.: do Excel/Word, que também copiam uma imagem): mantém o texto
  if (e.target.closest('input, textarea') && itens.some(i => i.type === 'text/plain')) return;
  e.preventDefault();
  let pendentes = imgs.length, qtd = 0;
  imgs.forEach(it => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => {
        adicionarImagem(leitor.result, img.naturalWidth, img.naturalHeight); qtd++;
        if (--pendentes === 0) aposAdicionar(qtd);
      };
      img.onerror = () => { if (--pendentes === 0) aposAdicionar(qtd); };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(it.getAsFile());
  });
});

document.getElementById('legenda').addEventListener('input', e => {
  if (evidences[activeIndex]) evidences[activeIndex].legenda = e.target.value;
});

// 6. Editor de Anotações
let isDrawing = false;
let startX, startY;
let currentImage = new Image();

function selectEvidence(idx) {
  activeIndex = idx;
  renderThumbnails();

  const item = evidences[idx];
  document.getElementById('legendaLinha').classList.remove('hidden');
  document.getElementById('legenda').value = item.legenda || '';
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

// 7. Gerar evidência: salva o cenário, atualiza o relatório da história e/ou gera o PPT
try {
  const pref = JSON.parse(localStorage.getItem('saidas') || 'null');
  if (pref) { document.getElementById('outRelatorio').checked = !!pref.relatorio; document.getElementById('outPpt').checked = !!pref.ppt; }
} catch {}

// Observação só aparece quando o teste não passou
const STATUS_COM_OBS = ['Falhou', 'Bloqueado'];
function atualizarObservacao() {
  const v = document.getElementById('finalStatus').value;
  document.getElementById('grupoObservacao').classList.toggle('hidden', !STATUS_COM_OBS.includes(v));
}
document.getElementById('finalStatus').addEventListener('change', atualizarObservacao);

document.getElementById('btnGeneratePPT').addEventListener('click', async () => {
  const status = document.getElementById('finalStatus').value;
  if (!status) return window.api.showError('Informação Faltante', 'Escolha o Status do Teste antes de gerar.');
  const erroBdd = validarBdd(val('bddText'));
  if (erroBdd) return window.api.showError('Cenário BDD incompleto', erroBdd);
  const saidas = { relatorio: document.getElementById('outRelatorio').checked, ppt: document.getElementById('outPpt').checked };
  if (!saidas.relatorio && !saidas.ppt) return window.api.showError('Nada para gerar', 'Marque "Relatório da história" e/ou "PPT do cenário".');
  if (!evidences.length && !(tipoTeste === 'back' && val('apiCurl'))) return window.api.showError('Sem evidências', 'Capture ao menos um print ou vídeo.');
  try { localStorage.setItem('saidas', JSON.stringify(saidas)); } catch {}

  const settings = await window.api.getSettings();
  const btn = document.getElementById('btnGeneratePPT');
  btn.disabled = true; btn.textContent = 'Gerando…';

  const dados = {
    storyId: val('storyId'),
    storyTitle: val('storyTitle'),
    testCaseId: val('testCaseId'),
    tipo: tipoTeste,
    author: val('author'),
    environment: document.getElementById('environment').value,
    version: val('version'),
    title: val('testTitle'),
    bddText: document.getElementById('bddText').value,
    status,
    observacao: STATUS_COM_OBS.includes(status) ? val('observacao') : '',
    dateTime: new Date().toLocaleString('pt-BR'),
    jiraBaseUrl: settings.jiraUrl,
    api: tipoTeste === 'back' ? { curl: document.getElementById('apiCurl').value, collectionPath } : null,
    evidences: evidences.map(e => e.type === 'image'
      ? { type: 'image', dataUrl: e.dataUrl, width: e.width, height: e.height, legenda: e.legenda || '' }
      : { type: 'video', filePath: e.filePath, cover: e.cover, width: e.width, height: e.height, duration: e.duration, legenda: e.legenda || '' }),
    // positivo/negativo, critérios cobertos e origem do cenário (jira-ui.js)
    ...(typeof jiraDadosExecucao === 'function' ? jiraDadosExecucao() : {})
  };

  const res = await window.api.generateEvidence(dados, modoExecucao, saidas);
  btn.disabled = false; btn.textContent = 'Gerar evidência';
  if (!res.success) return window.api.showError('Erro ao gerar', 'Ocorreu um erro ao gerar a evidência: ' + res.error);
  if (typeof jiraAposGerar === 'function') await jiraAposGerar(res, dados);

  const botoes = [];
  if (res.relatorio) botoes.push('Abrir relatório');
  if (res.bug) botoes.push('Abrir relatório do bug');
  if (res.ppt) botoes.push('Abrir PPT');
  botoes.push('Abrir pasta', 'OK');
  const escolha = await window.api.ask({
    titulo: 'Evidência gerada',
    mensagem: `${dados.testCaseId} salvo${res.execucao > 1 ? ` (${res.execucao}ª execução)` : ''}.`,
    detalhe: [res.relatorio ? `Relatório da ${dados.storyId} atualizado.` : '', res.bug ? 'Relatório para abertura de bug gerado (pasta Bugs).' : '', res.ppt ? 'PPT do cenário gerado.' : '', `Pasta: ${res.pasta}`].filter(Boolean).join('\n'),
    botoes, cancelar: botoes.length - 1
  });
  const acao = botoes[escolha];
  if (acao === 'Abrir relatório') window.api.openPath(res.relatorio);
  if (acao === 'Abrir relatório do bug') window.api.openPath(res.bug);
  if (acao === 'Abrir PPT') window.api.openPath(res.ppt);
  if (acao === 'Abrir pasta') window.api.openPath(res.pasta);

  // Próximo cenário: mantém história, ambiente e tipo; avança o CT
  // (com plano do Jira, vai para o próximo CT ainda não executado)
  const proximo = typeof jiraProximoCt === 'function' ? jiraProximoCt(dados.testCaseId) : null;
  const ctMatch = val('testCaseId').match(/\d+/);
  if (proximo) document.getElementById('testCaseId').value = proximo;
  else if (ctMatch) document.getElementById('testCaseId').value = val('testCaseId').replace(/\d+/, String(parseInt(ctMatch[0]) + 1).padStart(ctMatch[0].length, '0'));
  ['bddText', 'testTitle', 'apiCurl', 'observacao'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('finalStatus').value = '';
  atualizarObservacao();
  collectionPath = null; mostrarCollection(null);
  modoExecucao = 'nova';
  carregarExistente();
  fecharEditorVideo();
  evidences = [];
  activeIndex = -1;
  screenReview.classList.add('hidden');
  screenSetup.classList.remove('hidden');
  atualizarBotaoRevisao();
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
  if (typeof jiraAbrirConfig === 'function') await jiraAbrirConfig();
  document.getElementById('modalSettings').classList.remove('hidden');
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  if (typeof jiraSalvarConfig === 'function' && !(await jiraSalvarConfig())) return;
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

// Voltar: retorna aos dados do cenário mantendo prints, vídeos, destaques e legendas
function atualizarBotaoRevisao() {
  const tem = evidences.length > 0;
  const btn = document.getElementById('btnIrRevisao');
  btn.classList.toggle('hidden', !tem);
  btn.textContent = `Voltar para a revisão (${evidences.length} ${evidences.length === 1 ? 'item' : 'itens'})`;
  document.getElementById('btnReviewNoCapture').classList.toggle('hidden', tem || tipoTeste !== 'back');
}
document.getElementById('btnVoltar').addEventListener('click', () => {
  document.querySelectorAll('#screenReview video').forEach(v => { try { v.pause(); } catch {} });
  screenReview.classList.add('hidden');
  screenSetup.classList.remove('hidden');
  atualizarBotaoRevisao();
  window.scrollTo(0, 0);
});
document.getElementById('btnIrRevisao').addEventListener('click', () => {
  if (!validarCaso()) return;
  showReviewScreen();
});

// Descartar tudo
document.getElementById('btnDiscardAll').addEventListener('click', () => {
  if (!confirm('Descartar todos os prints e vídeos deste cenário?')) return;
  stopStream();
  fecharEditorVideo();
  document.getElementById('observacao').value = '';
  modoExecucao = 'nova';
  evidences = [];
  activeIndex = -1;
  document.getElementById('finalStatus').value = '';
  atualizarObservacao();
  screenReview.classList.add('hidden');
  screenSetup.classList.remove('hidden');
  atualizarBotaoRevisao();
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
