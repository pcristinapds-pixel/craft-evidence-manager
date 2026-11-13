const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const store = require('../src/main/evidence-store');
const rb = require('../src/main/report-builder');
const SF = require('../src/main/subfalha');
const { criarCliente } = require('../src/main/jira');
const { paraTexto } = require('../src/main/adf');
const { pastaTemp, cenario, dadosDoRelatorio } = require('./helpers');

const BDD = 'Given um novo acesso foi criado sem idioma de preferência\nWhen o e-mail de boas-vindas for enviado\nThen o usuário deve receber o e-mail no idioma padrão da solução\nAnd o assunto deve estar no idioma padrão';

function falhou(base, extra = {}) {
  store.salvarExecucao(base, cenario({ storyId: 'POR-6925', testCaseId: 'CT05', title: 'E-mail sem corpo sem idioma', bddText: BDD, status: 'Falhou', environment: 'Homologação', observacao: 'O e-mail chega sem texto no corpo.', ...extra }));
  return store.lerCenario(base, 'POR-6925', 'CT05').execucoes[0];
}

test('formulário sugerido: passos do Given/When e legendas, esperado do Then, atual da observação', t => {
  const base = pastaTemp(t);
  const ex = falhou(base);
  const f = SF.sugerirFormulario({ dados: { titulo: ex.titulo, bdd: ex.bdd, observacao: ex.observacao }, execucao: ex, criterios: [{ id: 'CA12', texto: 'Sem idioma, usar o padrão.' }] });
  assert.equal(f.titulo, '[FALHA] E-mail sem corpo sem idioma');
  assert.equal(f.passos, '1. Acessar o sistema no ambiente Homologação.\n2. Um novo acesso foi criado sem idioma de preferência.\n3. O e-mail de boas-vindas for enviado.\n4. Conferir: Tabela (passo 1).');
  assert.equal(f.esperado, 'O usuário deve receber o e-mail no idioma padrão da solução. O assunto deve estar no idioma padrão.');
  assert.equal(f.atual, 'O e-mail chega sem texto no corpo.');
  assert.equal(f.criterio, 'CA12 · Sem idioma, usar o padrão.');
  assert.equal(f.impacto, '');
});

test('descrição no modelo do time, com seções na ordem e listas', () => {
  const adf = SF.descricaoAdf({ descricao: 'Sem corpo.', passos: '1. Acessar.\n2. Criar acesso.', esperado: 'Idioma padrão.', atual: 'Sem corpo.', criterio: 'CA12 · x', impacto: 'Funcionalidades afetadas: e-mail\nUsuários impactados: novos', severidade: 'Alto', prioridadeNome: 'Alto', curl: 'curl x -H "Authorization: Bearer {{TOKEN}}"' }, { anexos: ['passo-1.png'], origem: 'Aberta pelo app.' });
  const txt = paraTexto(adf);
  const ordem = ['Descrição', 'Passos para Reproduzir', 'Resultado Esperado', 'Resultado Atual', 'Critério de Aceite Impactado', 'Impacto', 'Evidências', 'Severidade', 'Prioridade'];
  let pos = -1;
  ordem.forEach(h => { const p = txt.indexOf(h + '\n'); assert.ok(p > pos, `${h} fora de ordem`); pos = p; });
  assert.match(txt, /Passos para Reproduzir\n1\. Acessar\.\n2\. Criar acesso\./);
  assert.match(txt, /Impacto\n- Funcionalidades afetadas: e-mail\n- Usuários impactados: novos/);
  assert.match(txt, /Anexos:\n- passo-1\.png/);
  assert.ok(adf.content.some(n => n.type === 'codeBlock'), 'cURL vira bloco de código');
  assert.match(txt, /Aberta pelo app\.$/);
});

test('cria a sub-falha filha da história, anexa e registra na execução e no relatório', async t => {
  const base = pastaTemp(t);
  const ex = falhou(base);
  rb.gerarRelatorioBug(base, 'POR-6925', 'CT05');
  const bug = path.join(base, 'POR-6925', 'Bugs', rb.nomeBug('POR-6925', 'CT05', 1));
  const evs = SF.evidenciasDisponiveis(base, 'POR-6925', 'CT05', ex, bug);
  assert.deepEqual(evs.map(e => e.rotulo), ['Passo 1 · Tabela', 'Relatório do bug (CT05)']);
  const chamadas = [];
  const cliente = {
    tipoSubFalha: async p => { chamadas.push(['tipo', p]); return { id: '10011', nome: 'Sub-falha' }; },
    criarIssue: async fields => { chamadas.push(['criar', fields]); return { chave: 'POR-7150', url: 'https://x/browse/POR-7150' }; },
    anexar: async (chave, arqs) => { chamadas.push(['anexar', chave, arqs.map(a => [a.nome, a.conteudo.length > 0])]); }
  };
  const form = { titulo: '[FALHA] Sem corpo', impacto: 'Novos usuários', descricao: 'x', passos: '1. a', esperado: 'b', atual: 'c', criterio: 'CA12', severidade: 'Alto', prioridadeId: '2', prioridadeNome: 'Alto', responsavel: 'acc-1' };
  const r = await SF.criarSubFalha({ cliente, base, storyId: 'POR-6925', ct: 'CT05', execucao: ex, form, anexos: evs, projeto: 'POR' });
  assert.equal(r.chave, 'POR-7150');
  const fields = chamadas.find(c => c[0] === 'criar')[1];
  assert.deepEqual([fields.project, fields.parent, fields.issuetype, fields.priority, fields.assignee], [{ key: 'POR' }, { key: 'POR-6925' }, { id: '10011' }, { id: '2' }, { accountId: 'acc-1' }]);
  assert.match(paraTexto(fields.description), /a partir do CT05 da POR-6925 \(1ª execução/);
  assert.deepEqual(chamadas.find(c => c[0] === 'anexar')[2], [['passo-1.png', true], [path.basename(bug), true]]);
  assert.equal(store.lerCenario(base, 'POR-6925', 'CT05').execucoes[0].subFalha.chave, 'POR-7150');
  const D = dadosDoRelatorio(rb.gerarRelatorio(base, 'POR-6925'));
  assert.equal(D.cenarios[0].subFalha.chave, 'POR-7150');
});

test('sem impacto, não cria', async t => {
  const base = pastaTemp(t);
  const ex = falhou(base);
  await assert.rejects(SF.criarSubFalha({ cliente: {}, base, storyId: 'POR-6925', ct: 'CT05', execucao: ex, form: { titulo: 'x', impacto: ' ' }, anexos: [], projeto: 'POR' }), /impacto/);
});

test('falha nos anexos não perde a sub-falha criada', async t => {
  const base = pastaTemp(t);
  const ex = falhou(base);
  const cliente = { tipoSubFalha: async () => ({ id: '1' }), criarIssue: async () => ({ chave: 'POR-7151', url: 'u' }), anexar: async () => { throw new Error('arquivo grande demais'); } };
  const evs = SF.evidenciasDisponiveis(base, 'POR-6925', 'CT05', ex);
  const r = await SF.criarSubFalha({ cliente, base, storyId: 'POR-6925', ct: 'CT05', execucao: ex, form: { titulo: 'x', impacto: 'y' }, anexos: evs, projeto: 'POR' });
  assert.equal(r.chave, 'POR-7151');
  assert.match(r.anexosErro, /grande/);
  assert.equal(store.lerCenario(base, 'POR-6925', 'CT05').execucoes[0].subFalha.chave, 'POR-7151');
});

test('cliente: acha o tipo "Sub-falha" do projeto e anexa com o cabeçalho da Atlassian', async () => {
  const chamadas = [];
  const fetch = async (url, o) => {
    chamadas.push({ url, ...o });
    if (url.includes('/issuetypes')) return { status: 200, ok: true, text: async () => JSON.stringify({ issueTypes: [{ id: '1', name: 'História', subtask: false }, { id: '7', name: 'Sub-tarefa', subtask: true }, { id: '9', name: 'Sub-falha', subtask: true }] }) };
    return { status: 200, ok: true, text: async () => '[]' };
  };
  const c = criarCliente({ site: 'x.atlassian.net', email: 'a', token: 'b', fetch });
  assert.deepEqual(await c.tipoSubFalha('POR'), { id: '9', nome: 'Sub-falha' });
  await c.anexar('POR-7150', [{ nome: 'passo-1.png', tipo: 'image/png', conteudo: Buffer.from('x') }]);
  const anexo = chamadas[1];
  assert.equal(anexo.headers['X-Atlassian-Token'], 'no-check');
  assert.equal(anexo.headers['Content-Type'], undefined, 'multipart define o próprio Content-Type');
  assert.ok(anexo.body instanceof FormData);
});
