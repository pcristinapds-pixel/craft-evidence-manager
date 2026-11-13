const test = require('node:test');
const assert = require('node:assert/strict');
const { paraBlocos, paraTexto, deTexto, chaveDoLink } = require('../src/main/adf');
const F = require('./fixtures/adf');

test('parágrafos e títulos viram blocos com o texto', () => {
  const b = paraBlocos(F.doc(F.h(2, '1. Validar envio'), F.p(F.forte('Given'), ' um acesso')));
  assert.deepEqual(b, [{ tipo: 'titulo', nivel: 2, texto: '1. Validar envio' }, { tipo: 'paragrafo', texto: 'Given um acesso' }]);
});

test('lista numerada guarda o número e subitens ficam um nível abaixo', () => {
  const itens = paraBlocos(F.QMS_823).filter(b => b.tipo === 'item');
  const oito = itens.findIndex(b => b.nivel === 1 && b.numero === 8);
  assert.ok(oito >= 0);
  assert.equal(itens[oito + 1].nivel, 2);
  assert.match(itens[oito + 1].texto, /inelegível/);
  assert.equal(itens[oito + 2].numero, 9);
});

test('citação de issue e etiqueta de status viram texto simples', () => {
  const onze = paraBlocos(F.QMS_823).find(b => b.tipo === 'item' && b.numero === 11);
  assert.match(onze.texto, /ZIP code da QMS-795 EM REFINAMENTO \(R\) , entra/);
  assert.doesNotMatch(onze.texto, /object/);
});

test('régua horizontal vira um bloco "linha"', () => {
  assert.equal(paraBlocos(F.POR_7132).filter(b => b.tipo === 'linha').length, 3);
});

test('aceita texto simples (Jira antigo) e valores vazios', () => {
  assert.deepEqual(paraBlocos('linha 1\r\n\r\nlinha 2'), [{ tipo: 'paragrafo', texto: 'linha 1' }, { tipo: 'paragrafo', texto: 'linha 2' }]);
  assert.deepEqual(paraBlocos(null), []);
  assert.deepEqual(paraBlocos({ type: 'doc', content: [] }), []);
});

test('quebra de linha dentro do parágrafo vira linhas separadas', () => {
  const b = paraBlocos(F.doc({ type: 'paragraph', content: [F.t('a'), { type: 'hardBreak' }, F.t('b')] }));
  assert.deepEqual(b.map(x => x.texto), ['a', 'b']);
});

test('paraTexto monta listas com número e marcador', () => {
  const txt = paraTexto(F.doc(F.ol('um', F.li('dois', F.ul('dois-a'))), F.rule()));
  assert.equal(txt, '1. um\n2. dois\n  - dois-a\n---');
});

test('deTexto monta um ADF que volta ao mesmo texto', () => {
  const txt = 'Given x\nWhen y\n---\nThen z';
  assert.equal(paraTexto(deTexto(txt)), txt);
});

test('chaveDoLink extrai a chave de um link do Jira', () => {
  assert.equal(chaveDoLink('https://x.atlassian.net/browse/QMS-795'), 'QMS-795');
  assert.equal(chaveDoLink('https://exemplo.com'), undefined);
});
