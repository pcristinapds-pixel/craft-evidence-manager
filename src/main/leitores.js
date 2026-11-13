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
      if (b.tipo === 'linha' || b.tipo === 'codigo') continue;
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

// Título de cenário: "1. Validar ...", "CT01 - ...", "Cenário: ..." ou um título (heading)
function tituloDeCenario(b) {
  if (b.tipo !== 'titulo' && b.tipo !== 'paragrafo') return null;
  const t = b.texto.trim();
  let m = t.match(/^CT\s*0*(\d+)\s*[-–—:.)]\s*(.+)$/i);
  if (m) return { numero: Number(m[1]), titulo: m[2].trim() };
  m = t.match(/^(\d+)\s*[.)-]\s+(.+)$/);
  if (m && !PASSO.test(sem(m[2]))) return { numero: Number(m[1]), titulo: m[2].trim() };
  m = t.match(/^(cen[aá]rio|scenario)\s*(\d*)\s*:\s*(.+)$/i);
  if (m) return { numero: m[2] ? Number(m[2]) : null, titulo: m[3].trim() };
  if (b.tipo === 'titulo' && !PASSO.test(sem(t))) return { numero: null, titulo: t };
  return null;
}

function lerPlano(blocos) {
  blocos = blocos || [];
  const cenarios = [];
  let atual = null;
  const fechar = () => { if (atual && atual.linhas.some(l => PASSO.test(sem(l)))) cenarios.push(atual); atual = null; };
  for (const b of blocos) {
    const t = tituloDeCenario(b);
    if (t) { fechar(); atual = { ...t, linhas: [], topoIni: b.topo, topoFim: b.topo }; continue; }
    if (!atual) continue;
    if (b.tipo === 'linha') { atual.topoFim = b.topo; fechar(); continue; }
    if (b.texto) atual.linhas.push(b.texto);
    if (b.topo != null) atual.topoFim = b.topo;
  }
  fechar();
  let seq = 0;
  return cenarios.map(c => {
    const numero = c.numero != null ? c.numero : seq + 1;
    seq = Math.max(seq, numero);
    return {
      numero,
      ct: 'CT' + String(numero).padStart(2, '0'),
      titulo: c.titulo,
      bdd: c.linhas.join('\n'),
      topoIni: c.topoIni, topoFim: c.topoFim
    };
  });
}

// Troca, no ADF da sub-task, o trecho de um cenário (do título até antes da régua/próximo título).
// Mantém o número e o formato: título como heading 2 e palavras-chave em negrito.
function substituirCenario(adf, cenario, novo) {
  if (!adf || adf.type !== 'doc' || cenario.topoIni == null) throw new Error('Não sei onde está esse cenário na sub-task.');
  const conteudo = adf.content.slice();
  let fim = cenario.topoFim;
  if (conteudo[fim] && conteudo[fim].type === 'rule') fim--; // a régua fica
  const nos = noDeCenario(cenario.numero, novo.titulo, novo.bdd);
  conteudo.splice(cenario.topoIni, fim - cenario.topoIni + 1, ...nos);
  return { ...adf, content: conteudo };
}

// Acrescenta um cenário novo no fim da sub-task (com régua antes, se já houver cenários)
function acrescentarCenario(adf, numero, titulo, bdd) {
  const base = adf && adf.type === 'doc' ? adf : { type: 'doc', version: 1, content: [] };
  const antes = base.content.length ? [{ type: 'rule' }] : [];
  return { ...base, content: [...base.content, ...antes, ...noDeCenario(numero, titulo, bdd)] };
}

function noDeCenario(numero, titulo, bdd) {
  const linhas = String(bdd || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `${numero}. ${titulo}` }] },
    ...linhas.map(l => {
      const m = l.match(/^(Dado que|Dado|Dada|Dados|Dadas|Quando|Então|Entao|E|Mas|Given|When|Then|And|But)(\s+)(.*)$/);
      return { type: 'paragraph', content: m
        ? [{ type: 'text', text: m[1], marks: [{ type: 'strong' }] }, { type: 'text', text: m[2] + m[3] }]
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
