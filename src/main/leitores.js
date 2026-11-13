// Leitores do texto vindo do Jira (já convertido em blocos por adf.js):
//  - lerCriterios: critérios de aceite da descrição da história
//  - lerPlano:     cenários de teste da descrição da sub-task [QA]
//  - lerRegrasComentarios: regras de negócio escritas nos comentários
//  - substituirCenario: troca um cenário no ADF da sub-task, sem mexer no resto

const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PASSO = /^(dado|dada|dados|dadas|quando|entao|e|mas|given|when|then|and|but)\b/;
const INICIO_PASSO = /^(dado|dada|dados|dadas|given)\b/;
const TITULO_CENARIO = /^(cenario|scenario|esquema do cenario|scenario outline)\s*\d*\s*:\s*/;
const TITULO_CRITERIOS = /^(\d+\s*[.)-]?\s*)?(criterios?\s+de\s+(aceite|aceitacao|sucesso)|acceptance\s+criteria|ca)\s*:?\s*(.*)$/;
const SECAO_NUMERADA = /^(\d+)\s*[.)]\s*\S/;

// ---------------------------------------------------------------- critérios

function lerCriterios(blocos) {
  blocos = blocos || [];
  let inicio = -1, numSecao = null, titulo = '';
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    if (b.tipo !== 'titulo' && b.tipo !== 'paragrafo') continue;
    const m = sem(b.texto).match(TITULO_CRITERIOS);
    // "CA" sozinho só vale como título curto (evita pegar frases que começam com "ca")
    if (m && (m[2] !== 'ca' || sem(b.texto).length <= 4) && !m[4]) {
      inicio = i; titulo = b.texto; const n = sem(b.texto).match(/^(\d+)/); numSecao = n ? Number(n[1]) : null; break;
    }
  }
  const encontrado = inicio >= 0;
  let fim = blocos.length;
  if (encontrado) {
    const nivelTitulo = blocos[inicio].tipo === 'titulo' ? blocos[inicio].nivel : null;
    for (let i = inicio + 1; i < blocos.length; i++) {
      const b = blocos[i];
      if (b.tipo === 'titulo' && nivelTitulo != null && b.nivel <= nivelTitulo) { fim = i; break; }
      if (b.tipo !== 'paragrafo' && b.tipo !== 'titulo') continue;
      const n = sem(b.texto).match(SECAO_NUMERADA);
      if (n && numSecao != null && Number(n[1]) > numSecao) { fim = i; break; }
      // outra seção no estilo "Principais Entregas:" (título curto terminado em dois-pontos)
      if (numSecao == null && /:$/.test(b.texto) && b.texto.length <= 40 && !PASSO.test(sem(b.texto))) { fim = i; break; }
    }
  }
  const trecho = encontrado ? blocos.slice(inicio + 1, fim) : blocos;
  const gherkin = trecho.some(b => b.tipo !== 'item' && PASSO.test(sem(b.texto)) && /^(dado|dada|dados|dadas|given|quando|when|entao|then)\b/.test(sem(b.texto)));
  const grupos = [];
  let grupo = null;
  const novoGrupo = nome => { grupo = { nome, criterios: [] }; grupos.push(grupo); };
  const add = (texto, extra = {}) => { if (!grupo) novoGrupo(null); grupo.criterios.push({ texto, subitens: [], ...extra }); };
  const ultimo = () => grupo && grupo.criterios[grupo.criterios.length - 1];

  if (gherkin) {
    let atual = null;
    for (const b of trecho) {
      if (SO_TAGS.test((b.texto || '').trim())) continue; // tags "@C08" não são passos
      const s = sem(b.texto || '');
      if (b.tipo === 'linha' || !b.texto) { atual = null; continue; }
      if (b.tipo === 'titulo' || TITULO_CENARIO.test(s)) {
        atual = { texto: b.texto.replace(/^\s*(cen[aá]rio|scenario|esquema do cen[aá]rio|scenario outline)\s*\d*\s*:\s*/i, ''), passos: [] };
        add(atual.texto, { passos: atual.passos }); continue;
      }
      if (INICIO_PASSO.test(s) && (!atual || atual.passos.length)) { atual = { passos: [] }; add('', { passos: atual.passos }); }
      if (!atual) { atual = { passos: [] }; add('', { passos: atual.passos }); }
      atual.passos.push(b.texto);
    }
    grupos.forEach(g => g.criterios.forEach(c => {
      c.bdd = c.passos.join('\n');
      if (!c.texto) c.texto = c.passos.join(' ');
      delete c.passos;
    }));
  } else {
    for (let k = 0; k < trecho.length; k++) {
      const b = trecho[k];
      if (b.tipo === 'linha' || b.tipo === 'codigo' || SO_TAGS.test((b.texto || '').trim())) continue;
      if (b.tipo === 'item') {
        if (b.nivel === 1 || !ultimo()) add(b.texto);
        else ultimo().subitens.push({ texto: b.texto });
        continue;
      }
      // título, ou parágrafo curto seguido de lista: nome de grupo
      const prox = trecho[k + 1];
      const curto = b.texto.length <= 60 && !/[.;]$/.test(b.texto);
      if (b.tipo === 'titulo' || (curto && prox && prox.tipo === 'item')) { novoGrupo(b.texto.replace(/:$/, '')); continue; }
      // texto corrido: cada parágrafo vira um critério, marcado como leitura incerta
      add(b.texto.replace(/^\d+\s*[.)]\s*/, ''), { incerto: true });
    }
  }
  const limpos = grupos.filter(g => g.criterios.length);
  let n = 0;
  limpos.forEach(g => g.criterios.forEach(c => { c.id = `CA${++n}`; }));
  return {
    encontrado,
    titulo,
    formato: gherkin ? 'gherkin' : (limpos.some(g => g.criterios.some(c => c.incerto)) ? 'texto' : 'lista'),
    agrupado: limpos.some(g => g.nome),
    grupos: limpos,
    total: n,
    incerto: !encontrado || limpos.some(g => g.criterios.some(c => c.incerto)),
    temSubitens: limpos.some(g => g.criterios.some(c => c.subitens.length))
  };
}

// ---------------------------------------------------------------- plano

// Título de cenário. Aceita:
//   "1. Validar ..."  ·  "CT01 - ..."  ·  "Cenário: ..."  ·  "Esquema do Cenário: ..."
//   "Scenario: ..."  ·  "Scenario Outline: ..."  ·  um título (heading) sem palavra de passo
// Devolve também o "molde" do título, para regravar no mesmo formato.
const PALAVRA_CENARIO = /^(esquema do cen[aá]rio|delinea[cç][aã]o do cen[aá]rio|cen[aá]rio de exemplo|cen[aá]rio|scenario outline|scenario template|scenario|example)\s*(\d*)\s*:\s*(.+)$/i;
const SECAO_GHERKIN = /^(funcionalidade|caracter[ií]stica|feature|contexto|background|regra|rule)\s*:/i;
const SO_TAGS = /^(@[\w.-]+\s*)+$/;
const numeroDaTag = t => { const m = t.match(/@(?:CT|C|TC|T)?0*(\d+)\b/i); return m ? Number(m[1]) : null; };

function tituloDeCenario(b) {
  if (b.tipo !== 'titulo' && b.tipo !== 'paragrafo') return null;
  let t = b.texto.trim();
  // tags na mesma linha do título ("@C08 Esquema do Cenário: ...")
  const tags = (t.match(/^(@[\w.-]+\s+)+/) || [''])[0];
  t = t.slice(tags.length).trim();
  const numTag = tags ? numeroDaTag(tags) : null;
  const molde = { bloco: b.tipo, nivel: b.nivel || null };
  let m = t.match(/^CT\s*0*(\d+)\s*([-–—:.)])\s*(.+)$/i);
  if (m) return { numero: Number(m[1]), titulo: m[3].trim(), molde: { ...molde, estilo: 'ct', sep: m[2] } };
  m = t.match(/^(\d+)\s*([.)-])\s+(.+)$/);
  if (m && !PASSO.test(sem(m[3]))) return { numero: Number(m[1]), titulo: m[3].trim(), molde: { ...molde, estilo: 'numero', sep: m[2] } };
  m = t.match(PALAVRA_CENARIO);
  if (m) return { numero: m[2] ? Number(m[2]) : numTag, titulo: m[3].trim(), molde: { ...molde, estilo: 'gherkin', palavra: m[1] } };
  if (b.tipo === 'titulo' && !PASSO.test(sem(t)) && !SECAO_GHERKIN.test(t) && !/^(exemplos|examples)\s*:?$/i.test(t)) return { numero: numTag, titulo: t, molde: { ...molde, estilo: 'titulo' } };
  return null;
}

function lerPlano(blocos) {
  blocos = blocos || [];
  const cenarios = [];
  let atual = null;
  let tagPendente = null;   // "@C08" na linha de cima numera o próximo cenário
  const fechar = () => { if (atual && atual.linhas.some(l => PASSO.test(sem(l)))) cenarios.push(atual); atual = null; };
  for (const b of blocos) {
    const texto = (b.texto || '').trim();
    if ((b.tipo === 'paragrafo' || b.tipo === 'titulo') && SO_TAGS.test(texto)) {
      tagPendente = { numero: numeroDaTag(texto), texto, topo: b.topo };
      continue; // a tag não faz parte do cenário anterior
    }
    // "Funcionalidade:", "Contexto:", "Regra:": encerra o cenário anterior e não abre outro
    if ((b.tipo === 'paragrafo' || b.tipo === 'titulo') && SECAO_GHERKIN.test(texto)) { fechar(); tagPendente = null; continue; }
    const t = tituloDeCenario(b);
    if (t) {
      fechar();
      const numero = t.numero != null ? t.numero : (tagPendente && tagPendente.numero);
      atual = { ...t, numero: numero != null ? numero : null, tag: tagPendente ? tagPendente.texto : null, linhas: [], topoIni: b.topo, topoFim: b.topo };
      tagPendente = null;
      continue;
    }
    tagPendente = null;
    if (!atual) continue;
    if (b.tipo === 'linha') { atual.topoFim = b.topo; fechar(); continue; }
    if (texto) atual.linhas.push(texto);
    if (b.topo != null) atual.topoFim = b.topo;
  }
  fechar();
  let seq = 0;
  const usados = new Set();
  return cenarios.map(c => {
    let numero = c.numero != null && !usados.has(c.numero) ? c.numero : seq + 1;
    while (usados.has(numero)) numero++;
    usados.add(numero);
    seq = Math.max(seq, numero);
    return {
      numero,
      ct: 'CT' + String(numero).padStart(2, '0'),
      titulo: c.titulo,
      bdd: c.linhas.join('\n'),
      tag: c.tag,
      molde: c.molde,
      topoIni: c.topoIni, topoFim: c.topoFim
    };
  });
}

// Troca, no ADF da sub-task, o trecho de um cenário (do título até antes da régua/próximo título).
// Mantém o formato do título que já estava lá (número, "CT01 -", "Esquema do Cenário:"...).
function substituirCenario(adf, cenario, novo) {
  if (!adf || adf.type !== 'doc' || cenario.topoIni == null) throw new Error('Não sei onde está esse cenário na sub-task.');
  const conteudo = adf.content.slice();
  let fim = cenario.topoFim;
  if (conteudo[fim] && conteudo[fim].type === 'rule') fim--; // a régua fica
  const nos = noDeCenario(cenario.numero, novo.titulo, novo.bdd, cenario.molde);
  conteudo.splice(cenario.topoIni, fim - cenario.topoIni + 1, ...nos);
  return { ...adf, content: conteudo };
}

// Acrescenta um cenário novo no fim da sub-task, no mesmo formato dos que já existem
// (com régua antes, se eles são separados por régua, e com a tag "@C09" se eles usam tags).
function acrescentarCenario(adf, numero, titulo, bdd) {
  const base = adf && adf.type === 'doc' ? adf : { type: 'doc', version: 1, content: [] };
  let molde, tag = null, usaRegua = !base.content.length ? false : true;
  try {
    const { paraBlocos } = require('./adf');
    const existentes = lerPlano(paraBlocos(base));
    const ult = existentes[existentes.length - 1];
    if (ult) {
      molde = ult.molde;
      usaRegua = base.content.some(n => n.type === 'rule');
      if (ult.tag) tag = ult.tag.replace(/(@(?:CT|C|TC|T)?)0*\d+/i, (x, pre) => pre + String(numero).padStart((ult.tag.match(/\d+/) || ['00'])[0].length, '0'));
    }
  } catch { /* sem cenários: usa o formato padrão */ }
  const antes = base.content.length && usaRegua ? [{ type: 'rule' }] : [];
  const nosTag = tag ? [{ type: 'paragraph', content: [{ type: 'text', text: tag }] }] : [];
  return { ...base, content: [...base.content, ...antes, ...nosTag, ...noDeCenario(numero, titulo, bdd, molde)] };
}

function noDeCenario(numero, titulo, bdd, molde) {
  const m = molde || { bloco: 'titulo', nivel: 2, estilo: 'numero', sep: '.' };
  const textoTitulo = m.estilo === 'ct' ? `CT${String(numero).padStart(2, '0')} ${m.sep === '-' ? '-' : m.sep} ${titulo}`.replace(/ ([:.)]) /, '$1 ')
    : m.estilo === 'gherkin' ? `${m.palavra}: ${titulo}`
    : m.estilo === 'titulo' ? titulo
    : `${numero}${m.sep || '.'} ${titulo}`;
  const cabecalho = m.bloco === 'titulo'
    ? { type: 'heading', attrs: { level: m.nivel || 2 }, content: [{ type: 'text', text: textoTitulo }] }
    : { type: 'paragraph', content: [{ type: 'text', text: textoTitulo }] };
  const negrito = m.bloco === 'titulo'; // no formato com título, as palavras-chave vão em negrito
  const linhas = String(bdd || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return [
    cabecalho,
    ...linhas.map(l => {
      const k = negrito && l.match(/^(Dado que|Dado|Dada|Dados|Dadas|Quando|Então|Entao|E|Mas|Given|When|Then|And|But)(\s+)(.*)$/);
      return { type: 'paragraph', content: k
        ? [{ type: 'text', text: k[1], marks: [{ type: 'strong' }] }, { type: 'text', text: k[2] + k[3] }]
        : [{ type: 'text', text: l }] };
    })
  ];
}

// ---------------------------------------------------------------- regras nos comentários

const PALAVRA_DE_REGRA = /\b(deve|devem|devera|deverao|regra|criterio|nao pode|precisa|obrigatori)/;

function lerRegrasComentarios(comentarios) {
  const regras = [];
  for (const c of comentarios || []) {
    const bl = c.blocos || [];
    const titulos = bl.map((b, i) => ({ b, i })).filter(x => x.b.tipo === 'titulo');
    if (titulos.length) {
      titulos.forEach(({ b, i }, k) => {
        const ate = k + 1 < titulos.length ? titulos[k + 1].i : bl.length;
        const corpo = bl.slice(i + 1, ate);
        if (!corpo.length) return;
        // título "pai": tem subtítulos abaixo dele (as regras são os subtítulos)
        const seguintes = titulos.slice(k + 1);
        const fimDoPai = seguintes.findIndex(x => x.b.nivel <= b.nivel);
        if ((fimDoPai < 0 ? seguintes : seguintes.slice(0, fimDoPai)).some(x => x.b.nivel > b.nivel)) return;
        const temItens = corpo.some(x => x.tipo === 'item');
        const temExemplo = corpo.some(x => /^exemplo/i.test(sem(x.texto)));
        if (temItens || temExemplo || corpo.some(x => PALAVRA_DE_REGRA.test(sem(x.texto)) && x.texto.length > 60)) {
          regras.push({ titulo: b.texto, texto: corpo.map(x => x.texto).filter(Boolean).join('\n'), autor: c.autor, data: c.data, comentarioId: c.id });
        }
      });
      continue;
    }
    const itens = bl.filter(x => x.tipo === 'item');
    if (itens.length >= 2 && bl.some(x => PALAVRA_DE_REGRA.test(sem(x.texto)))) {
      const primeiro = (bl.find(x => x.tipo === 'paragrafo') || itens[0]).texto;
      regras.push({ titulo: primeiro.length > 70 ? primeiro.slice(0, 67).trimEnd() + '…' : primeiro, texto: bl.map(x => x.texto).filter(Boolean).join('\n'), autor: c.autor, data: c.data, comentarioId: c.id });
    }
  }
  return regras;
}

// ---------------------------------------------------------------- sub-task do plano

// Escolhe a sub-task do plano entre as [QA]: a que tem cenários; se mais de uma (ou nenhuma), quem decide é a pessoa.
// candidatas: [{ chave, titulo, blocos }]
function escolherSubtarefaPlano(candidatas, prefixo = '[QA]') {
  const qa = (candidatas || []).filter(s => s.titulo.trim().toUpperCase().startsWith(prefixo.toUpperCase()));
  const comCenarios = qa.filter(s => lerPlano(s.blocos).length);
  if (comCenarios.length === 1) return { escolhida: comCenarios[0].chave, opcoes: qa.map(s => s.chave) };
  return { escolhida: null, opcoes: (comCenarios.length ? comCenarios : qa).map(s => s.chave), motivo: comCenarios.length ? 'varias' : (qa.length ? 'sem-cenarios' : 'sem-subtarefa') };
}

module.exports = { lerCriterios, lerPlano, substituirCenario, acrescentarCenario, lerRegrasComentarios, escolherSubtarefaPlano };
