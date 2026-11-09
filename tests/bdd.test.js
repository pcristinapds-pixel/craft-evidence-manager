const test = require('node:test');
const assert = require('node:assert/strict');
const { validarBdd } = require('../src/renderer/bdd');

const ok = t => assert.equal(validarBdd(t), '', `deveria aceitar: ${JSON.stringify(t)}`);
const erro = (t, trecho) => assert.match(validarBdd(t), trecho, `deveria recusar: ${JSON.stringify(t)}`);

test('aceita Dado / Quando / Então em linhas separadas', () => {
  ok('Dado que estou logado\nQuando abro o histórico\nEntão vejo a tabela');
});

test('aceita E e Mas entre os passos', () => {
  ok('Dado que estou logado\nE tenho reservas\nQuando filtro\nMas sem período\nEntão vejo 3 eventos\nE o total');
});

test('ignora maiúsculas, acentos, espaços e linhas vazias', () => {
  ok('  DADO que x\n\nquando y\n   entao z  ');
  ok('Dados os filtros\nQuando aplico\nEntão vejo');
});

test('recusa texto sem estrutura e diz o que faltou', () => {
  erro('qqqqqq', /Faltou: Dado, Quando, Então/);
  erro('', /Faltou: Dado, Quando, Então/);
  erro(null, /Faltou/);
});

test('recusa passo faltando', () => {
  erro('Dado x\nEntão z', /Faltou: Quando\./);
  erro('Dado x\nQuando y', /Faltou: Então\./);
});

test('recusa passos na mesma linha', () => {
  erro('Dado x Quando y Então z', /Faltou: Quando, Então/);
});

test('recusa palavra-chave colada no texto', () => {
  erro('Dadoque x\nQuando y\nEntão z', /Faltou: Dado/);
});

test('recusa ordem errada', () => {
  erro('Quando y\nDado x\nEntão z', /ordem Dado → Quando → Então/);
  erro('Dado x\nEntão z\nQuando y', /ordem/);
});

test('mensagem de erro traz um exemplo', () => {
  assert.match(validarBdd('x'), /Exemplo:\nDado que/);
});
