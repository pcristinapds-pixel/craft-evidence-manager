// Cliente do Jira Cloud (API REST v3), usado pelo processo principal.
// Autenticação: e-mail + token de API pessoal (Basic). O app vê e altera no Jira
// exatamente o que a pessoa dona do token pode ver e alterar.
const { paraBlocos, paraTexto } = require('./adf');

class JiraErro extends Error {
  // tipo: 'config' | 'token' | 'permissao' | 'nao-encontrado' | 'rede' | 'jira'
  constructor(mensagem, tipo, status) { super(mensagem); this.tipo = tipo; this.status = status; }
}

// Campos onde a descrição da história pode estar, em ordem de preferência
const CAMPOS_DESCRICAO = ['Descrição para história', 'Descrição Épico', 'Descrição do Problema', 'description'];

// "https://empresa.atlassian.net/browse/" ou ".../jira/software/..." -> "https://empresa.atlassian.net"
function normalizarSite(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    return `${u.protocol}//${u.host}`;
  } catch { return ''; }
}

const mesmoNome = (a, b) => String(a || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  === String(b || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function criarCliente({ site, email, token, fetch = globalThis.fetch } = {}) {
  const base = normalizarSite(site);
  if (!base || !email || !token) throw new JiraErro('Configure o endereço do Jira, seu e-mail e o token de API.', 'config');
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

  async function req(caminho, { method = 'GET', body, headers = {} } = {}) {
    let r;
    const ehForm = typeof FormData !== 'undefined' && body instanceof FormData; // anexos vão como multipart
    try {
      r = await fetch(base + caminho, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', ...(body != null && !ehForm ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body == null ? undefined : (ehForm || typeof body === 'string' ? body : JSON.stringify(body))
      });
    } catch (e) {
      throw new JiraErro('Não foi possível falar com o Jira. Confira a internet e o endereço do Jira.', 'rede');
    }
    if (r.status === 401) throw new JiraErro('O Jira recusou seu token de API. Ele expirou ou foi revogado: gere um novo nas configurações.', 'token', 401);
    if (r.status === 403) throw new JiraErro('Seu usuário não tem permissão para isso no Jira.', 'permissao', 403);
    if (r.status === 404) throw new JiraErro('Não encontrei isso no Jira. Confira a chave (ex.: POR-6925).', 'nao-encontrado', 404);
    if (!r.ok) {
      let detalhe = '';
      try { const j = await r.json(); detalhe = [...(j.errorMessages || []), ...Object.values(j.errors || {})].join(' '); } catch {}
      throw new JiraErro(`O Jira respondeu com erro ${r.status}.${detalhe ? ' ' + detalhe : ''}`, 'jira', r.status);
    }
    if (r.status === 204) return null;
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  // Quem é o dono do token (também serve para testar a conexão)
  async function eu() {
    const u = await req('/rest/api/3/myself');
    return { accountId: u.accountId, nome: u.displayName, email: u.emailAddress || email };
  }

  // Issue com os nomes dos campos, para achar campos personalizados pelo nome
  async function issueBruta(chave, campos = '*all') {
    if (!/^[A-Z][A-Z0-9_]*-\d+$/i.test(String(chave || '').trim())) throw new JiraErro('Informe uma chave do Jira, como POR-6925.', 'nao-encontrado');
    return req(`/rest/api/3/issue/${encodeURIComponent(String(chave).trim().toUpperCase())}?fields=${encodeURIComponent(campos)}&expand=names`);
  }

  const resumoIssue = i => ({
    chave: i.key,
    titulo: i.fields.summary || '',
    tipo: i.fields.issuetype ? i.fields.issuetype.name : '',
    subtarefa: !!(i.fields.issuetype && i.fields.issuetype.subtask),
    status: i.fields.status ? i.fields.status.name : '',
    statusCategoria: i.fields.status && i.fields.status.statusCategory ? i.fields.status.statusCategory.key : '',
    responsavel: i.fields.assignee ? { accountId: i.fields.assignee.accountId, nome: i.fields.assignee.displayName } : null
  });

  // História (ou qualquer issue) com tudo o que o app usa
  async function historia(chave) {
    const i = await issueBruta(chave);
    const f = i.fields || {};
    const nomes = i.names || {};
    const idDoCampo = nome => nome === 'description' ? 'description' : Object.keys(nomes).find(id => mesmoNome(nomes[id], nome));
    let campoDescricao = null, descricao = null;
    for (const nome of CAMPOS_DESCRICAO) {
      const id = idDoCampo(nome);
      const valor = id && f[id];
      if (valor && paraBlocos(valor).length) { campoDescricao = nome === 'description' ? 'Descrição' : nomes[id]; descricao = valor; break; }
    }
    return {
      ...resumoIssue(i),
      projeto: f.project ? { chave: f.project.key, nome: f.project.name } : null,
      pai: f.parent ? { chave: f.parent.key, titulo: f.parent.fields && f.parent.fields.summary, tipo: f.parent.fields && f.parent.fields.issuetype && f.parent.fields.issuetype.name } : null,
      epico: /^(epic|épico|epico)$/i.test(f.issuetype ? f.issuetype.name : ''),
      campoDescricao,
      descricao,                       // ADF original
      blocos: paraBlocos(descricao),   // para os leitores de critérios/cenários
      texto: paraTexto(descricao),
      subtarefas: (f.subtasks || []).map(s => ({
        chave: s.key, titulo: s.fields.summary, tipo: s.fields.issuetype && s.fields.issuetype.name,
        status: s.fields.status && s.fields.status.name,
        statusCategoria: s.fields.status && s.fields.status.statusCategory ? s.fields.status.statusCategory.key : ''
      })),
      comentarios: ((f.comment && f.comment.comments) || []).map(c => ({
        id: c.id, autor: c.author ? c.author.displayName : '', data: c.created, blocos: paraBlocos(c.body), texto: paraTexto(c.body)
      })),
      atualizadoEm: f.updated || null
    };
  }

  // Sub-task com a descrição padrão (onde fica o plano de testes)
  async function subtarefa(chave) {
    const i = await issueBruta(chave, 'summary,issuetype,status,assignee,description,updated,parent');
    return { ...resumoIssue(i), descricao: i.fields.description, blocos: paraBlocos(i.fields.description), atualizadoEm: i.fields.updated || null };
  }

  // Sub-tasks abertas atribuídas a mim (opcionalmente só as que começam com um prefixo, ex.: "[QA]")
  async function minhasSubtarefas({ prefixo = '[QA]', max = 100 } = {}) {
    const jql = 'assignee = currentUser() AND issuetype in subTaskIssueTypes() AND statusCategory != Done ORDER BY updated DESC';
    const issues = [];
    let nextPageToken;
    do {
      const r = await req('/rest/api/3/search/jql', {
        method: 'POST',
        body: { jql, maxResults: 50, nextPageToken, fields: ['summary', 'status', 'parent', 'project', 'issuetype', 'updated'] }
      });
      issues.push(...(r.issues || []));
      nextPageToken = r.isLast === false ? r.nextPageToken : undefined;
    } while (nextPageToken && issues.length < max);
    return issues
      .map(i => ({
        ...resumoIssue(i),
        projeto: i.fields.project ? { chave: i.fields.project.key, nome: i.fields.project.name } : null,
        pai: i.fields.parent ? { chave: i.fields.parent.key, titulo: i.fields.parent.fields && i.fields.parent.fields.summary } : null,
        atualizadoEm: i.fields.updated || null
      }))
      .filter(s => !prefixo || s.titulo.trim().toUpperCase().startsWith(prefixo.toUpperCase()));
  }

  // Troca a descrição padrão de uma issue (usado para gravar o plano na sub-task)
  async function atualizarDescricao(chave, adf) {
    await req(`/rest/api/3/issue/${encodeURIComponent(chave)}`, { method: 'PUT', body: { fields: { description: adf } } });
  }

  // ---- sub-falha
  // Tipo de issue "Sub-falha" (ou outro tipo de sub-tarefa com "falha"/"bug" no nome) do projeto
  async function tipoSubFalha(projeto) {
    const r = await req(`/rest/api/3/issue/createmeta/${encodeURIComponent(projeto)}/issuetypes?maxResults=100`);
    const tipos = (r.issueTypes || r.values || []).filter(t => t.subtask);
    const t = tipos.find(x => mesmoNome(x.name, 'Sub-falha')) || tipos.find(x => /falha|bug|defeito/i.test(x.name));
    if (!t) throw new JiraErro(`O projeto ${projeto} não tem o tipo de issue "Sub-falha".`, 'config');
    return { id: t.id, nome: t.name };
  }

  async function prioridades() {
    const r = await req('/rest/api/3/priority');
    return (r || []).map(p => ({ id: p.id, nome: p.name }));
  }

  // Cria a issue e devolve { chave, url }
  async function criarIssue(fields) {
    const r = await req('/rest/api/3/issue', { method: 'POST', body: { fields } });
    return { chave: r.key, url: `${base}/browse/${r.key}` };
  }

  // Anexa arquivos: [{ nome, conteudo: Buffer, tipo }]
  async function anexar(chave, arquivos) {
    if (!arquivos.length) return [];
    const form = new FormData();
    arquivos.forEach(a => form.append('file', new Blob([a.conteudo], { type: a.tipo || 'application/octet-stream' }), a.nome));
    return req(`/rest/api/3/issue/${encodeURIComponent(chave)}/attachments`, { method: 'POST', body: form, headers: { 'X-Atlassian-Token': 'no-check' } });
  }

  async function issueExiste(chave) {
    const i = await issueBruta(chave, 'summary,issuetype,parent');
    return { chave: i.key, titulo: i.fields.summary, tipo: i.fields.issuetype && i.fields.issuetype.name, pai: i.fields.parent ? i.fields.parent.key : null, url: `${base}/browse/${i.key}` };
  }

  return { site: base, req, eu, historia, subtarefa, minhasSubtarefas, atualizarDescricao, tipoSubFalha, prioridades, criarIssue, anexar, issueExiste };
}

module.exports = { criarCliente, JiraErro, normalizarSite, CAMPOS_DESCRICAO };
