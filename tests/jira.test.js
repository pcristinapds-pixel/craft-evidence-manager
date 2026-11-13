const test = require('node:test');
const assert = require('node:assert/strict');
const { criarCliente, JiraErro, normalizarSite } = require('../src/main/jira');
const F = require('./fixtures/adf');

// fetch falso: responde conforme o caminho e guarda as chamadas
function fetchFalso(rotas) {
  const chamadas = [];
  const f = async (url, opts) => {
    chamadas.push({ url, ...opts });
    const caminho = url.replace(/^https:\/\/[^/]+/, '');
    const chave = Object.keys(rotas).find(k => caminho.startsWith(k));
    if (!chave) return resp(404, {});
    const r = typeof rotas[chave] === 'function' ? rotas[chave](caminho, opts) : rotas[chave];
    return r && r.status ? r : resp(200, r);
  };
  f.chamadas = chamadas;
  return f;
}
function resp(status, corpo) {
  return { status, ok: status >= 200 && status < 300, json: async () => corpo, text: async () => (corpo == null ? '' : JSON.stringify(corpo)) };
}
const cliente = rotas => criarCliente({ site: 'https://craft.atlassian.net/browse/', email: 'ana@craft.com', token: 'tok', fetch: fetchFalso(rotas) });

test('normalizarSite aceita link de browse, sem https e com barra', () => {
  assert.equal(normalizarSite('https://craft-multi-team.atlassian.net/browse/'), 'https://craft-multi-team.atlassian.net');
  assert.equal(normalizarSite('craft.atlassian.net'), 'https://craft.atlassian.net');
  assert.equal(normalizarSite(''), '');
});

test('sem configuração completa, avisa antes de chamar o Jira', () => {
  assert.throws(() => criarCliente({ site: 'x.atlassian.net', email: '', token: 't' }), e => e instanceof JiraErro && e.tipo === 'config');
});

test('envia e-mail e token como Basic e lê o usuário', async () => {
  const f = fetchFalso({ '/rest/api/3/myself': { accountId: 'a1', displayName: 'Ana Souza' } });
  const c = criarCliente({ site: 'craft.atlassian.net', email: 'ana@craft.com', token: 'tok', fetch: f });
  assert.deepEqual(await c.eu(), { accountId: 'a1', nome: 'Ana Souza', email: 'ana@craft.com' });
  assert.equal(f.chamadas[0].headers.Authorization, 'Basic ' + Buffer.from('ana@craft.com:tok').toString('base64'));
  assert.equal(f.chamadas[0].url, 'https://craft.atlassian.net/rest/api/3/myself');
});

test('token expirado ou revogado vira erro do tipo "token"', async () => {
  const c = cliente({ '/rest/api/3/myself': resp(401, {}) });
  await assert.rejects(c.eu(), e => e.tipo === 'token' && /recusou seu token/.test(e.message));
});

test('falha de rede vira erro do tipo "rede"', async () => {
  const c = criarCliente({ site: 'x.atlassian.net', email: 'a', token: 'b', fetch: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(c.eu(), e => e.tipo === 'rede');
});

test('chave inválida é recusada sem chamar o Jira', async () => {
  const c = cliente({});
  await assert.rejects(c.historia('6925'), e => e.tipo === 'nao-encontrado');
});

function issueHistoria(campos = {}) {
  return {
    key: 'POR-6925',
    names: { customfield_10100: 'Descrição para história', customfield_10200: 'Descrição Épico', description: 'Descrição' },
    fields: {
      summary: 'E-mail de Boas-vindas por Idioma',
      issuetype: { name: 'Historia', subtask: false },
      status: { name: 'AG. Deploy', statusCategory: { key: 'indeterminate' } },
      project: { key: 'POR', name: 'Portal do cliente' },
      description: null,
      customfield_10100: F.POR_6925,
      subtasks: [
        { key: 'POR-7132', fields: { summary: '[QA] Análise e Escrita dos Cenários de Teste', issuetype: { name: 'Sub-tarefa' }, status: { name: 'CONCLUÍDO EFICIÊNCIA', statusCategory: { key: 'done' } } } },
        { key: 'POR-7137', fields: { summary: '[FRONT] Revisar e adequar os templates', issuetype: { name: 'Sub-tarefa' }, status: { name: 'Em andamento', statusCategory: { key: 'indeterminate' } } } }
      ],
      comment: { comments: [{ id: '1', author: { displayName: 'Jean Oliveira' }, created: '2026-11-11T10:00:00.000-0300', body: F.COMENTARIO_COMMIT }] },
      updated: '2026-11-13T16:01:00.000-0300',
      ...campos
    }
  };
}

test('história: acha a descrição no campo personalizado pelo nome', async () => {
  const c = cliente({ '/rest/api/3/issue/POR-6925': issueHistoria() });
  const h = await c.historia('por-6925');
  assert.equal(h.chave, 'POR-6925');
  assert.equal(h.titulo, 'E-mail de Boas-vindas por Idioma');
  assert.equal(h.campoDescricao, 'Descrição para história');
  assert.ok(h.blocos.some(b => b.texto === '4.Critérios de aceite:'));
  assert.equal(h.subtarefas.length, 2);
  assert.equal(h.subtarefas[0].statusCategoria, 'done');
  assert.equal(h.comentarios[0].autor, 'Jean Oliveira');
  assert.equal(h.epico, false);
});

test('história: épico usa a "Descrição Épico"', async () => {
  const i = issueHistoria({ issuetype: { name: 'Epico', subtask: false }, customfield_10100: null, customfield_10200: F.CNN_1935 });
  const c = cliente({ '/rest/api/3/issue/': i });
  const h = await c.historia('CNN-1935');
  assert.equal(h.campoDescricao, 'Descrição Épico');
  assert.equal(h.epico, true);
});

test('história: sem campo personalizado, usa a descrição padrão', async () => {
  const c = cliente({ '/rest/api/3/issue/': issueHistoria({ customfield_10100: null, description: F.doc(F.p('texto')) }) });
  const h = await c.historia('POR-1');
  assert.equal(h.campoDescricao, 'Descrição');
  assert.equal(h.texto, 'texto');
});

test('minhas sub-tasks: filtra pelo prefixo [QA] e segue a paginação', async () => {
  const pagina = (issues, isLast, nextPageToken) => ({ issues, isLast, nextPageToken });
  const sub = (key, summary) => ({ key, fields: { summary, issuetype: { name: 'Sub-tarefa', subtask: true }, status: { name: 'A fazer', statusCategory: { key: 'new' } }, project: { key: 'POR', name: 'Portal do cliente' }, parent: { key: 'POR-6925', fields: { summary: 'E-mail' } } } });
  let n = 0;
  const f = fetchFalso({ '/rest/api/3/search/jql': () => (++n === 1
    ? pagina([sub('POR-7141', '[QA] Testes e Coleta de Evidências'), sub('POR-7137', '[FRONT] Templates')], false, 'p2')
    : pagina([sub('POR-7210', '[qa] Análise e Escrita dos Cenários de Teste')], true)) });
  const c = criarCliente({ site: 'x.atlassian.net', email: 'a', token: 'b', fetch: f });
  const lista = await c.minhasSubtarefas();
  assert.deepEqual(lista.map(s => s.chave), ['POR-7141', 'POR-7210']);
  assert.equal(lista[0].pai.chave, 'POR-6925');
  const corpo1 = JSON.parse(f.chamadas[0].body);
  assert.match(corpo1.jql, /assignee = currentUser\(\)/);
  assert.match(corpo1.jql, /statusCategory != Done/);
  assert.equal(JSON.parse(f.chamadas[1].body).nextPageToken, 'p2');
});

test('atualizarDescricao envia PUT com o ADF', async () => {
  const f = fetchFalso({ '/rest/api/3/issue/POR-7132': resp(204, null) });
  const c = criarCliente({ site: 'x.atlassian.net', email: 'a', token: 'b', fetch: f });
  await c.atualizarDescricao('POR-7132', F.doc(F.p('x')));
  assert.equal(f.chamadas[0].method, 'PUT');
  assert.deepEqual(JSON.parse(f.chamadas[0].body).fields.description.content[0].content[0].text, 'x');
});

test('erro do Jira traz a mensagem dele', async () => {
  const c = cliente({ '/rest/api/3/issue/': resp(400, { errorMessages: ['Campo inválido'] }) });
  await assert.rejects(c.historia('POR-1'), e => e.tipo === 'jira' && /400\. Campo inválido/.test(e.message));
});
