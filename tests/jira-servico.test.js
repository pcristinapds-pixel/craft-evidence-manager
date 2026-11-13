const test = require('node:test');
const assert = require('node:assert/strict');
const { criarServico } = require('../src/main/jira-servico');
const { montarVisao } = require('../src/main/visao');
const store = require('../src/main/evidence-store');
const { paraBlocos, paraTexto } = require('../src/main/adf');
const F = require('./fixtures/adf');
const { pastaTemp, cenario } = require('./helpers');

// Jira falso em memória, com a POR-6925 e as sub-tasks dela
function jiraFalso() {
  const subs = {
    'POR-7132': { titulo: '[QA] Análise e Escrita dos Cenários de Teste', adf: F.POR_7132 },
    'POR-7141': { titulo: '[QA] Testes e Coleta de Evidências', adf: F.doc(F.p('Evidências em anexo.')) },
    'POR-7137': { titulo: '[FRONT] Templates', adf: F.doc(F.p('x')) }
  };
  const gravados = [];
  const historia = chave => {
    if (chave === 'POR-7141') return { chave, subtarefa: true, pai: { chave: 'POR-6925' }, subtarefas: [], blocos: [], comentarios: [] };
    if (chave === 'CNN-1935') return { chave, epico: true, subtarefas: [], blocos: [], comentarios: [] };
    return {
      chave: 'POR-6925', titulo: 'E-mail de Boas-vindas por Idioma', tipo: 'Historia', status: 'AG. Deploy', epico: false, subtarefa: false,
      projeto: { chave: 'POR', nome: 'Portal do cliente' }, campoDescricao: 'Descrição para história',
      blocos: paraBlocos(F.POR_6925),
      subtarefas: Object.entries(subs).map(([k, v]) => ({ chave: k, titulo: v.titulo })),
      comentarios: [{ id: '1', autor: 'Samuel Gomes', blocos: paraBlocos(F.COMENTARIO_REGRA) }]
    };
  };
  return {
    site: 'https://craft.atlassian.net',
    gravados, subs,
    historia: async chave => historia(chave),
    subtarefa: async chave => ({ chave, descricao: subs[chave].adf, blocos: paraBlocos(subs[chave].adf), atualizadoEm: '2026-11-13' }),
    atualizarDescricao: async (chave, adf) => { gravados.push({ chave, adf }); subs[chave].adf = adf; }
  };
}

test('carrega história, plano da sub-task [QA] certa, critérios e regras', async t => {
  const base = pastaTemp(t);
  const v = await criarServico({ cliente: jiraFalso(), base }).carregarHistoria('POR-6925');
  assert.equal(v.id, 'POR-6925');
  assert.equal(v.titulo, 'E-mail de Boas-vindas por Idioma');
  assert.equal(v.plano.subtarefa, 'POR-7132');
  assert.deepEqual(v.cenarios.map(c => [c.ct, c.status]), [['CT01', 'Não executado'], ['CT02', 'Não executado'], ['CT03', 'Não executado'], ['CT04', 'Não executado']]);
  assert.equal(v.criterios.total, 13);
  assert.equal(v.regras.length, 3);
  assert.equal(v.escolhaPlano.escolhida, 'POR-7132');
  assert.deepEqual(v.escolhaPlano.opcoes.map(o => o.chave), ['POR-7132', 'POR-7141']);
  assert.ok(v.cenarios[1].cobre.includes('CA5'), 'cobertura sugerida para o CT02');
  assert.equal(v.cenarios[1].coberturaSugerida, true);
  assert.equal(v.precisaConferir, false, 'lista clara e sem subitens não precisa de conferência');
});

test('chave de sub-task leva para a história mãe; épico é recusado', async t => {
  const base = pastaTemp(t);
  const s = criarServico({ cliente: jiraFalso(), base });
  assert.equal((await s.carregarHistoria('POR-7141')).id, 'POR-6925');
  await assert.rejects(s.carregarHistoria('CNN-1935'), e => e.tipo === 'epico');
});

test('a escolha da sub-task do plano pela pessoa é mantida nas próximas leituras', async t => {
  const base = pastaTemp(t);
  const s = criarServico({ cliente: jiraFalso(), base });
  await s.carregarHistoria('POR-6925');
  const v = await s.escolherPlano('POR-6925', 'POR-7141');
  assert.equal(v.escolhaPlano.escolhida, 'POR-7141');
  assert.equal((await s.carregarHistoria('POR-6925')).escolhaPlano.escolhida, 'POR-7141');
});

test('gravar cenário no Jira troca só aquele trecho e marca como gravado', async t => {
  const base = pastaTemp(t);
  const j = jiraFalso();
  const s = criarServico({ cliente: j, base });
  await s.carregarHistoria('POR-6925');
  const r = await s.gravarCenarioNoJira('POR-6925', 'CT03', { titulo: 'Validar recebimento em Inglês', bdd: 'Given a\nWhen b\nThen c' });
  assert.equal(r.gravado, true);
  assert.equal(j.gravados.length, 1);
  assert.match(paraTexto(j.subs['POR-7132'].adf), /3\. Validar recebimento em Inglês\nGiven a\nWhen b\nThen c\n---\n4\./);
  const c = (await s.carregarHistoria('POR-6925')).cenarios.find(x => x.ct === 'CT03');
  assert.equal(c.bdd, 'Given a\nWhen b\nThen c');
  assert.equal(c.editado, false);
  assert.equal(c.conflito, false);
});

test('se o cenário mudou no Jira, não grava e devolve a versão do Jira', async t => {
  const base = pastaTemp(t);
  const j = jiraFalso();
  const s = criarServico({ cliente: j, base });
  await s.carregarHistoria('POR-6925');
  // alguém edita o CT02 direto no Jira
  const { substituirCenario, lerPlano } = require('../src/main/leitores');
  j.subs['POR-7132'].adf = substituirCenario(j.subs['POR-7132'].adf, lerPlano(paraBlocos(j.subs['POR-7132'].adf))[1], { titulo: 'Espanhol (PO)', bdd: 'Given x\nWhen y\nThen z' });
  const r = await s.gravarCenarioNoJira('POR-6925', 'CT02', { titulo: 'Espanhol (QA)', bdd: 'Given q\nWhen w\nThen e' });
  assert.equal(r.conflito, true);
  assert.equal(r.noJira.titulo, 'Espanhol (PO)');
  assert.equal(j.gravados.length, 0);
});

test('cenário criado no app é acrescentado no fim da sub-task', async t => {
  const base = pastaTemp(t);
  const j = jiraFalso();
  const s = criarServico({ cliente: j, base });
  await s.carregarHistoria('POR-6925');
  const { ct } = store.adicionarCenario(base, 'POR-6925', { titulo: 'Idioma padrão', bdd: 'Given sem idioma\nWhen enviado\nThen padrão', criterios: ['CA12'] });
  await s.gravarCenarioNoJira('POR-6925', ct, { titulo: 'Idioma padrão', bdd: 'Given sem idioma\nWhen enviado\nThen padrão' });
  assert.match(paraTexto(j.subs['POR-7132'].adf), /---\n5\. Idioma padrão\nGiven sem idioma/);
});

test('visão: status, falhas antes do sucesso e cobertura', async t => {
  const base = pastaTemp(t);
  await criarServico({ cliente: jiraFalso(), base }).carregarHistoria('POR-6925');
  const ex = extra => cenario({ storyId: 'POR-6925', testCaseId: 'CT03', ...extra });
  store.salvarExecucao(base, ex({ status: 'Falhou' }));
  store.salvarExecucao(base, ex({ status: 'Bloqueado' }), 'nova');
  store.salvarExecucao(base, ex({ status: 'Falhou' }), 'nova');
  store.salvarExecucao(base, ex({ status: 'Passou', natureza: 'positivo' }), 'nova');
  store.definirCobertura(base, 'POR-6925', 'CT03', ['CA6']);
  const v = montarVisao(base, 'POR-6925');
  const c3 = v.cenarios.find(c => c.ct === 'CT03');
  assert.equal(c3.status, 'Passou');
  assert.equal(c3.execucoes, 4);
  assert.equal(c3.falhasAntes, 2, 'bloqueado não conta como falha');
  assert.deepEqual(c3.cobre, ['CA6']);
  assert.equal(c3.coberturaSugerida, false);
  assert.equal(v.executados, 1);
  assert.deepEqual(v.cobertura.criterios.find(c => c.id === 'CA6').cts.find(x => x.ct === 'CT03'), { ct: 'CT03', status: 'Passou' });
});

test('visão: CT executado fora do plano também aparece', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario({ storyId: 'POR-1', testCaseId: 'CT07', natureza: 'negativo' }));
  const v = montarVisao(base, 'POR-1');
  assert.deepEqual(v.cenarios.map(c => [c.ct, c.noPlano, c.natureza, c.naturezaSugerida]), [['CT07', false, 'negativo', false]]);
  assert.equal(v.criterios, null);
  assert.equal(v.precisaConferir, false);
});

test('visão: subitem nos critérios pede conferência até a pessoa confirmar', t => {
  const base = pastaTemp(t);
  const { lerCriterios } = require('../src/main/leitores');
  store.salvarDadosJira(base, 'QMS-823', { criterios: lerCriterios(paraBlocos(F.QMS_823)) });
  assert.equal(montarVisao(base, 'QMS-823').precisaConferir, true);
  store.salvarAjustesCriterios(base, 'QMS-823', { subitens: { CA8: 'separar' } });
  const v = montarVisao(base, 'QMS-823');
  assert.equal(v.precisaConferir, false);
  assert.equal(v.efetivos.length, 12);
});
