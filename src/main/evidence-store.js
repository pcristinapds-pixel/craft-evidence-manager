// Armazena as evidências por história e cenário, com histórico de execuções.
//
//   <pasta de evidências>/
//     QMS-1036/
//       historia.json                     título e link da história
//       QMS-1036 - Relatório de evidências.html
//       CT01/
//         cenario.json                    todas as execuções do cenário
//         exec-1/ passo-1.png, video-1.mp4, collection.json
//         exec-2/ ...
const fs = require('fs');
const path = require('path');
const { mascarar } = require('./mascarar');

const seguro = s => String(s || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim() || 'sem-id';

function pastaHistoria(base, storyId) { return path.join(base, seguro(storyId)); }
function pastaCenario(base, storyId, ct) { return path.join(pastaHistoria(base, storyId), seguro(ct)); }

function lerJson(arq, padrao = null) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}
function gravarJson(arq, obj) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = arq + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, arq);
}

function lerCenario(base, storyId, ct) {
  return lerJson(path.join(pastaCenario(base, storyId, ct), 'cenario.json'));
}

// Resumo da última execução, para avisar o QA antes de reexecutar
function ultimaExecucao(base, storyId, ct) {
  const c = lerCenario(base, storyId, ct);
  if (!c || !c.execucoes || !c.execucoes.length) return null;
  const u = c.execucoes[c.execucoes.length - 1];
  return { execucao: u.execucao, total: c.execucoes.length, data: u.data, status: u.status, titulo: u.titulo, bdd: u.bdd, tipo: u.tipo, natureza: u.natureza || null, criterios: u.criterios || [], api: u.api ? { curl: u.api.curl } : null };
}

// Dados já salvos da história (título)
function infoHistoria(base, storyId) {
  if (!storyId) return null;
  return lerJson(path.join(pastaHistoria(base, storyId), 'historia.json'), null);
}

function dataUrlParaBuffer(dataUrl) {
  return Buffer.from(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1), 'base64');
}

/**
 * Salva uma execução do cenário.
 * @param modo 'nova' (mantém as anteriores no histórico) ou 'substituir' (troca a última)
 */
function salvarExecucao(base, d, modo = 'nova') {
  const dirCt = pastaCenario(base, d.storyId, d.testCaseId);
  fs.mkdirSync(dirCt, { recursive: true });
  const arqCen = path.join(dirCt, 'cenario.json');
  const cen = lerJson(arqCen, { ct: d.testCaseId, execucoes: [] });

  let n = cen.execucoes.length + 1;
  if (modo === 'substituir' && cen.execucoes.length) {
    const ult = cen.execucoes.pop();
    n = ult.execucao;
    fs.rmSync(path.join(dirCt, `exec-${n}`), { recursive: true, force: true });
  }
  const pastaExec = `exec-${n}`;
  const dirExec = path.join(dirCt, pastaExec);
  fs.mkdirSync(dirExec, { recursive: true });

  // mídias
  let p = 0, v = 0;
  const evidencias = (d.evidences || []).map(e => {
    if (e.type === 'image') {
      const arq = `passo-${++p}.png`;
      fs.writeFileSync(path.join(dirExec, arq), dataUrlParaBuffer(e.dataUrl));
      return { tipo: 'print', passo: p, arquivo: `${pastaExec}/${arq}`, legenda: e.legenda || '', largura: e.width, altura: e.height };
    }
    const ext = path.extname(e.filePath || '.mp4') || '.mp4';
    const arq = `video-${++v}${ext}`;
    if (e.filePath && fs.existsSync(e.filePath)) fs.copyFileSync(e.filePath, path.join(dirExec, arq));
    return { tipo: 'video', arquivo: `${pastaExec}/${arq}`, legenda: e.legenda || '', duracao: e.duration || null, largura: e.width, altura: e.height };
  });

  // requisição (back-end): cURL para o dev reproduzir, sem segredos, e collection opcional
  let api = null;
  if (d.api && (d.api.curl || d.api.collectionPath)) {
    api = { curl: mascarar(d.api.curl || ''), collection: null };
    if (d.api.collectionPath && fs.existsSync(d.api.collectionPath)) {
      const nome = path.basename(d.api.collectionPath);
      fs.copyFileSync(d.api.collectionPath, path.join(dirExec, nome));
      api.collection = `${pastaExec}/${nome}`;
    }
  }

  const agora = new Date();
  cen.ct = d.testCaseId;
  cen.execucoes.push({
    execucao: n,
    data: agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    dataISO: agora.toISOString(),
    tipo: d.tipo === 'back' ? 'back' : 'front',
    titulo: d.title, bdd: d.bddText,
    responsavel: d.author, ambiente: d.environment, versao: d.version,
    status: d.status, observacao: d.observacao || '',
    natureza: d.natureza === 'negativo' ? 'negativo' : (d.natureza === 'positivo' ? 'positivo' : null),
    criterios: Array.isArray(d.criterios) ? d.criterios : [],
    origem: d.origem || null,
    api, evidencias
  });
  gravarJson(arqCen, cen);

  // dados da história
  const arqHist = path.join(pastaHistoria(base, d.storyId), 'historia.json');
  const hist = lerJson(arqHist, { id: d.storyId });
  hist.id = d.storyId;
  if (d.storyTitle) hist.titulo = d.storyTitle;
  gravarJson(arqHist, hist);

  const videos = evidencias.filter(e => e.tipo === 'video').map(e => {
    const abs = path.join(dirCt, ...e.arquivo.split('/'));
    return { original: abs, relatorio: versaoRelatorio(abs) };
  });
  return { pastaHistoria: pastaHistoria(base, d.storyId), pastaCenario: dirCt, execucao: n, videos };
}

// Caminho da versão leve do vídeo (a que vai embutida no relatório)
function versaoRelatorio(arq) { return arq.replace(/\.[^.\/\\]+$/, '') + '-relatorio.mp4'; }

// Lista os cenários da história em ordem natural (CT01, CT02, ..., CT10)
function listarCenarios(base, storyId) {
  const dir = pastaHistoria(base, storyId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => { const c = lerJson(path.join(dir, e.name, 'cenario.json')); return c && { pasta: e.name, ...c }; })
    .filter(c => c && c.execucoes && c.execucoes.length)
    .sort((a, b) => a.pasta.localeCompare(b.pasta, 'pt-BR', { numeric: true }));
}

// ------------------------------------------------------------------
// Dados do Jira e do plano, guardados em historia.json:
//   jira       { projeto, tipo, status, campoDescricao, lidoEm, atualizadoEm }
//   criterios  { leitura (de lerCriterios), assinatura, mudou, confirmados, ajustes }
//   plano      { subtarefa, lidoEm, cenarios: [{ ct, numero, titulo, bdd, origem, topoIni, topoFim }] }
//   regras     [{ titulo, texto, autor, data, comentarioId }]
//   cobertura  { CT01: ['CA3', 'CA7'] }
//   natureza   { CT01: 'positivo' }
// O que a pessoa ajustou (cobertura, ajustes dos critérios, cenários editados no app)
// nunca é sobrescrito por uma nova leitura do Jira.
// ------------------------------------------------------------------
function lerHistoria(base, storyId) {
  return lerJson(path.join(pastaHistoria(base, storyId), 'historia.json'), { id: storyId });
}
function gravarHistoria(base, storyId, h) {
  gravarJson(path.join(pastaHistoria(base, storyId), 'historia.json'), h);
  return h;
}
const assinaturaCriterios = leitura => JSON.stringify(((leitura && leitura.grupos) || []).map(g => [g.nome, g.criterios.map(c => [c.texto, c.subitens.map(x => x.texto)])]));

// Grava o que veio do Jira. Devolve a história atualizada.
function salvarDadosJira(base, storyId, { titulo, jira, criterios, plano, regras } = {}) {
  const h = lerHistoria(base, storyId);
  h.id = storyId;
  if (titulo) h.titulo = titulo;
  if (jira) h.jira = { ...(h.jira || {}), ...jira, lidoEm: new Date().toISOString() };
  if (criterios) {
    const assinatura = assinaturaCriterios(criterios);
    const antes = h.criterios || {};
    h.criterios = {
      ...antes,
      leitura: criterios,
      assinatura,
      // critérios mudaram no Jira depois da conferência: a tela avisa antes de usar
      mudou: !!(antes.confirmados && antes.assinatura && antes.assinatura !== assinatura),
      ajustes: antes.ajustes || {}
    };
  }
  if (plano) {
    const locais = ((h.plano && h.plano.cenarios) || []).filter(c => c.origem && c.origem !== 'plano' && !c.gravadoNoJira);
    const anteriores = new Map(((h.plano && h.plano.cenarios) || []).map(c => [c.ct, c]));
    const doJira = plano.cenarios.map(c => {
      const ant = anteriores.get(c.ct);
      const novo = { ...c, origem: 'plano' };
      if (!ant) return novo;
      const mudouNoJira = ant.lidoDoJira && (ant.lidoDoJira.titulo !== c.titulo || ant.lidoDoJira.bdd !== c.bdd);
      novo.lidoDoJira = { titulo: c.titulo, bdd: c.bdd };
      // edição local ainda não gravada no Jira: fica a do app, e a do Jira vai junto para comparar
      if (ant.editadoEm && !ant.gravadoNoJira) {
        return { ...novo, titulo: ant.titulo, bdd: ant.bdd, editadoEm: ant.editadoEm, ...(mudouNoJira ? { conflito: true } : {}) };
      }
      return mudouNoJira ? { ...novo, mudouNoJira: true } : novo;
    }).map(c => (c.lidoDoJira ? c : { ...c, lidoDoJira: { titulo: c.titulo, bdd: c.bdd } }));
    const cts = new Set(doJira.map(c => c.ct));
    h.plano = { subtarefa: plano.subtarefa, ...(h.plano && h.plano.subtarefaEscolhida ? { subtarefaEscolhida: h.plano.subtarefaEscolhida } : {}), lidoEm: new Date().toISOString(), atualizadoEm: plano.atualizadoEm || null, cenarios: [...doJira, ...locais.filter(c => !cts.has(c.ct))] };
  }
  if (regras) h.regras = regras;
  h.cobertura = h.cobertura || {};
  h.natureza = h.natureza || {};
  return gravarHistoria(base, storyId, h);
}

// Conferência dos critérios: { subitens, ignorados, naoSeAplica }
function salvarAjustesCriterios(base, storyId, ajustes) {
  const h = lerHistoria(base, storyId);
  h.criterios = { ...(h.criterios || {}), ajustes: ajustes || {}, confirmados: true, mudou: false };
  return gravarHistoria(base, storyId, h);
}

function definirCobertura(base, storyId, ct, ids) {
  const h = lerHistoria(base, storyId);
  h.cobertura = { ...(h.cobertura || {}), [ct]: [...new Set(ids || [])] };
  return gravarHistoria(base, storyId, h);
}

function definirNatureza(base, storyId, ct, natureza) {
  const h = lerHistoria(base, storyId);
  h.natureza = { ...(h.natureza || {}), [ct]: natureza === 'negativo' ? 'negativo' : 'positivo' };
  return gravarHistoria(base, storyId, h);
}

// Cenário editado no app: atualiza o plano local e TODAS as execuções já feitas desse CT
// (decisão do time: o relatório mostra sempre o texto atual do cenário).
function atualizarCenario(base, storyId, ct, { titulo, bdd, gravadoNoJira = false }) {
  const h = lerHistoria(base, storyId);
  const cenarios = (h.plano && h.plano.cenarios) || [];
  const c = cenarios.find(x => x.ct === ct);
  if (c) {
    if (titulo != null) c.titulo = titulo;
    if (bdd != null) c.bdd = bdd;
    c.editadoEm = new Date().toISOString();
    c.gravadoNoJira = !!gravadoNoJira;
    delete c.conflito; delete c.mudouNoJira;
    if (gravadoNoJira) c.lidoDoJira = { titulo: c.titulo, bdd: c.bdd };
  }
  gravarHistoria(base, storyId, h);
  const arq = path.join(pastaCenario(base, storyId, ct), 'cenario.json');
  const cen = lerJson(arq, null);
  if (cen && cen.execucoes) {
    cen.execucoes.forEach(ex => { if (titulo != null) ex.titulo = titulo; if (bdd != null) ex.bdd = bdd; });
    gravarJson(arq, cen);
  }
  return h;
}

// Cenário novo criado no app (para um critério descoberto ou uma regra de comentário)
function adicionarCenario(base, storyId, { titulo, bdd, origem = 'app', origemDetalhe = '', criterios = [] }) {
  const h = lerHistoria(base, storyId);
  h.plano = h.plano || { subtarefa: null, cenarios: [] };
  const usados = h.plano.cenarios.map(c => c.numero || Number(String(c.ct).replace(/\D/g, '')) || 0);
  const numero = (usados.length ? Math.max(...usados) : 0) + 1;
  const ct = 'CT' + String(numero).padStart(2, '0');
  h.plano.cenarios.push({ ct, numero, titulo, bdd, origem, origemDetalhe, criadoEm: new Date().toISOString() });
  if (criterios.length) h.cobertura = { ...(h.cobertura || {}), [ct]: criterios };
  gravarHistoria(base, storyId, h);
  return { ct, numero, historia: h };
}

module.exports = { lerHistoria, gravarHistoria, salvarDadosJira, salvarAjustesCriterios, definirCobertura, definirNatureza, atualizarCenario, adicionarCenario, infoHistoria, pastaHistoria, pastaCenario, lerCenario, ultimaExecucao, salvarExecucao, listarCenarios, lerJson, seguro, versaoRelatorio };
