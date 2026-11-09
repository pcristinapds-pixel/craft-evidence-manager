const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const store = require('../src/main/evidence-store');
const { pastaTemp, arquivo, cenario, PNG_1PX } = require('./helpers');

test('seguro() remove caracteres proibidos em nomes de pasta do Windows', () => {
  assert.equal(store.seguro('QMS:10/36*?'), 'QMS1036');
  assert.equal(store.seguro('  CT 01  '), 'CT 01');
  assert.equal(store.seguro(''), 'sem-id');
});

test('salva a 1ª execução com prints, legenda e dados do cenário', t => {
  const base = pastaTemp(t);
  const r = store.salvarExecucao(base, cenario({ observacao: 'massa X' }));
  assert.equal(r.execucao, 1);
  const c = store.lerCenario(base, 'QMS-1036', 'CT01');
  assert.equal(c.execucoes.length, 1);
  const ex = c.execucoes[0];
  assert.equal(ex.titulo, 'Validação da tabela');
  assert.equal(ex.status, 'Passou');
  assert.equal(ex.tipo, 'front');
  assert.equal(ex.observacao, 'massa X');
  assert.deepEqual(ex.evidencias.map(e => [e.tipo, e.passo, e.arquivo, e.legenda]), [['print', 1, 'exec-1/passo-1.png', 'Tabela']]);
  assert.ok(fs.existsSync(path.join(base, 'QMS-1036', 'CT01', 'exec-1', 'passo-1.png')));
  assert.deepEqual(store.infoHistoria(base, 'QMS-1036'), { id: 'QMS-1036', titulo: 'Consulta de histórico do aéreo' });
});

test('"nova" execução mantém a anterior; "substituir" troca só a última', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario({ status: 'Falhou' }));
  const r2 = store.salvarExecucao(base, cenario({ status: 'Passou' }), 'nova');
  assert.equal(r2.execucao, 2);
  let c = store.lerCenario(base, 'QMS-1036', 'CT01');
  assert.deepEqual(c.execucoes.map(e => [e.execucao, e.status]), [[1, 'Falhou'], [2, 'Passou']]);

  const r3 = store.salvarExecucao(base, cenario({ status: 'Bloqueado', evidences: [] }), 'substituir');
  assert.equal(r3.execucao, 2, 'substituir reaproveita o número da última');
  c = store.lerCenario(base, 'QMS-1036', 'CT01');
  assert.deepEqual(c.execucoes.map(e => [e.execucao, e.status]), [[1, 'Falhou'], [2, 'Bloqueado']]);
  assert.ok(!fs.existsSync(path.join(base, 'QMS-1036', 'CT01', 'exec-2', 'passo-1.png')), 'mídias da execução substituída são apagadas');
  assert.ok(fs.existsSync(path.join(base, 'QMS-1036', 'CT01', 'exec-1', 'passo-1.png')), 'execução 1 continua intacta');
});

test('ultimaExecucao() resume o cenário para a reexecução', t => {
  const base = pastaTemp(t);
  assert.equal(store.ultimaExecucao(base, 'QMS-1036', 'CT01'), null);
  store.salvarExecucao(base, cenario({ status: 'Falhou' }));
  store.salvarExecucao(base, cenario({ status: 'Passou', title: 'Título novo' }), 'nova');
  const u = store.ultimaExecucao(base, 'QMS-1036', 'CT01');
  assert.equal(u.total, 2);
  assert.equal(u.execucao, 2);
  assert.equal(u.status, 'Passou');
  assert.equal(u.titulo, 'Título novo');
  assert.match(u.bdd, /^Dado que/);
});

test('back-end: cURL é salvo sem segredos e a collection é copiada', t => {
  const base = pastaTemp(t);
  const col = arquivo(path.join(base, '_origem', 'QMS.postman_collection.json'));
  store.salvarExecucao(base, cenario({
    tipo: 'back', evidences: [],
    api: { curl: 'curl https://api/x -H "Authorization: Bearer abcdef123456"', collectionPath: col }
  }));
  const ex = store.lerCenario(base, 'QMS-1036', 'CT01').execucoes[0];
  assert.equal(ex.tipo, 'back');
  assert.match(ex.api.curl, /\{\{TOKEN\}\}/);
  assert.doesNotMatch(ex.api.curl, /abcdef123456/);
  assert.equal(ex.api.collection, 'exec-1/QMS.postman_collection.json');
  assert.ok(fs.existsSync(path.join(base, 'QMS-1036', 'CT01', 'exec-1', 'QMS.postman_collection.json')));
});

test('vídeo é copiado e o caminho da versão leve é informado', t => {
  const base = pastaTemp(t);
  const vid = arquivo(path.join(base, '_tmp', 'gravacao.mp4'), 100);
  const r = store.salvarExecucao(base, cenario({ evidences: [
    { type: 'image', dataUrl: PNG_1PX }, { type: 'video', filePath: vid, duration: 12.5, legenda: 'Fluxo' }
  ] }));
  const ev = store.lerCenario(base, 'QMS-1036', 'CT01').execucoes[0].evidencias;
  assert.deepEqual(ev.map(e => e.arquivo), ['exec-1/passo-1.png', 'exec-1/video-1.mp4']);
  assert.equal(ev[1].duracao, 12.5);
  assert.equal(r.videos.length, 1);
  assert.ok(r.videos[0].relatorio.endsWith(path.join('exec-1', 'video-1-relatorio.mp4')));
  assert.ok(fs.existsSync(r.videos[0].original));
});

test('versaoRelatorio() troca a extensão por -relatorio.mp4', () => {
  assert.equal(store.versaoRelatorio('/a/b/video-1.webm'), '/a/b/video-1-relatorio.mp4');
  assert.equal(store.versaoRelatorio('/a/b.c/video-2.mp4'), '/a/b.c/video-2-relatorio.mp4');
});

test('listarCenarios() usa ordem natural (CT2 antes de CT10)', t => {
  const base = pastaTemp(t);
  ['CT10', 'CT02', 'CT01', 'CT09'].forEach(ct => store.salvarExecucao(base, cenario({ testCaseId: ct })));
  assert.deepEqual(store.listarCenarios(base, 'QMS-1036').map(c => c.ct), ['CT01', 'CT02', 'CT09', 'CT10']);
});

test('título da história só é atualizado quando informado', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario());
  store.salvarExecucao(base, cenario({ testCaseId: 'CT02', storyTitle: '' }));
  assert.equal(store.infoHistoria(base, 'QMS-1036').titulo, 'Consulta de histórico do aéreo');
  assert.equal(store.infoHistoria(base, 'QMS-9999'), null);
});
