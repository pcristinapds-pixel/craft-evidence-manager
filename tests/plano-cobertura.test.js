const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/main/evidence-store');
const C = require('../src/main/cobertura');
const { lerCriterios, lerPlano } = require('../src/main/leitores');
const { paraBlocos } = require('../src/main/adf');
const F = require('./fixtures/adf');
const { pastaTemp, cenario } = require('./helpers');

const leituraPOR = () => lerCriterios(paraBlocos(F.POR_6925));
const leituraQMS = () => lerCriterios(paraBlocos(F.QMS_823));
const planoPOR = () => ({ subtarefa: 'POR-7132', cenarios: lerPlano(paraBlocos(F.POR_7132)) });

// ---------------- critérios efetivos

test('subitem fica dentro do critério por padrão e vira CA8.1 quando separado', () => {
  assert.equal(C.criteriosEfetivos(leituraQMS()).length, 11);
  const sep = C.criteriosEfetivos(leituraQMS(), { subitens: { CA8: 'separar' } });
  assert.equal(sep.length, 12);
  assert.deepEqual(sep.slice(7, 9).map(c => c.id), ['CA8', 'CA8.1']);
  assert.deepEqual(sep[7].subitens, []);
  assert.match(sep[8].texto, /inelegível/);
});

test('ignorados somem e "não se aplica" guarda o motivo', () => {
  const c = C.criteriosEfetivos(leituraPOR(), { ignorados: ['CA1'], naoSeAplica: { CA13: 'validação documental' } });
  assert.equal(c.length, 12);
  assert.equal(c.find(x => x.id === 'CA13').naoSeAplica, 'validação documental');
  assert.equal(c[0].grupo, 'Cadastro do idioma');
});

// ---------------- sugestões

test('sugere os critérios do idioma certo para cada cenário', () => {
  const crit = C.criteriosEfetivos(leituraPOR());
  const [, ct02, ct03] = lerPlano(paraBlocos(F.POR_7132));
  const s2 = C.sugerirCriterios(ct02, crit);
  const s3 = C.sugerirCriterios(ct03, crit);
  assert.ok(s2.includes('CA5'), `CT02 deveria cobrir CA5 (espanhol): ${s2}`);
  assert.ok(!s2.includes('CA6'), 'CT02 não cobre inglês');
  assert.ok(s3.includes('CA6'), `CT03 deveria cobrir CA6 (inglês): ${s3}`);
  assert.ok(!s3.includes('CA5'));
  assert.ok(!s3.includes('CA10'), 'gatilho de envio não aparece no cenário');
});

test('sem palavras em comum, não sugere nada', () => {
  assert.deepEqual(C.sugerirCriterios({ titulo: 'Login', bdd: 'Dado x\nQuando y\nEntão z' }, C.criteriosEfetivos(leituraPOR())), []);
});

test('positivo ou negativo sugerido pelo BDD', () => {
  assert.equal(C.sugerirNatureza('Given um acesso com Inglês\nThen recebe em Inglês'), 'positivo');
  assert.equal(C.sugerirNatureza('Dado um acesso sem idioma\nEntão usa o padrão'), 'negativo');
  assert.equal(C.sugerirNatureza('Quando informo CPF inválido\nEntão vejo erro'), 'negativo');
  assert.equal(C.sugerirNatureza('Then the button is blocked'), 'negativo');
  assert.equal(C.sugerirNatureza('Dado que estou na tela de semana'), 'positivo', '"sem" só conta como palavra inteira');
});

test('resumo da cobertura: cobertos, sem cenário e não se aplica', () => {
  const crit = C.criteriosEfetivos(leituraPOR(), { naoSeAplica: { CA13: 'documental' } });
  const r = C.resumoCobertura(crit, { CT03: ['CA6', 'CA7'], CT05: ['CA12'], CT02: ['CA5', 'CA7'] }, { CT03: 'Passou', CT05: 'Falhou' });
  assert.equal(r.total, 13);
  assert.equal(r.cobertos, 4);
  assert.equal(r.naoSeAplica, 1);
  assert.equal(r.semCenario, 8);
  assert.deepEqual(r.criterios.find(c => c.id === 'CA7').cts, [{ ct: 'CT02', status: 'Não executado' }, { ct: 'CT03', status: 'Passou' }]);
});

// ---------------- historia.json

test('grava os dados do Jira e preserva a cobertura definida pela pessoa', t => {
  const base = pastaTemp(t);
  store.salvarDadosJira(base, 'POR-6925', { titulo: 'E-mail de Boas-vindas por Idioma', jira: { projeto: 'Portal do cliente' }, criterios: leituraPOR(), plano: planoPOR() });
  store.definirCobertura(base, 'POR-6925', 'CT03', ['CA6', 'CA6', 'CA7']);
  const h = store.salvarDadosJira(base, 'POR-6925', { criterios: leituraPOR(), plano: planoPOR() });
  assert.equal(h.titulo, 'E-mail de Boas-vindas por Idioma');
  assert.deepEqual(h.cobertura.CT03, ['CA6', 'CA7']);
  assert.equal(h.plano.cenarios.length, 4);
  assert.equal(h.plano.subtarefa, 'POR-7132');
  assert.equal(h.criterios.mudou, false);
  // infoHistoria continua devolvendo o título
  assert.equal(store.infoHistoria(base, 'POR-6925').titulo, 'E-mail de Boas-vindas por Idioma');
});

test('critérios alterados no Jira depois da conferência ficam marcados', t => {
  const base = pastaTemp(t);
  store.salvarDadosJira(base, 'POR-6925', { criterios: leituraPOR() });
  store.salvarAjustesCriterios(base, 'POR-6925', { naoSeAplica: { CA13: 'documental' } });
  let h = store.salvarDadosJira(base, 'POR-6925', { criterios: leituraPOR() });
  assert.equal(h.criterios.mudou, false);
  const outra = leituraPOR(); outra.grupos[0].criterios[0].texto = 'Texto novo do PO';
  h = store.salvarDadosJira(base, 'POR-6925', { criterios: outra });
  assert.equal(h.criterios.mudou, true);
  assert.deepEqual(h.criterios.ajustes, { naoSeAplica: { CA13: 'documental' } }, 'ajustes continuam');
});

test('editar um cenário atualiza o plano e as execuções anteriores', t => {
  const base = pastaTemp(t);
  store.salvarDadosJira(base, 'POR-6925', { plano: planoPOR() });
  store.salvarExecucao(base, cenario({ storyId: 'POR-6925', testCaseId: 'CT03', status: 'Falhou' }));
  store.salvarExecucao(base, cenario({ storyId: 'POR-6925', testCaseId: 'CT03', status: 'Passou' }), 'nova');
  store.atualizarCenario(base, 'POR-6925', 'CT03', { titulo: 'Inglês revisado', bdd: 'Given a\nWhen b\nThen c' });
  const ex = store.lerCenario(base, 'POR-6925', 'CT03').execucoes;
  assert.deepEqual(ex.map(e => e.bdd), ['Given a\nWhen b\nThen c', 'Given a\nWhen b\nThen c']);
  assert.deepEqual(ex.map(e => e.titulo), ['Inglês revisado', 'Inglês revisado']);
  const c = store.lerHistoria(base, 'POR-6925').plano.cenarios.find(x => x.ct === 'CT03');
  assert.equal(c.titulo, 'Inglês revisado');
  assert.ok(c.editadoEm);
  assert.equal(c.gravadoNoJira, false);
});

test('edição não gravada no Jira sobrevive a uma nova leitura, e conflito é marcado', t => {
  const base = pastaTemp(t);
  store.salvarDadosJira(base, 'POR-6925', { plano: planoPOR() });
  store.atualizarCenario(base, 'POR-6925', 'CT03', { bdd: 'Given local\nWhen b\nThen c' });
  let h = store.salvarDadosJira(base, 'POR-6925', { plano: planoPOR() });
  let c = h.plano.cenarios.find(x => x.ct === 'CT03');
  assert.equal(c.bdd, 'Given local\nWhen b\nThen c');
  assert.equal(c.conflito, undefined);
  const mudado = planoPOR(); mudado.cenarios[2].bdd = 'Given alterado no Jira\nWhen b\nThen c';
  h = store.salvarDadosJira(base, 'POR-6925', { plano: mudado });
  c = h.plano.cenarios.find(x => x.ct === 'CT03');
  assert.equal(c.bdd, 'Given local\nWhen b\nThen c');
  assert.equal(c.conflito, true);
  assert.equal(c.lidoDoJira.bdd, 'Given alterado no Jira\nWhen b\nThen c');
});

test('cenário alterado só no Jira é marcado como "mudou no Jira"', t => {
  const base = pastaTemp(t);
  store.salvarDadosJira(base, 'POR-6925', { plano: planoPOR() });
  const mudado = planoPOR(); mudado.cenarios[1].titulo = 'Espanhol (novo)';
  const c = store.salvarDadosJira(base, 'POR-6925', { plano: mudado }).plano.cenarios.find(x => x.ct === 'CT02');
  assert.equal(c.titulo, 'Espanhol (novo)');
  assert.equal(c.mudouNoJira, true);
});

test('edição gravada no Jira não vira conflito na próxima leitura', t => {
  const base = pastaTemp(t);
  store.salvarDadosJira(base, 'POR-6925', { plano: planoPOR() });
  store.atualizarCenario(base, 'POR-6925', 'CT03', { bdd: 'Given novo\nWhen b\nThen c', gravadoNoJira: true });
  const noJira = planoPOR(); noJira.cenarios[2].bdd = 'Given novo\nWhen b\nThen c';
  const c = store.salvarDadosJira(base, 'POR-6925', { plano: noJira }).plano.cenarios.find(x => x.ct === 'CT03');
  assert.equal(c.conflito, undefined);
  assert.equal(c.mudouNoJira, undefined);
});

test('cenário novo criado no app pega o próximo número e já guarda a cobertura', t => {
  const base = pastaTemp(t);
  store.salvarDadosJira(base, 'POR-6925', { plano: planoPOR() });
  const r = store.adicionarCenario(base, 'POR-6925', { titulo: 'Idioma padrão', bdd: 'Given sem idioma\nWhen enviado\nThen padrão', origem: 'criterio', origemDetalhe: 'CA12', criterios: ['CA12'] });
  assert.equal(r.ct, 'CT05');
  assert.deepEqual(r.historia.cobertura.CT05, ['CA12']);
  // uma nova leitura do Jira (ainda sem o CT05) não apaga o cenário local
  const h = store.salvarDadosJira(base, 'POR-6925', { plano: planoPOR() });
  assert.deepEqual(h.plano.cenarios.map(c => c.ct), ['CT01', 'CT02', 'CT03', 'CT04', 'CT05']);
});

test('execução guarda positivo/negativo, critérios e origem', t => {
  const base = pastaTemp(t);
  store.salvarExecucao(base, cenario({ natureza: 'negativo', criterios: ['CA12'], origem: 'criterio' }));
  const ex = store.lerCenario(base, 'QMS-1036', 'CT01').execucoes[0];
  assert.equal(ex.natureza, 'negativo');
  assert.deepEqual(ex.criterios, ['CA12']);
  assert.equal(ex.origem, 'criterio');
  assert.equal(store.ultimaExecucao(base, 'QMS-1036', 'CT01').natureza, 'negativo');
  store.salvarExecucao(base, cenario({ testCaseId: 'CT02' }));
  assert.equal(store.lerCenario(base, 'QMS-1036', 'CT02').execucoes[0].natureza, null, 'execuções antigas ficam sem natureza');
});

test('definirNatureza guarda a escolha por CT', t => {
  const base = pastaTemp(t);
  store.definirNatureza(base, 'POR-6925', 'CT05', 'negativo');
  assert.equal(store.lerHistoria(base, 'POR-6925').natureza.CT05, 'negativo');
});
