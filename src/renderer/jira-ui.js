// Interface da integração com o Jira: tela "Minhas sub-tasks", lateral com plano e
// critérios, conferência dos critérios, edição sincronizada do cenário, positivo/negativo,
// cobertura e conexão nas configurações.
// Usa funções do app.js (val, preencher, carregarExistente, definirTipo, evidences...).

const J = {
  config: null,          // { site, email, temToken, prefixoPlano }
  visao: null,           // dados da história (montarVisao no processo principal)
  ctAtual: null,
  base: null,            // título e BDD do CT como estão no plano (para saber se foi editado)
  natureza: 'positivo', naturezaManual: false,
  cobre: [], verTodosCriterios: false,
  minhas: [],
  tokenRecusado: false,
  ajustes: null,         // rascunho da conferência
  gruposAbertos: new Set()
};
const $j = id => document.getElementById(id);
const escJ = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CLASSE_STATUS = { 'Passou': 'passou', 'Falhou': 'falhou', 'Bloqueado': 'bloqueado', 'Não executado': 'pendente' };
const pillStatus = st => `<span class="pill ${CLASSE_STATUS[st] || 'pendente'}">${escJ(st === 'Não executado' ? 'Pendente' : st)}</span>`;
const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
const jiraConfigurado = () => !!(J.config && J.config.site && J.config.email && J.config.temToken);
const telas = ['screenMinhas', 'screenSetup', 'screenReview', 'screenConferir'];
function mostrarTela(id) { telas.forEach(t => $j(t).classList.toggle('hidden', t !== id)); window.scrollTo(0, 0); }

// positivo/negativo sugerido pelo texto (mesma regra do processo principal)
const NEGATIVO_UI = /\b(nao|nenhum|nenhuma|sem|erro|invalid[oa]s?|bloquead[oa]s?|recusad[oa]s?|negad[oa]s?|falha|impedi[rd]|inexistente|vencid[oa]|expirad[oa]|inelegivel|not|no|without|error|invalid|denied|blocked|fail)\b/;
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sugerirNaturezaUI = bdd => NEGATIVO_UI.test(semAcento(bdd)) ? 'negativo' : 'positivo';

// ---------------------------------------------------------------- selo de conexão

function atualizarSelo() {
  const selo = $j('jiraSelo');
  if (!jiraConfigurado()) { selo.classList.add('hidden'); return; }
  selo.classList.remove('hidden');
  selo.classList.toggle('erro', J.tokenRecusado);
  selo.textContent = J.tokenRecusado ? 'Token expirado · Corrigir' : 'Jira conectado';
  selo.title = J.tokenRecusado ? 'O Jira recusou seu token de API. Clique para trocar.' : 'Conexão com o Jira';
}
$j('jiraSelo').onclick = () => $j('btnSettings').click();

// Trata um erro vindo do processo principal. Devolve true se era token recusado.
function erroJira(r, titulo = 'Jira') {
  if (r.tipo === 'token') { J.tokenRecusado = true; atualizarSelo(); return true; }
  window.api.showError(titulo, r.erro || 'Erro ao falar com o Jira.');
  return false;
}

// ---------------------------------------------------------------- tela inicial

async function iniciarJira() {
  J.config = await window.api.jiraConfig();
  atualizarSelo();
  if (!jiraConfigurado()) {
    // sem Jira: o app funciona como antes, com a tela do caso de teste
    $j('btnSetupVoltar').classList.add('hidden');
    mostrarTela('screenSetup');
    return;
  }
  mostrarTela('screenMinhas');
  carregarMinhas();
}

async function carregarMinhas() {
  const lista = $j('listaMinhas');
  $j('semJira').classList.toggle('hidden', jiraConfigurado());
  lista.classList.toggle('hidden', !jiraConfigurado());
  if (!jiraConfigurado()) return;
  lista.innerHTML = '<div class="vazio-lista">Buscando suas sub-tasks no Jira…</div>';
  const r = await window.api.jiraMinhas({ soQa: $j('filtroQa').checked });
  const aviso = $j('minhasAviso');
  aviso.classList.add('hidden');
  if (!r.ok) {
    const token = erroJira(r, 'Minhas sub-tasks');
    lista.innerHTML = `<div class="vazio-lista">${token ? 'O Jira recusou seu token de API.' : escJ(r.erro)}</div>`;
    if (token) mostrarAvisoToken(aviso, 'Não foi possível ler suas sub-tasks.');
    return;
  }
  const d = r.dados;
  if (d.doCache) {
    if (d.tipo === 'token') { J.tokenRecusado = true; atualizarSelo(); mostrarAvisoToken(aviso, `Mostrando a última lista lida às ${hora(d.lidoEm)}. Dá para continuar evidenciando.`); }
    else { aviso.innerHTML = `<span><b>Sem conexão com o Jira.</b> Mostrando a última lista lida às ${hora(d.lidoEm)}.</span>`; aviso.classList.remove('hidden'); }
  } else { J.tokenRecusado = false; atualizarSelo(); }
  J.minhas = d.lista;
  $j('minhasInfo').textContent = `${d.lista.length} atribuída${d.lista.length === 1 ? '' : 's'} a você · ${d.doCache ? 'última leitura' : 'lidas do Jira'} às ${hora(d.lidoEm)}`;
  const projetos = [...new Map(d.lista.filter(s => s.projeto).map(s => [s.projeto.chave, s.projeto.nome])).entries()];
  const sel = $j('filtroProjeto'), atual = sel.value;
  sel.innerHTML = '<option value="">Todos os projetos</option>' + projetos.map(([k, n]) => `<option value="${escJ(k)}">${escJ(n)}</option>`).join('');
  sel.value = projetos.some(([k]) => k === atual) ? atual : '';
  renderMinhas();
}

function mostrarAvisoToken(el, texto) {
  el.innerHTML = `<span><b>O Jira recusou seu token de API.</b> ${escJ(texto)}</span><button class="btn-small btn-danger-solid" id="btnTrocarToken">Trocar token</button>`;
  el.classList.remove('hidden');
  $j('btnTrocarToken').onclick = () => $j('btnSettings').click();
}

function renderMinhas() {
  const q = semAcento($j('filtroMinhas').value.trim());
  const proj = $j('filtroProjeto').value;
  const itens = J.minhas.filter(s => (!proj || (s.projeto && s.projeto.chave === proj)) &&
    (!q || semAcento(`${s.chave} ${s.titulo} ${s.pai ? s.pai.chave + ' ' + s.pai.titulo : ''}`).includes(q)));
  const lista = $j('listaMinhas');
  if (!itens.length) { lista.innerHTML = `<div class="vazio-lista">${J.minhas.length ? 'Nenhuma sub-task com esse filtro.' : 'Nenhuma sub-task aberta no seu nome.'}</div>`; return; }
  const CAT = { new: ['pendente', null], indeterminate: ['andamento', null] };
  lista.innerHTML = `<div class="linha-sub cab"><span>Sub-task</span><span>História</span><span>Status</span><span>Plano</span><span></span></div>` +
    itens.map((s, i) => {
      const a = s.andamento || { executados: 0, total: 0, falharam: 0 };
      const escrever = /an[aá]lise|escrita|cen[aá]rio/i.test(s.titulo) && !a.total;
      const plano = escrever ? '<span style="color:#9A3412;font-weight:600;font-size:12px">Sem cenários</span>'
        : `<div><span style="font-size:12px">${a.total ? `${a.executados} de ${a.total} evidenciados${a.falharam ? ` · ${a.falharam} falhou` : ''}` : 'Plano ainda não lido'}</span><div class="barra"><div style="width:${a.total ? Math.round(a.executados / a.total * 100) : 0}%"></div></div></div>`;
      const acao = escrever ? 'Escrever cenários' : (a.executados ? 'Continuar testes' : 'Começar testes');
      return `<div class="linha-sub">
        <div><div class="chave">${escJ(s.chave)}</div><b style="font-size:13px">${escJ(s.titulo)}</b></div>
        <div><div class="chave">${escJ(s.pai ? s.pai.chave : '')}${s.projeto ? ' · ' + escJ(s.projeto.nome) : ''}</div><span style="font-size:13px">${escJ(s.pai ? s.pai.titulo : '')}</span></div>
        <span><span class="pill ${(CAT[s.statusCategoria] || ['pendente'])[0]}">${escJ(s.status)}</span></span>
        ${plano}
        <button class="acao btn-small ${i === 0 && a.executados ? 'btn-primary' : 'btn-secondary'}" data-hist="${escJ(s.pai ? s.pai.chave : s.chave)}">${acao}</button>
      </div>`;
    }).join('');
  lista.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => abrirHistoria(b.dataset.hist));
}
['filtroMinhas', 'filtroProjeto'].forEach(id => $j(id).addEventListener('input', renderMinhas));
$j('filtroQa').addEventListener('change', carregarMinhas);
$j('btnAtualizarMinhas').onclick = carregarMinhas;
$j('btnBuscaOutra').onclick = () => { const c = $j('buscaOutra').value.trim(); if (c) abrirHistoria(c); };
$j('buscaOutra').addEventListener('keydown', e => { if (e.key === 'Enter') $j('btnBuscaOutra').click(); });
$j('btnConectarJira').onclick = () => $j('btnSettings').click();
$j('btnSemJira').onclick = () => { J.visao = null; renderAside(); mostrarTela('screenSetup'); };

// ---------------------------------------------------------------- abrir uma história

async function abrirHistoria(chave, { selecionar = true } = {}) {
  chave = String(chave || '').trim().toUpperCase();
  if (!chave) return;
  if (evidences.length && J.visao && J.visao.id !== chave && !confirm(`Há ${evidences.length} item(ns) capturado(s) e ainda não salvo(s) da ${J.visao.id}. Abrir outra história mesmo assim?`)) return;
  document.body.style.cursor = 'progress';
  const r = await window.api.jiraHistoria(chave);
  document.body.style.cursor = '';
  let visao;
  if (r.ok) { visao = r.dados; J.tokenRecusado = false; atualizarSelo(); }
  else {
    if (r.tipo === 'epico') return window.api.showError('Isso é um épico', r.erro);
    const token = erroJira(r, `Buscar ${chave}`);
    // sem Jira: usa o que já está salvo no computador, se houver
    const local = await window.api.historiaLocal(chave);
    if (local.ok && (local.dados.cenarios.length || local.dados.criterios)) {
      visao = local.dados;
      if (token) window.api.showMessage('Usando dados salvos', `O Jira recusou seu token de API. Mostrando o plano e os critérios da ${chave} lidos da última vez.`);
    } else if (!token) return;
    else return window.api.showError('Token de API recusado', 'O Jira recusou seu token de API. Troque o token nas configurações.');
  }
  const trocouHistoria = !J.visao || J.visao.id !== visao.id || val('storyId').toUpperCase() !== visao.id;
  J.visao = visao;
  if (trocouHistoria) {
    // outra história: os campos do CT anterior não valem mais
    ['testTitle', 'bddText', 'apiCurl'].forEach(id => { $j(id).value = ''; auto[id] = ''; });
    J.ctAtual = null; J.gruposAbertos = new Set();
    $j('testCaseId').value = 'CT01';
  }
  if (visao.escolhaPlano && !visao.escolhaPlano.escolhida && visao.escolhaPlano.motivo === 'varias') {
    const ops = visao.escolhaPlano.opcoes;
    const i = await window.api.ask({ titulo: 'Qual é o plano de testes?', mensagem: `A ${visao.id} tem mais de uma sub-task [QA] com cenários.`, detalhe: 'Escolha a que tem o plano de testes. A escolha fica guardada.', botoes: [...ops.map(o => `${o.chave} · ${o.titulo}`), 'Agora não'], cancelar: ops.length });
    if (i < ops.length) { const r2 = await window.api.jiraEscolherPlano(visao.id, ops[i].chave); if (r2.ok) J.visao = r2.dados; }
  }
  $j('storyId').value = J.visao.id;
  if (J.visao.titulo) { $j('storyTitle').value = J.visao.titulo; auto.storyTitle = J.visao.titulo; }
  renderResumoHistoria();
  if (J.visao.precisaConferir) return mostrarConferir();
  irParaSetup(selecionar);
}

function irParaSetup(selecionar = true) {
  $j('btnSetupVoltar').classList.toggle('hidden', !jiraConfigurado());
  mostrarTela('screenSetup');
  renderAside();
  if (selecionar && J.visao) {
    const pend = J.visao.cenarios.find(c => c.status === 'Não executado') || J.visao.cenarios[0];
    selecionarCT(pend ? pend.ct : val('testCaseId') || 'CT01');
  }
}

function renderResumoHistoria() {
  const el = $j('resumoHistoria');
  const v = J.visao;
  if (!v || !v.jira) { el.classList.add('hidden'); return; }
  const partes = [v.jira.tipo || 'História', v.jira.projeto && v.jira.projeto.nome, v.criterios ? `${v.efetivos.length} critérios de aceite` : null, `plano com ${v.cenarios.length} cenário${v.cenarios.length === 1 ? '' : 's'}`].filter(Boolean);
  el.innerHTML = `<div><b>${escJ(v.titulo)}</b><div class="opcional">${escJ(partes.join(' · '))}</div></div>
    ${J.config && J.config.site ? `<a href="#" id="abrirNoJira" style="font-weight:700;font-size:13px">Abrir no Jira</a>` : ''}`;
  el.classList.remove('hidden');
  const a = $j('abrirNoJira');
  if (a) a.onclick = e => { e.preventDefault(); window.api.abrirLink(`${J.config.site}/browse/${v.id}`); };
}

$j('btnBuscarJira').onclick = () => {
  if (!jiraConfigurado()) return window.api.showError('Jira não conectado', 'Configure a conexão com o Jira em Configurações.');
  abrirHistoria(val('storyId'));
};
$j('btnSetupVoltar').onclick = () => {
  if (evidences.length && !confirm(`Há ${evidences.length} item(ns) capturado(s) e ainda não salvo(s). Voltar mesmo assim? Eles continuam aqui se você abrir a mesma história.`)) return;
  mostrarTela('screenMinhas');
  carregarMinhas();
};

// ---------------------------------------------------------------- lateral: plano e critérios

function renderAside() {
  const v = J.visao;
  const aside = $j('asideJira');
  if (!v || (!v.cenarios.length && !v.criterios)) { aside.classList.add('hidden'); return; }
  aside.classList.remove('hidden');

  // plano
  $j('planoInfo').textContent = `${v.executados} de ${v.cenarios.length} executados`;
  $j('planoOrigem').innerHTML = v.plano && v.plano.subtarefa
    ? `Sub-task ${escJ(v.plano.subtarefa)}${v.plano.lidoEm ? ' · lido às ' + hora(v.plano.lidoEm) : ''} · <a href="#" id="relerPlano">Atualizar</a>`
    : (v.escolhaPlano && v.escolhaPlano.motivo === 'sem-cenarios' ? `Sub-task ${escJ(v.escolhaPlano.opcoes.map(o => o.chave).join(', '))} ainda sem cenários` : 'Nenhuma sub-task [QA] com plano');
  const rel = $j('relerPlano'); if (rel) rel.onclick = e => { e.preventDefault(); abrirHistoria(v.id, { selecionar: false }); };
  $j('planoBarra').style.width = v.cenarios.length ? `${Math.round(v.executados / v.cenarios.length * 100)}%` : '0';
  $j('planoLista').innerHTML = v.cenarios.length ? v.cenarios.map(c => `
    <button class="item-ct ${c.ct === J.ctAtual ? 'ativo' : ''}" data-ct="${escJ(c.ct)}" title="${escJ(c.titulo)}">
      <span class="ct">${escJ(c.ct)}</span><span class="tit">${escJ(c.titulo)}</span>
      ${c.editado || c.conflito ? `<span class="ponto" title="${c.conflito ? 'Mudou no Jira e no app' : 'Editado, ainda não salvo no Jira'}"></span>` : ''}
      ${pillStatus(c.status)}</button>`).join('') : '<span class="opcional">Sem cenários. Use "+ Escrever cenário" nos critérios.</span>';
  $j('planoLista').querySelectorAll('[data-ct]').forEach(b => b.onclick = () => selecionarCT(b.dataset.ct));

  // critérios
  const cob = v.cobertura;
  $j('critInfo').textContent = v.criterios ? `${cob.cobertos} de ${cob.total - cob.naoSeAplica} cobertos` : '';
  $j('critOrigem').innerHTML = v.criterios
    ? `${v.jira && v.jira.campoDescricao ? 'Da "' + escJ(v.jira.campoDescricao) + '"' : 'Da descrição'} da ${escJ(v.id)} · <a href="#" id="abrirConferir">Conferir</a>`
    : 'A história não tem critérios lidos.';
  const ac = $j('abrirConferir'); if (ac) ac.onclick = e => { e.preventDefault(); mostrarConferir(); };
  $j('critLista').innerHTML = renderCriterios(cob.criterios);
  $j('critLista').querySelectorAll('[data-grupo]').forEach(b => b.onclick = () => {
    const g = b.dataset.grupo; J.gruposAbertos.has(g) ? J.gruposAbertos.delete(g) : J.gruposAbertos.add(g); renderAside();
  });
  ligarAcoesCriterio($j('critLista'));

  // regras dos comentários
  renderRegras($j('asideRegras'));
}

function linhaCriterio(c) {
  const cts = c.naoSeAplica ? `<div class="cts">Não se aplica · ${escJ(c.naoSeAplica)}</div>`
    : c.cts.length ? `<div class="cts">Coberto por ${c.cts.map(x => escJ(x.ct)).join(', ')}</div>`
    : `<div class="cts">Sem cenário</div><div class="crit-acoes"><button class="btn-small btn-navy" data-novo="${escJ(c.id)}">+ Escrever cenário</button><button class="btn-link" data-nsa="${escJ(c.id)}">Não se aplica</button></div>`;
  return `<div class="crit-item ${!c.naoSeAplica && !c.cts.length ? 'sem' : ''}"><b>${escJ(c.id)}</b> ${escJ(c.texto)}${cts}</div>`;
}

function renderCriterios(criterios) {
  if (!criterios.length) return '';
  const grupos = [];
  criterios.forEach(c => { const g = grupos.find(x => x.nome === c.grupo); g ? g.itens.push(c) : grupos.push({ nome: c.grupo, itens: [c] }); });
  if (grupos.length === 1 && !grupos[0].nome) return grupos[0].itens.map(linhaCriterio).join('');
  // o primeiro grupo com critério descoberto abre sozinho
  const aplic = g => g.itens.filter(c => !c.naoSeAplica);
  const descoberto = grupos.find(g => aplic(g).some(c => !c.cts.length));
  if (descoberto && !J.gruposAbertos.size) J.gruposAbertos.add(descoberto.nome || '');
  return grupos.map(g => {
    const nome = g.nome || 'Outros';
    const ok = aplic(g).filter(c => c.cts.length).length, tot = aplic(g).length;
    const aberto = J.gruposAbertos.has(g.nome || '');
    const cab = `<button class="grupo-crit" data-grupo="${escJ(g.nome || '')}" aria-expanded="${aberto}"><span>${aberto ? '▾' : '▸'} ${escJ(nome)}</span><b class="${ok === tot ? 'ok' : 'falta'}">${ok} de ${tot}</b></button>`;
    return aberto ? `${cab}<div class="${ok < tot ? 'crit-aberto' : ''}">${g.itens.map(linhaCriterio).join('')}</div>` : cab;
  }).join('');
}

function ligarAcoesCriterio(raiz) {
  raiz.querySelectorAll('[data-novo]').forEach(b => b.onclick = () => {
    const c = J.visao.efetivos.find(x => x.id === b.dataset.novo);
    abrirModalCenario({ origem: 'criterio', origemDetalhe: c.id, criterios: [c.id], referencia: `${c.id} · ${c.texto}`, textoOrigem: `Para o critério ${c.id}, que ainda não tem cenário.`, bdd: c.bdd });
  });
  raiz.querySelectorAll('[data-nsa]').forEach(b => b.onclick = async () => {
    const id = b.dataset.nsa;
    const ajustes = JSON.parse(JSON.stringify(J.visao.criterios.ajustes || {}));
    ajustes.naoSeAplica = { ...(ajustes.naoSeAplica || {}), [id]: 'não se aplica a teste' };
    const r = await window.api.criteriosAjustes(J.visao.id, ajustes);
    if (!r.ok) return erroJira(r);
    J.visao = { ...r.dados, escolhaPlano: J.visao.escolhaPlano }; renderAside();
  });
}

function renderRegras(el) {
  const regras = (J.visao && J.visao.regras) || [];
  el.classList.toggle('hidden', !regras.length);
  if (!regras.length) return;
  const data = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '';
  el.innerHTML = `<div class="aside-cab"><h4>Regras nos comentários</h4><span class="opcional" style="color:#9A3412;font-weight:700">${regras.length} encontrada${regras.length === 1 ? '' : 's'}</span></div>
    <p class="opcional" style="margin:0 0 6px">Não são critérios da história. Sugestão: confirme com o PO se deve incluir como cenário.</p>` +
    regras.map((r, i) => `<div class="regra"><span>${escJ(r.titulo)}<small>${escJ(r.autor || '')}${r.data ? ' · ' + data(r.data) : ''}</small></span><button class="btn-small btn-navy" data-regra="${i}">+ Cenário</button></div>`).join('');
  el.querySelectorAll('[data-regra]').forEach(b => b.onclick = () => {
    const r = regras[+b.dataset.regra];
    abrirModalCenario({ titulo: r.titulo, origem: 'comentario', origemDetalhe: `comentário de ${r.autor || 'alguém'}${r.data ? ', ' + data(r.data) : ''}`, referencia: r.texto, textoOrigem: `A partir do comentário de ${r.autor || 'alguém'}.` });
  });
}

// ---------------------------------------------------------------- CT selecionado

function selecionarCT(ct) {
  if (evidences.length && J.ctAtual && J.ctAtual !== ct && !confirm(`Há ${evidences.length} item(ns) capturado(s) do ${J.ctAtual} ainda não salvo(s). Trocar de CT mesmo assim?`)) return;
  ['testTitle', 'bddText'].forEach(id => { auto[id] = $j(id).value; }); // deixa o próximo CT substituir o texto
  $j('testCaseId').value = ct;
  carregarExistente();
}

// Chamado pelo app.js depois de carregar (ou não) a última execução do CT
async function jiraAposCarregar(story, ct, info) {
  if (story && (!J.visao || J.visao.id !== story)) {
    const r = await window.api.historiaLocal(story);
    J.visao = r.ok && (r.dados.cenarios.length || r.dados.criterios) ? r.dados : null;
    renderResumoHistoria();
  }
  J.ctAtual = ct;
  const c = J.visao && J.visao.cenarios.find(x => x.ct === ct);
  if (c && c.noPlano) {
    preencher('testTitle', c.titulo);
    preencher('bddText', c.bdd);
    if (!info && c.tipo) definirTipo(c.tipo);
  }
  J.base = c ? { titulo: c.titulo, bdd: c.bdd, noPlano: c.noPlano } : null;
  definirNatureza(c ? c.natureza : sugerirNaturezaUI(val('bddText')), c ? !c.naturezaSugerida : false);
  J.cobre = c ? [...c.cobre] : [];
  J.verTodosCriterios = false;
  renderChips();
  mostrarConflito(c);
  atualizarBarraEdicao();
  renderAside();
}

function mostrarConflito(c) {
  const el = $j('avisoConflito');
  if (!c || !(c.conflito || c.mudouNoJira) || !c.lidoDoJira) { el.classList.add('hidden'); return; }
  if (c.mudouNoJira && !c.conflito) {
    el.className = 'aviso-amarelo'; el.innerHTML = 'Este cenário foi atualizado no Jira desde a última leitura.';
    el.classList.remove('hidden'); return;
  }
  el.className = 'aviso-erro';
  el.innerHTML = `<div><b>Este cenário mudou no Jira e no app.</b> Versão do Jira:<div class="referencia" style="margin-top:6px">${escJ(c.lidoDoJira.titulo)}\n${escJ(c.lidoDoJira.bdd)}</div></div>
    <span><button class="btn-small btn-secondary" id="usarDoJira">Usar a do Jira</button> <button class="btn-small btn-navy" id="manterMinha">Manter a minha e gravar no Jira</button></span>`;
  el.classList.remove('hidden');
  $j('usarDoJira').onclick = async () => { $j('testTitle').value = c.lidoDoJira.titulo; $j('bddText').value = c.lidoDoJira.bdd; await salvarCenario(false); };
  $j('manterMinha').onclick = () => salvarCenario(true);
}

// ---- edição sincronizada do cenário
function atualizarBarraEdicao() {
  const b = J.base;
  const editado = !!(b && b.noPlano && J.visao && (val('testTitle') !== b.titulo || $j('bddText').value.trim() !== String(b.bdd || '').trim()));
  $j('barraEdicao').classList.toggle('hidden', !editado);
  const sub = J.visao && J.visao.plano && J.visao.plano.subtarefa;
  const podeJira = jiraConfigurado() && !!sub;
  $j('gravarNoJira').parentElement.style.display = podeJira ? '' : 'none';
  if (podeJira) $j('gravarNoJiraTxt').textContent = `Atualizar também o ${J.ctAtual} na ${sub}`;
  if (!editado) return;
  if (!J.naturezaManual) definirNatureza(sugerirNaturezaUI($j('bddText').value), false);
}
['testTitle', 'bddText'].forEach(id => $j(id).addEventListener('input', () => {
  atualizarBarraEdicao();
  if (!J.base && !J.naturezaManual) definirNatureza(sugerirNaturezaUI($j('bddText').value), false);
}));
$j('btnDesfazerCenario').onclick = () => { if (!J.base) return; $j('testTitle').value = J.base.titulo; $j('bddText').value = J.base.bdd; atualizarBarraEdicao(); };
$j('btnSalvarCenario').onclick = () => salvarCenario(jiraConfigurado() && $j('gravarNoJira').checked && $j('gravarNoJira').parentElement.style.display !== 'none');

async function salvarCenario(gravarNoJira) {
  const erro = validarBdd($j('bddText').value);
  if (erro) return window.api.showError('Cenário BDD incompleto', erro);
  const btn = $j('btnSalvarCenario'); btn.disabled = true;
  const r = await window.api.cenarioSalvar({ storyId: J.visao.id, ct: J.ctAtual, titulo: val('testTitle'), bdd: $j('bddText').value.trim(), gravarNoJira });
  btn.disabled = false;
  if (!r.ok) {
    if (erroJira(r, 'Salvar cenário')) window.api.showError('Token de API recusado', 'O cenário não foi gravado no Jira. Troque o token nas configurações ou desmarque "Atualizar também no Jira".');
    return;
  }
  J.visao = { ...r.dados.visao, escolhaPlano: J.visao.escolhaPlano };
  if (r.dados.conflito) {
    const c = J.visao.cenarios.find(x => x.ct === J.ctAtual);
    mostrarConflito({ ...c, conflito: true, lidoDoJira: r.dados.noJira });
    return;
  }
  const c = J.visao.cenarios.find(x => x.ct === J.ctAtual);
  J.base = { titulo: c.titulo, bdd: c.bdd, noPlano: true };
  ['testTitle', 'bddText'].forEach(id => { auto[id] = $j(id).value; });
  mostrarConflito(null);
  atualizarBarraEdicao();
  renderAside();
}

// ---- positivo / negativo
function definirNatureza(n, manual) {
  J.natureza = n === 'negativo' ? 'negativo' : 'positivo';
  J.naturezaManual = !!manual;
  document.querySelectorAll('#natureza button').forEach(b => { b.classList.toggle('ativo', b.dataset.v === J.natureza); b.setAttribute('aria-pressed', b.dataset.v === J.natureza); });
  $j('naturezaDica').textContent = manual ? '' : 'Sugerido a partir do BDD, clique para alterar';
}
document.querySelectorAll('#natureza button').forEach(b => b.onclick = async () => {
  definirNatureza(b.dataset.v, true);
  if (J.visao && J.ctAtual && J.visao.cenarios.some(c => c.ct === J.ctAtual)) {
    const r = await window.api.naturezaDefinir(J.visao.id, J.ctAtual, J.natureza);
    if (r.ok) J.visao = { ...r.dados, escolhaPlano: J.visao.escolhaPlano };
  }
});

// ---- cobertura (chips de critérios)
function renderChips() {
  const crit = (J.visao && J.visao.efetivos || []).filter(c => !c.naoSeAplica);
  $j('grupoCobre').classList.toggle('hidden', !crit.length);
  if (!crit.length) return;
  const curto = t => t.length > 28 ? t.slice(0, 26).trimEnd() + '…' : t;
  const mostrar = J.verTodosCriterios ? crit : crit.filter(c => J.cobre.includes(c.id));
  $j('chipsCobre').innerHTML = mostrar.map(c => `<button type="button" class="chip ${J.cobre.includes(c.id) ? 'ativo' : ''}" data-ca="${escJ(c.id)}" aria-pressed="${J.cobre.includes(c.id)}" title="${escJ(c.texto)}">${escJ(c.id)} · ${escJ(curto(c.texto))}</button>`).join('') +
    `<button type="button" class="chip" id="verTodosCa" style="border-style:dashed">${J.verTodosCriterios ? 'Mostrar só os escolhidos' : '+ Critério'}</button>`;
  $j('chipsCobre').querySelectorAll('[data-ca]').forEach(b => b.onclick = async () => {
    const id = b.dataset.ca;
    J.cobre = J.cobre.includes(id) ? J.cobre.filter(x => x !== id) : [...J.cobre, id];
    renderChips();
    if (J.visao && J.ctAtual && J.visao.cenarios.some(c => c.ct === J.ctAtual)) {
      const r = await window.api.coberturaDefinir(J.visao.id, J.ctAtual, J.cobre);
      if (r.ok) { J.visao = { ...r.dados, escolhaPlano: J.visao.escolhaPlano }; renderAside(); }
    }
  });
  $j('verTodosCa').onclick = () => { J.verTodosCriterios = !J.verTodosCriterios; renderChips(); };
}

// ---- dados extras da execução e próximo CT (usados pelo app.js)
function jiraDadosExecucao() {
  const c = J.visao && J.visao.cenarios.find(x => x.ct === val('testCaseId'));
  return { natureza: J.natureza, criterios: [...J.cobre], origem: c ? c.origem : null };
}
function jiraProximoCt(atual) {
  if (!J.visao) return null;
  const p = J.visao.cenarios.find(c => c.ct !== atual && c.status === 'Não executado');
  return p ? p.ct : null;
}
async function jiraAposGerar(res, dados) {
  const r = await window.api.historiaLocal(dados.storyId);
  if (r.ok && (r.dados.cenarios.length || r.dados.criterios)) {
    J.visao = { ...r.dados, escolhaPlano: J.visao && J.visao.escolhaPlano };
    renderAside();
  }
}

// ---------------------------------------------------------------- conferência dos critérios

function mostrarConferir() {
  const v = J.visao;
  if (!v || !v.criterios) return irParaSetup();
  J.ajustes = JSON.parse(JSON.stringify(v.criterios.ajustes || {}));
  J.ajustes.subitens = J.ajustes.subitens || {}; J.ajustes.ignorados = J.ajustes.ignorados || []; J.ajustes.naoSeAplica = J.ajustes.naoSeAplica || {};
  $j('confHistoria').textContent = `${v.id} · ${v.titulo}`;
  const cr = v.criterios;
  $j('confOrigem').innerHTML = [
    `<b>Campo:</b> ${escJ((v.jira && v.jira.campoDescricao) || 'Descrição')}`,
    `<b>Início:</b> ${cr.encontrado ? '"' + escJ(cr.titulo) + '"' : 'não achei a seção de critérios'}`,
    `<b>Formato:</b> ${{ lista: 'lista', gherkin: 'Gherkin (Dado/Quando/Então)', texto: 'texto corrido' }[cr.formato] || cr.formato}${cr.agrupado ? '' : ', sem grupos'}`
  ].map(l => `<div style="font-size:12.5px;line-height:1.6">${l}</div>`).join('');
  renderRegras($j('confRegras'));
  $j('confPlano').innerHTML = v.plano && v.plano.subtarefa
    ? `<span style="font-size:12.5px">Sub-task <b>${escJ(v.plano.subtarefa)}</b> · ${v.cenarios.filter(c => c.noPlano).length} cenário(s)</span>`
    : `<span style="font-size:12px;color:#9A3412;font-weight:600">${v.escolhaPlano && v.escolhaPlano.opcoes.length ? 'Sub-task ' + escJ(v.escolhaPlano.opcoes.map(o => o.chave).join(', ')) + ' ainda sem cenários' : 'Nenhuma sub-task [QA] encontrada'}</span>`;
  renderConferir();
  mostrarTela('screenConferir');
}

function renderConferir() {
  const v = J.visao, a = J.ajustes;
  const ign = new Set(a.ignorados);
  let total = 0;
  const avisos = [];
  if (v.criterios.mudou) avisos.push('Os critérios mudaram no Jira desde a última conferência.');
  if (!v.criterios.encontrado) avisos.push('Não achei a seção "Critérios de aceite": li a descrição inteira.');
  else if (v.criterios.formato === 'texto') avisos.push('Os critérios estão em texto corrido: confira se cada parágrafo é mesmo um critério.');
  const html = v.criterios.grupos.map(g => (g.nome ? `<div class="conf-grupo">${escJ(g.nome)}</div>` : '') + g.criterios.map(c => {
    const ignorado = ign.has(c.id), nsa = a.naoSeAplica[c.id] != null;
    if (!ignorado) total++;
    const separar = a.subitens[c.id] === 'separar';
    if (!ignorado && separar) total += c.subitens.length;
    const sub = c.subitens.length && !ignorado ? `<div class="conf-sub">
        ${c.subitens.map(s => `<span><b style="color:#9A3412">Subitem:</b> ${escJ(s.texto)}</span>`).join('')}
        <fieldset><legend>Como tratar o subitem do ${escJ(c.id)}</legend>
          <label class="check" style="font-weight:400"><input type="radio" name="sub-${escJ(c.id)}" value="manter" ${separar ? '' : 'checked'}> Manter dentro do ${escJ(c.id)}</label>
          <label class="check" style="font-weight:400"><input type="radio" name="sub-${escJ(c.id)}" value="separar" ${separar ? 'checked' : ''}> Separar como critério próprio (${escJ(c.id)}.1)</label>
        </fieldset>
        <span class="opcional">Separado, ele aparece na cobertura e precisa de um cenário seu.</span></div>` : '';
    return `<div class="conf-crit ${ignorado ? 'ignorado' : ''} ${nsa ? 'nsa' : ''}"><b>${escJ(c.id)}</b><span>${escJ(c.texto)}${c.incerto ? ' <span class="pill bloqueado">leitura incerta</span>' : ''}${nsa ? ' <span class="pill pendente">não se aplica</span>' : ''}</span>
      <span style="flex:none;display:flex;gap:2px"><button class="btn-link" data-tnsa="${escJ(c.id)}">${nsa ? 'Aplica' : 'Não se aplica'}</button><button class="btn-link" data-tign="${escJ(c.id)}">${ignorado ? 'Restaurar' : 'Ignorar'}</button></span></div>${sub}`;
  }).join('')).join('');
  $j('confResumo').innerHTML = `Encontrei <b>${v.criterios.total} critério${v.criterios.total === 1 ? '' : 's'}</b>.` + (v.criterios.temSubitens ? ' Alguns têm subitens: escolha se viram critérios separados.' : '') +
    avisos.map(t => `<div class="aviso-amarelo" style="margin-top:8px">${escJ(t)}</div>`).join('');
  $j('confLista').innerHTML = html || '<p class="opcional">Nenhum critério encontrado na descrição.</p>';
  $j('btnConfConfirmar').textContent = `Confirmar ${total} critério${total === 1 ? '' : 's'}`;
  $j('confLista').querySelectorAll('input[type=radio]').forEach(r => r.onchange = () => { a.subitens[r.name.slice(4)] = r.value; renderConferir(); });
  $j('confLista').querySelectorAll('[data-tign]').forEach(b => b.onclick = () => { const id = b.dataset.tign; a.ignorados = ign.has(id) ? a.ignorados.filter(x => x !== id) : [...a.ignorados, id]; renderConferir(); });
  $j('confLista').querySelectorAll('[data-tnsa]').forEach(b => b.onclick = () => { const id = b.dataset.tnsa; if (a.naoSeAplica[id] != null) delete a.naoSeAplica[id]; else a.naoSeAplica[id] = 'não se aplica a teste'; renderConferir(); });
}
$j('btnConfConfirmar').onclick = async () => {
  const r = await window.api.criteriosAjustes(J.visao.id, J.ajustes);
  if (!r.ok) return erroJira(r, 'Confirmar critérios');
  J.visao = { ...r.dados, escolhaPlano: J.visao.escolhaPlano };
  irParaSetup(!J.ctAtual);
};
$j('btnConfReler').onclick = () => abrirHistoria(J.visao.id);
$j('btnConfVoltar').onclick = () => { if (jiraConfigurado()) { mostrarTela('screenMinhas'); carregarMinhas(); } else irParaSetup(false); };

// ---------------------------------------------------------------- cenário novo

let modalCenarioCtx = null;
function abrirModalCenario(ctx) {
  modalCenarioCtx = ctx;
  $j('mcTitulo').textContent = 'Novo cenário';
  $j('mcOrigem').textContent = ctx.textoOrigem || '';
  $j('mcReferencia').classList.toggle('hidden', !ctx.referencia);
  $j('mcReferencia').textContent = ctx.referencia || '';
  $j('mcNome').value = ctx.titulo || '';
  $j('mcBdd').value = ctx.bdd || 'Given \nWhen \nThen ';
  definirNaturezaModal(sugerirNaturezaUI(ctx.referencia || ''));
  const sub = J.visao && J.visao.plano && J.visao.plano.subtarefa;
  $j('mcGravarLinha').style.display = jiraConfigurado() && sub ? '' : 'none';
  if (sub) $j('mcGravarTxt').textContent = `Gravar também na ${sub} (sub-task do plano)`;
  $j('modalCenario').classList.remove('hidden');
  $j('mcNome').focus();
}
function definirNaturezaModal(n) { document.querySelectorAll('#mcNatureza button').forEach(b => b.classList.toggle('ativo', b.dataset.v === n)); }
document.querySelectorAll('#mcNatureza button').forEach(b => b.onclick = () => definirNaturezaModal(b.dataset.v));
$j('mcCancelar').onclick = () => $j('modalCenario').classList.add('hidden');
$j('mcAdicionar').onclick = async () => {
  const titulo = $j('mcNome').value.trim(), bdd = $j('mcBdd').value.trim();
  if (!titulo) return window.api.showError('Campo obrigatório', 'Dê um título ao cenário.');
  const erro = validarBdd(bdd);
  if (erro) return window.api.showError('Cenário BDD incompleto', erro);
  const natureza = document.querySelector('#mcNatureza button.ativo').dataset.v;
  const gravarNoJira = $j('mcGravarLinha').style.display !== 'none' && $j('mcGravar').checked;
  const ctx = modalCenarioCtx || {};
  const r = await window.api.cenarioNovo({ storyId: J.visao.id, titulo, bdd, natureza, criterios: ctx.criterios || [], origem: ctx.origem || 'app', origemDetalhe: ctx.origemDetalhe || '', gravarNoJira });
  if (!r.ok) {
    if (erroJira(r, 'Novo cenário')) window.api.showError('Token de API recusado', 'O cenário não foi criado. Troque o token nas configurações ou desmarque a gravação no Jira.');
    return;
  }
  $j('modalCenario').classList.add('hidden');
  J.visao = { ...r.dados.visao, escolhaPlano: J.visao.escolhaPlano };
  if (!$j('screenSetup').classList.contains('hidden')) selecionarCT(r.dados.ct);
  else renderConferir();
  renderAside();
};

// ---------------------------------------------------------------- configurações

async function jiraAbrirConfig() {
  J.config = await window.api.jiraConfig();
  $j('cfgJiraSite').value = J.config.site;
  $j('cfgJiraEmail').value = J.config.email;
  $j('cfgJiraToken').value = '';
  $j('cfgJiraToken').placeholder = J.config.temToken ? 'Token salvo (deixe em branco para manter)' : 'Cole aqui o token de API';
  $j('cfgJiraPrefixo').value = J.config.prefixoPlano;
  $j('cfgJiraToken').style.borderColor = J.tokenRecusado ? '#F87171' : '';
  const aviso = $j('cfgJiraAviso');
  aviso.classList.toggle('hidden', !J.tokenRecusado);
  aviso.innerHTML = '<span><b>O Jira recusou seu token de API.</b> Ele expirou ou foi revogado. Gere um novo, cole abaixo e clique em Testar conexão. Suas evidências salvas não são afetadas.</span>';
  $j('cfgJiraStatus').textContent = J.tokenRecusado ? 'Desconectado · token expirado' : (jiraConfigurado() ? 'Configurado' : 'Não conectado');
  $j('cfgJiraStatus').style.color = J.tokenRecusado ? '#B91C1C' : '';
}

// Salva a seção do Jira. Devolve false se algo impediu.
async function jiraSalvarConfig() {
  const r = await window.api.jiraConfigSalvar({ site: $j('cfgJiraSite').value, email: $j('cfgJiraEmail').value, token: $j('cfgJiraToken').value, prefixo: $j('cfgJiraPrefixo').value });
  if (!r.ok) { window.api.showError('Conexão com o Jira', r.erro); return false; }
  const novoToken = !!$j('cfgJiraToken').value;
  J.config = r.dados;
  $j('cfgJiraToken').value = '';
  if (J.config.site) $j('cfgJiraUrl').value = J.config.site + '/browse/';
  if (novoToken) J.tokenRecusado = false;
  atualizarSelo();
  // depois de conectar, a tela inicial passa a ser a lista de sub-tasks
  setTimeout(() => { if (jiraConfigurado() && !$j('screenMinhas').classList.contains('hidden')) carregarMinhas(); }, 0);
  return true;
}

$j('btnTestarJira').onclick = async () => {
  if (!(await jiraSalvarConfig())) return;
  const st = $j('cfgJiraStatus');
  st.textContent = 'Testando…'; st.style.color = '';
  const r = await window.api.jiraTestar();
  if (r.ok) {
    J.tokenRecusado = false; atualizarSelo();
    st.textContent = `● Conectado como ${r.dados.nome}`; st.style.color = '#166534';
    $j('cfgJiraAviso').classList.add('hidden'); $j('cfgJiraToken').style.borderColor = '';
  } else {
    if (r.tipo === 'token') { J.tokenRecusado = true; atualizarSelo(); }
    st.textContent = r.tipo === 'token' ? 'Desconectado · token recusado' : r.erro; st.style.color = '#B91C1C';
  }
};
$j('btnAjudaToken').onclick = () => {
  const box = $j('ajudaToken');
  box.classList.toggle('hidden');
  $j('btnAjudaToken').setAttribute('aria-expanded', !box.classList.contains('hidden'));
};
$j('linkTokens').onclick = e => { e.preventDefault(); window.api.abrirLink('https://id.atlassian.com/manage-profile/security/api-tokens'); };
// ao fechar as configurações, a tela inicial reflete a conexão nova
$j('btnSaveSettings').addEventListener('click', () => setTimeout(() => {
  if (jiraConfigurado() && $j('screenSetup').classList.contains('hidden') === false && !J.visao && !evidences.length && !val('storyId')) { mostrarTela('screenMinhas'); carregarMinhas(); }
}, 50));

iniciarJira();
