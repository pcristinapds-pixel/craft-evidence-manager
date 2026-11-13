const test = require('node:test');
const assert = require('node:assert/strict');
const { salvarToken, lerToken, configJira } = require('../src/main/credenciais');

const storeFalso = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => m.set(k, v), delete: k => m.delete(k), m }; };
// "criptografia" de mentira: inverte os bytes
const cifra = (disponivel = true) => ({
  isEncryptionAvailable: () => disponivel,
  encryptString: s => Buffer.from(s).reverse(),
  decryptString: b => Buffer.from(b).reverse().toString()
});

test('guarda o token criptografado e lê de volta', () => {
  const s = storeFalso();
  salvarToken(s, cifra(), '  ATATT3xFf  ');
  assert.notEqual(s.get('jiraToken'), 'ATATT3xFf');
  assert.doesNotMatch(s.get('jiraToken'), /ATATT3xFf/);
  assert.equal(lerToken(s, cifra()), 'ATATT3xFf');
});

test('token vazio apaga o guardado', () => {
  const s = storeFalso();
  salvarToken(s, cifra(), 'x');
  salvarToken(s, cifra(), '');
  assert.equal(s.get('jiraToken'), undefined);
});

test('sem armazenamento seguro, não guarda em texto aberto', () => {
  const s = storeFalso();
  assert.throws(() => salvarToken(s, cifra(false), 'abc'), /armazenamento seguro/);
  assert.equal(s.get('jiraToken'), undefined);
});

test('configJira nunca devolve o token', () => {
  const s = storeFalso();
  s.set('jiraSite', 'https://craft.atlassian.net'); s.set('jiraEmail', 'ana@craft.com');
  salvarToken(s, cifra(), 'segredo');
  const c = configJira(s, cifra());
  assert.deepEqual(c, { site: 'https://craft.atlassian.net', email: 'ana@craft.com', temToken: true, prefixoPlano: '[QA]' });
  assert.doesNotMatch(JSON.stringify(c), /segredo/);
});
