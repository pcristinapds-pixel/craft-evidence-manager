// Sub-falha no Jira a partir de um CT que falhou.
// O formulário (preenchido pelo app e revisado pela pessoa) vira a descrição no modelo do time:
// Descrição, Passos para Reproduzir, Resultado Esperado, Resultado Atual,
// Critério de Aceite Impactado, Impacto, Evidências, Severidade e Prioridade.
const fs = require('fs');
const path = require('path');
const store = require('./evidence-store');
const { versaoRelatorio } = store;

const PALAVRA = /^(Dado que|Dado|Dada|Dados|Dadas|Quando|Então|Entao|E|Mas|Given|When|Then|And|But)\s+/i;
const PASSO_FIM = /^(entao|então|then)\b/i;
const maiuscula = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const ponto = s => /[.!?]$/.test(s) ? s : s + '.';

// Sugestão inicial do formulário, a partir da execução que falhou
function sugerirFormulario({ dados, execucao, criterios = [], ambiente }) {
  const linhas = String(dados.bdd || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const iThen = linhas.findIndex(l => PASSO_FIM.test(l));
  const antes = (iThen < 0 ? linhas : linhas.slice(0, iThen)).filter(l => PALAVRA.test(l));
  const depois = iThen < 0 ? [] : linhas.slice(iThen).filter(l => PALAVRA.test(l));
  const prints = (execucao.evidencias || []).filter(e => e.tipo === 'print' && e.legenda);
  const passos = [
    `Acessar o sistema no ambiente ${ambiente || execucao.ambiente || ''}`.trim(),
    ...antes.map(l => maiuscula(l.replace(PALAVRA, ''))),
    ...prints.map(e => `Conferir: ${e.legenda} (passo ${e.passo})`)
  ].map(ponto);
  return {
    titulo: `[FALHA] ${dados.titulo || ''}`.trim(),
    descricao: dados.observacao || '',
    passos: passos.map((p, i) => `${i + 1}. ${p}`).join('\n'),
    esperado: depois.map(l => ponto(maiuscula(l.replace(PALAVRA, '')))).join(' '),
    atual: dados.observacao || '',
    criterio: criterios.map(c => `${c.id} · ${c.texto}`).join('\n'),
    impacto: '',
    severidade: 'Alto',
    curl: execucao.api && execucao.api.curl ? execucao.api.curl : ''
  };
}

// ---- ADF da descrição
const tx = text => ({ type: 'text', text });
const h2 = text => ({ type: 'heading', attrs: { level: 2 }, content: [tx(text)] });
const par = text => ({ type: 'paragraph', content: text ? [tx(text)] : [] });
const paragrafos = texto => String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(par);
function lista(texto, numerada) {
  const itens = String(texto || '').split(/\r?\n/).map(l => l.trim().replace(/^(\d+[.)]|[-•*])\s*/, '')).filter(Boolean);
  if (!itens.length) return [];
  return [{ type: numerada ? 'orderedList' : 'bulletList', ...(numerada ? { attrs: { order: 1 } } : {}), content: itens.map(i => ({ type: 'listItem', content: [par(i)] })) }];
}

function descricaoAdf(f, { anexos = [], origem } = {}) {
  const sec = (titulo, nos) => (nos.length ? [h2(titulo), ...nos] : []);
  return {
    type: 'doc', version: 1,
    content: [
      ...sec('Descrição', paragrafos(f.descricao)),
      ...sec('Passos para Reproduzir', lista(f.passos, true)),
      ...sec('Resultado Esperado', paragrafos(f.esperado)),
      ...sec('Resultado Atual', paragrafos(f.atual)),
      ...sec('Critério de Aceite Impactado', paragrafos(f.criterio)),
      ...sec('Impacto', lista(f.impacto, false)),
      ...sec('Evidências', [
        ...(f.curl ? [par('Requisição (cURL, sem segredos):'), { type: 'codeBlock', attrs: { language: 'bash' }, content: [tx(f.curl)] }] : []),
        ...(anexos.length ? [par('Anexos:'), ...lista(anexos.join('\n'), false)] : [])
      ]),
      ...sec('Severidade', paragrafos(f.severidade)),
      ...sec('Prioridade', paragrafos(f.prioridadeNome)),
      ...(origem ? [{ type: 'paragraph', content: [{ type: 'text', text: origem, marks: [{ type: 'em' }] }] }] : [])
    ]
  };
}

// ---- arquivos que podem ir junto (prints, vídeos na versão leve e relatório do bug)
function evidenciasDisponiveis(base, storyId, ct, execucao, caminhoBug) {
  const dirCt = store.pastaCenario(base, storyId, ct);
  const out = [];
  for (const e of execucao.evidencias || []) {
    const abs = path.join(dirCt, ...e.arquivo.split('/'));
    if (e.tipo === 'print') { if (fs.existsSync(abs)) out.push({ id: e.arquivo, nome: path.basename(abs), rotulo: `Passo ${e.passo}${e.legenda ? ' · ' + e.legenda : ''}`, caminho: abs, tipo: 'image/png' }); continue; }
    const leve = versaoRelatorio(abs);
    const arq = fs.existsSync(leve) ? leve : abs;
    if (fs.existsSync(arq)) out.push({ id: e.arquivo, nome: path.basename(abs).replace(/\.[^.]+$/, '.mp4'), rotulo: `Vídeo${e.legenda ? ' · ' + e.legenda : ''}`, caminho: arq, tipo: 'video/mp4' });
  }
  if (caminhoBug && fs.existsSync(caminhoBug)) out.push({ id: 'bug', nome: path.basename(caminhoBug), rotulo: `Relatório do bug (${ct})`, caminho: caminhoBug, tipo: 'text/html' });
  return out;
}

// Cria a sub-falha, anexa as evidências escolhidas e registra na execução
async function criarSubFalha({ cliente, base, storyId, ct, execucao, form, anexos, projeto }) {
  if (!String(form.titulo || '').trim()) throw new Error('Informe o título da sub-falha.');
  if (!String(form.impacto || '').trim()) throw new Error('Preencha o impacto (funcionalidades afetadas e usuários impactados).');
  const tipo = await cliente.tipoSubFalha(projeto);
  const origem = `Aberta pelo Craft Evidence Manager a partir do ${ct} da ${storyId} (${execucao.execucao}ª execução, ${execucao.data}, ambiente ${execucao.ambiente || '-'}).`;
  const fields = {
    project: { key: projeto },
    parent: { key: storyId },
    issuetype: { id: tipo.id },
    summary: form.titulo.trim(),
    description: descricaoAdf(form, { anexos: anexos.map(a => a.nome), origem }),
    ...(form.prioridadeId ? { priority: { id: form.prioridadeId } } : {}),
    ...(form.responsavel ? { assignee: { accountId: form.responsavel } } : {})
  };
  const criada = await cliente.criarIssue(fields);
  let anexosErro = null;
  try {
    await cliente.anexar(criada.chave, anexos.map(a => ({ nome: a.nome, tipo: a.tipo, conteudo: fs.readFileSync(a.caminho) })));
  } catch (e) { anexosErro = e.message; } // a sub-falha já existe: avisa, mas não perde a chave
  registrarSubFalha(base, storyId, ct, execucao.execucao, criada);
  return { ...criada, anexosErro };
}

// Guarda na execução a sub-falha criada ou vinculada
function registrarSubFalha(base, storyId, ct, numExecucao, { chave, url }) {
  const arq = path.join(store.pastaCenario(base, storyId, ct), 'cenario.json');
  const cen = store.lerJson(arq, null);
  if (!cen) throw new Error(`Não encontrei o ${ct} da ${storyId}.`);
  const ex = cen.execucoes.find(x => x.execucao === numExecucao);
  if (!ex) throw new Error('Execução não encontrada.');
  ex.subFalha = { chave, url: url || null, em: new Date().toISOString() };
  fs.writeFileSync(arq, JSON.stringify(cen, null, 2), 'utf8');
  return ex.subFalha;
}

module.exports = { sugerirFormulario, descricaoAdf, evidenciasDisponiveis, criarSubFalha, registrarSubFalha };
