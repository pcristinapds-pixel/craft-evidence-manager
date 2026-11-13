const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const store = require('../src/main/evidence-store');
const rb = require('../src/main/report-builder');
const { pastaTemp, arquivo, cenario, dadosDoRelatorio } = require('./helpers');

const MB = 1024 * 1024;
const caminhoRel = base => path.join(base, 'QMS-1036', rb.nomeRelatorio('QMS-1036'));
const caminhoHist = base => path.join(base, 'QMS-1036', rb.nomeHistorico('QMS-1036'));

// salva um cenário com vídeo e cria a "versão leve" com o tamanho pedido
function comVideo(base, bytesLeve, extra = {}) {
  const vid = arquivo(path.join(base, '_tmp', `v${Math.random()}.mp4`), 64);
  const r = store.salvarExecucao(base, cenario({ evidences: [{ type: 'video', filePath: vid, duration: 65, legenda: 'Fluxo' }], ...extra }));
  if (bytesLeve) arquivo(r.videos[0].relatorio, bytesLeve);
  return r;
}

test('relatório traz cabeçalho, cenários em ordem e prints embutidos', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario({ testCaseId: 'CT02', author: 'Ana' }));
  store.salvarExecucao(base, cenario({ testCaseId: 'CT01' }));
  const arq = rb.gerarRelatorio(base, 'QMS-1036', { jiraBaseUrl: 'https://empresa.atlassian.net/browse' });
  assert.equal(arq, caminhoRel(base));
  const D = dadosDoRelatorio(arq);
  assert.equal(D.historia.link, 'https://empresa.atlassian.net/browse/QMS-1036');
  assert.equal(D.historia.titulo, 'Consulta de histórico do aéreo');
  assert.deepEqual(D.responsaveis.sort(), ['Ana', 'Paloma']);
  assert.deepEqual(D.cenarios.map(c => c.ct), ['CT01', 'CT02']);
  assert.match(D.cenarios[0].evidencias[0].src, /^data:image\/png;base64,/);
  assert.equal(D.cenarios[0].evidencias[0].legenda, 'Tabela');
});

test('relatório mostra só a execução atual; histórico vai para arquivo separado', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario({ testCaseId: 'CT01' }));
  rb.gerarRelatorio(base, 'QMS-1036');
  assert.ok(!fs.existsSync(caminhoHist(base)), 'sem reexecução não há histórico');
  assert.equal(dadosDoRelatorio(caminhoRel(base)).linkHistorico, '');

  store.salvarExecucao(base, cenario({ status: 'Falhou' }), 'nova');
  store.salvarExecucao(base, cenario({ status: 'Passou' }), 'nova');
  const out = {};
  rb.gerarRelatorio(base, 'QMS-1036', { out });
  const D = dadosDoRelatorio(caminhoRel(base));
  assert.equal(D.cenarios.length, 1);
  assert.equal(D.cenarios[0].execucao, 3);
  assert.equal(D.cenarios[0].historico, undefined, 'sem histórico dentro do relatório');
  assert.ok(D.linkHistorico.endsWith('.html'));
  assert.equal(out.historico, caminhoHist(base));

  const H = dadosDoRelatorio(caminhoHist(base));
  assert.equal(H.documento, 'Histórico de execuções');
  assert.deepEqual(H.cenarios.map(c => c.titulo), [3, 2, 1].map(n => `Validação da tabela · ${n}ª execução`));
  assert.equal(new Set(H.cenarios.map(c => c.id)).size, 3, 'cada execução tem âncora própria');
});

test('vídeo leve até 50 MB é embutido; acima disso vira download', t => {
  const base = pastaTemp(t);
  comVideo(base, 1 * MB, { testCaseId: 'CT01' });
  comVideo(base, 51 * MB, { testCaseId: 'CT02' });
  rb.gerarRelatorio(base, 'QMS-1036');
  const [v1, v2] = dadosDoRelatorio(caminhoRel(base)).cenarios.map(c => c.evidencias[0]);
  assert.equal(v1.embutido, true);
  assert.match(v1.src, /^data:video\/mp4;base64,/);
  assert.equal(v1.nomeDownload, 'CT01 - Fluxo.mp4');
  assert.equal(v1.duracao, '1:05');
  assert.equal(v2.embutido, false);
  assert.equal(v2.src, 'CT02/exec-1/video-1.mp4');
});

test('sem versão leve (FFmpeg indisponível), o vídeo vira download', t => {
  const base = pastaTemp(t);
  comVideo(base, 0);
  rb.gerarRelatorio(base, 'QMS-1036');
  assert.equal(dadosDoRelatorio(caminhoRel(base)).cenarios[0].evidencias[0].embutido, false);
});

test('relatório acima de 100 MB: todos os vídeos viram download', t => {
  const base = pastaTemp(t);
  ['CT01', 'CT02', 'CT03'].forEach(ct => comVideo(base, 30 * MB, { testCaseId: ct }));
  rb.gerarRelatorio(base, 'QMS-1036');
  const evs = dadosDoRelatorio(caminhoRel(base)).cenarios.map(c => c.evidencias[0]);
  assert.deepEqual(evs.map(e => e.embutido), [false, false, false]);
  assert.ok(fs.statSync(caminhoRel(base)).size < 100 * MB);
});

test('relatório de bug: só para Falhou/Bloqueado, um por execução, com link no relatório', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario({ testCaseId: 'CT01', status: 'Passou' }));
  store.salvarExecucao(base, cenario({ testCaseId: 'CT02', status: 'Falhou', observacao: 'Lista vazia' }));
  store.salvarExecucao(base, cenario({ testCaseId: 'CT03', status: 'Bloqueado' }));
  store.salvarExecucao(base, cenario({ testCaseId: 'CT04', status: 'Não executado' }));

  assert.equal(rb.gerarRelatorioBug(base, 'QMS-1036', 'CT01'), null);
  assert.equal(rb.gerarRelatorioBug(base, 'QMS-1036', 'CT04'), null);
  assert.equal(rb.gerarRelatorioBug(base, 'QMS-1036', 'CT99'), null);
  const bug2 = rb.gerarRelatorioBug(base, 'QMS-1036', 'CT02');
  const bug3 = rb.gerarRelatorioBug(base, 'QMS-1036', 'CT03');
  assert.equal(path.basename(bug2), 'QMS-1036 - CT02 - Bug (1ª execução).html');
  assert.equal(path.basename(path.dirname(bug2)), 'Bugs');
  assert.ok(fs.existsSync(bug3));

  const B = dadosDoRelatorio(bug2);
  assert.equal(B.documento, 'Relatório para abertura de bug');
  assert.equal(B.simples, true);
  assert.equal(B.cenarios.length, 1);
  assert.equal(B.cenarios[0].observacao, 'Lista vazia');

  // reexecução que falha de novo gera outro arquivo, sem apagar o primeiro
  store.salvarExecucao(base, cenario({ testCaseId: 'CT02', status: 'Falhou' }), 'nova');
  const bug2b = rb.gerarRelatorioBug(base, 'QMS-1036', 'CT02');
  assert.notEqual(bug2b, bug2);
  assert.ok(fs.existsSync(bug2) && fs.existsSync(bug2b));

  rb.gerarRelatorio(base, 'QMS-1036');
  const links = Object.fromEntries(dadosDoRelatorio(caminhoRel(base)).cenarios.map(c => [c.ct, c.linkBug || '']));
  assert.match(links.CT02, /^Bugs\/.*2%C2%AA%20execu/);
  assert.match(links.CT03, /^Bugs\//);
  assert.equal(links.CT01, '');
});

test('ehBug() considera apenas Falhou e Bloqueado', () => {
  assert.deepEqual(['Passou', 'Falhou', 'Bloqueado', 'Não executado', ''].map(rb.ehBug), [false, true, true, false, false]);
});

test('relatório não contém segredos e não quebra com </script> no texto', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario({
    tipo: 'back', evidences: [], bddText: 'Dado </script><script>alert(1)</script>\nQuando x\nEntão y',
    api: { curl: 'curl https://api/x -H "Authorization: Bearer segredo-123456" --data \'{"senha":"abc"}\'' }
  }));
  rb.gerarRelatorio(base, 'QMS-1036');
  const html = fs.readFileSync(caminhoRel(base), 'utf8');
  assert.doesNotMatch(html, /segredo-123456|"senha":"abc"/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  const D = dadosDoRelatorio(caminhoRel(base));
  assert.match(D.cenarios[0].bdd, /<\/script><script>alert\(1\)/, 'o texto original é preservado nos dados');
  assert.match(D.cenarios[0].api.curl, /\{\{TOKEN\}\}/);
});

test('collection anexada vai embutida para download', t => {
  const base = pastaTemp(t);
  const col = path.join(base, '_o', 'api.postman_collection.json');
  fs.mkdirSync(path.dirname(col), { recursive: true });
  fs.writeFileSync(col, '{"info":{"name":"API"}}');
  store.salvarExecucao(base, cenario({ tipo: 'back', evidences: [], api: { curl: 'curl x', collectionPath: col } }));
  rb.gerarRelatorio(base, 'QMS-1036');
  const c = dadosDoRelatorio(caminhoRel(base)).cenarios[0].api.collection;
  assert.equal(c.nome, 'api.postman_collection.json');
  assert.equal(Buffer.from(c.url.split(',')[1], 'base64').toString(), '{"info":{"name":"API"}}');
});

// ---------------- plano do Jira, cobertura e falhas antes do sucesso
const { lerCriterios, lerPlano } = require('../src/main/leitores');
const { paraBlocos } = require('../src/main/adf');
const F = require('./fixtures/adf');

function historiaDoJira(base) {
  store.salvarDadosJira(base, 'POR-6925', {
    titulo: 'E-mail de Boas-vindas por Idioma', jira: { projeto: { chave: 'POR', nome: 'Portal do cliente' } },
    criterios: lerCriterios(paraBlocos(F.POR_6925)),
    plano: { subtarefa: 'POR-7132', cenarios: lerPlano(paraBlocos(F.POR_7132)) }
  });
  const ex = extra => cenario({ storyId: 'POR-6925', testCaseId: 'CT03', ...extra });
  store.salvarExecucao(base, ex({ status: 'Falhou' }));
  store.salvarExecucao(base, ex({ status: 'Bloqueado' }), 'nova');
  store.salvarExecucao(base, ex({ status: 'Passou', natureza: 'positivo' }), 'nova');
}

test('relatório com plano do Jira: cobertura, CTs não executados, origem e falhas antes do sucesso', t => {
  const base = pastaTemp(t);
  historiaDoJira(base);
  store.salvarAjustesCriterios(base, 'POR-6925', { naoSeAplica: { CA13: 'validação documental' } });
  const arq = rb.gerarRelatorio(base, 'POR-6925');
  const D = dadosDoRelatorio(arq);
  assert.equal(D.projeto, 'Portal do cliente');
  assert.equal(D.plano.subtarefa, 'POR-7132');
  assert.deepEqual(D.cenarios.map(c => [c.ct, c.status]), [['CT01', 'Não executado'], ['CT02', 'Não executado'], ['CT03', 'Passou'], ['CT04', 'Não executado']]);
  const c3 = D.cenarios.find(c => c.ct === 'CT03');
  assert.equal(c3.natureza, 'positivo');
  assert.equal(c3.falhasAntes.length, 1, 'bloqueado não conta');
  assert.equal(c3.falhasAntes[0].execucao, 1);
  assert.ok(c3.cobre.includes('CA6'));
  assert.equal(c3.origem, 'plano POR-7132, cenário 3');
  const c4 = D.cenarios.find(c => c.ct === 'CT04');
  assert.equal(c4.naoExecutado, true);
  assert.match(c4.bdd, /Português/);
  assert.deepEqual(c4.evidencias, []);
  assert.equal(D.cobertura.total, 13);
  assert.equal(D.cobertura.naoSeAplica, 1);
  assert.equal(D.cobertura.criterios.find(c => c.id === 'CA13').naoSeAplica, 'validação documental');
  assert.deepEqual(D.cobertura.criterios.find(c => c.id === 'CA6').cts.find(x => x.ct === 'CT03'), { ct: 'CT03', status: 'Passou' });
  assert.ok(D.cobertura.criterios.filter(c => !c.cts.length && !c.naoSeAplica).length >= 4, 'cadastro e disparo sem cenário');
});

test('relatório sem dados do Jira continua igual (sem cobertura nem plano)', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario());
  const D = dadosDoRelatorio(rb.gerarRelatorio(base, 'QMS-1036'));
  assert.equal(D.cobertura, null);
  assert.equal(D.plano, null);
  assert.deepEqual(D.cenarios.map(c => c.ct), ['CT01']);
  assert.equal(D.cenarios[0].falhasAntes.length, 0);
});

test('cenário criado no app para um critério mostra a origem', t => {
  const base = pastaTemp(t);
  historiaDoJira(base);
  store.adicionarCenario(base, 'POR-6925', { titulo: 'Idioma padrão', bdd: 'Given sem idioma\nWhen enviado\nThen padrão', origem: 'criterio', origemDetalhe: 'CA12', criterios: ['CA12'] });
  const D = dadosDoRelatorio(rb.gerarRelatorio(base, 'POR-6925'));
  const c5 = D.cenarios.find(c => c.ct === 'CT05');
  assert.match(c5.origem, /^criado no app para o CA12/);
  assert.deepEqual(c5.cobre, ['CA12']);
  assert.equal(c5.natureza, 'negativo', 'sugerido pelo BDD ("sem idioma")');
});
