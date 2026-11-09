const test = require('node:test');
const assert = require('node:assert/strict');
const { mascarar, variaveis } = require('../src/main/mascarar');

test('troca token Bearer do Authorization por {{TOKEN}}', () => {
  const r = mascarar('curl https://api/x -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"');
  assert.match(r, /Authorization: Bearer \{\{TOKEN\}\}/);
  assert.doesNotMatch(r, /eyJhbGci/);
});

test('troca credencial Basic por {{CREDENCIAIS_BASE64}}', () => {
  const r = mascarar('curl -H "Authorization: Basic dXNlcjpzZW5oYTEyMw=="');
  assert.match(r, /Basic \{\{CREDENCIAIS_BASE64\}\}/);
});

test('troca chave de API em cabeçalho e em query string', () => {
  const r = mascarar('curl "https://api/x?api_key=AbC123xyz" -H "x-api-key: k3y-s3cr3t-999"');
  assert.match(r, /api_key=\{\{API_KEY\}\}/);
  assert.match(r, /x-api-key: \{\{API_KEY\}\}/);
  assert.doesNotMatch(r, /AbC123xyz|k3y-s3cr3t/);
});

test('troca senha do -u usuario:senha, mantendo o usuário', () => {
  assert.match(mascarar('curl -u admin:minhaSenha https://api/x'), /-u admin:\{\{SENHA\}\}/);
});

test('troca senha e token no corpo JSON', () => {
  const r = mascarar(`curl --data-raw '{"password":"abc123","access_token":"tkn999","nome":"Ana"}'`);
  assert.match(r, /"password":"\{\{SENHA\}\}"/);
  assert.match(r, /"access_token":"\{\{TOKEN\}\}"/);
  assert.match(r, /"nome":"Ana"/, 'campos comuns não são alterados');
});

test('troca token e senha na query string', () => {
  const r = mascarar('curl "https://api/x?token=abcdef123&senha=xyz&pagina=2"');
  assert.match(r, /token=\{\{TOKEN\}\}/);
  assert.match(r, /senha=\{\{SENHA\}\}/);
  assert.match(r, /pagina=2/);
});

test('troca CPF formatado e campo "cpf"', () => {
  const r = mascarar(`curl --data '{"cpf":"12345678909","doc":"123.456.789-09"}'`);
  assert.match(r, /"cpf":"\{\{CPF\}\}"/);
  assert.doesNotMatch(r, /123\.456\.789-09|12345678909/);
});

test('cURL sem segredos fica igual', () => {
  const c = 'curl -X GET "https://api.craft.com/v1/history?localizador=LOC8F3K2" -H "Accept: application/json"';
  assert.equal(mascarar(c), c);
});

test('valores vazios não quebram', () => {
  assert.equal(mascarar(''), '');
  assert.equal(mascarar(null), null);
  assert.equal(mascarar(undefined), undefined);
});

test('variaveis() lista cada variável uma vez', () => {
  assert.deepEqual(variaveis('{{TOKEN}} x {{SENHA}} y {{TOKEN}}'), ['{{TOKEN}}', '{{SENHA}}']);
  assert.deepEqual(variaveis(''), []);
});
