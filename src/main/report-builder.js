// Gera os documentos one-page de uma história:
//  - "<ID> - Relatório de evidências.html": só a execução atual de cada cenário,
//    com prints e vídeos (versão leve) embutidos — funciona sozinho, sem a pasta.
//  - "<ID> - Histórico de execuções.html": todas as execuções de cada cenário
//    (só é gerado quando algum cenário foi reexecutado). Vídeos como download.
const fs = require('fs');
const path = require('path');
const store = require('./evidence-store');
const { montarVisao } = require('./visao');

const TEMPLATE = path.join(__dirname, 'report-template.html');
const MB = 1024 * 1024;
const LIMITE_VIDEO = 50 * MB;    // vídeo leve acima disso não é embutido
const LIMITE_RELATORIO = 100 * MB; // relatório acima disso: todos os vídeos viram download

function nomeRelatorio(storyId) { return `${store.seguro(storyId)} - Relatório de evidências.html`; }
function nomeHistorico(storyId) { return `${store.seguro(storyId)} - Histórico de execuções.html`; }

function linkHistoria(base, id) {
  if (!id) return '';
  if (/^https?:\/\//i.test(id)) return id;
  return base ? base.replace(/\/?$/, '/') + encodeURIComponent(id) : '';
}

function caminhoRelativo(pastaCt, arquivo) {
  return [pastaCt, ...arquivo.split('/')].map(encodeURIComponent).join('/');
}

function arquivoParaDataUrl(arq, mime) {
  return `data:${mime};base64,` + fs.readFileSync(arq).toString('base64');
}

const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
const nomeArq = s => String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);

function gravar(destino, html) {
  fs.writeFileSync(destino + '.tmp', html, 'utf8');
  fs.renameSync(destino + '.tmp', destino);
  return destino;
}

/**
 * @param base           pasta de evidências (configuração do app)
 * @param storyId        ex.: QMS-1036
 * @param opts.jiraBaseUrl
 * @param opts.logoPath
 * @param opts.imagemParaDataUrl  (opcional) converte o print para JPEG menor; padrão: PNG original
 * @returns caminho do relatório (e opts.out.historico, se gerado)
 */
function contexto(base, storyId, opts = {}) {
  const dirHist = store.pastaHistoria(base, storyId);
  const hist = store.lerJson(path.join(dirHist, 'historia.json'), { id: storyId });
  const cenarios = store.listarCenarios(base, storyId);
  const conv = opts.imagemParaDataUrl || (arq => arquivoParaDataUrl(arq, 'image/png'));
  const cachePrint = {};
  const print = abs => (cachePrint[abs] ??= fs.existsSync(abs) ? conv(abs) : '');

  const evidencias = (c, ex, embutirVideos) => {
    let nv = 0;
    return (ex.evidencias || []).map(e => {
      const abs = path.join(dirHist, c.pasta, ...e.arquivo.split('/'));
      if (e.tipo === 'print') return { tipo: 'print', passo: e.passo, legenda: e.legenda, src: print(abs) };
      nv++;
      const arquivo = caminhoRelativo(c.pasta, e.arquivo);
      const leve = store.versaoRelatorio(abs);
      const embutido = embutirVideos && fs.existsSync(leve) && fs.statSync(leve).size <= LIMITE_VIDEO;
      const nomeDownload = nomeArq(`${c.ct} - ${e.legenda || 'video-' + nv}`) + '.mp4';
      return { tipo: 'video', legenda: e.legenda || '', duracao: fmtDur(e.duracao), arquivo, nomeDownload, embutido, src: embutido ? arquivoParaDataUrl(leve, 'video/mp4') : arquivo };
    });
  };

  const api = (c, a) => {
    if (!a) return null;
    const out = { curl: a.curl || '', collection: null };
    if (a.collection) {
      const abs = path.join(dirHist, c.pasta, ...a.collection.split('/'));
      out.collection = fs.existsSync(abs) ? { nome: path.basename(abs), url: arquivoParaDataUrl(abs, 'application/json') } : null;
    }
    return out;
  };

  const item = (c, ex, embutir, ct = c.ct) => ({
    ct, titulo: ex.titulo, tipo: ex.tipo, status: ex.status, responsavel: ex.responsavel, execucao: ex.execucao,
    data: ex.data, ambiente: ex.ambiente, versao: ex.versao, bdd: ex.bdd, observacao: ex.observacao,
    api: api(c, ex.api), evidencias: evidencias(c, ex, embutir)
  });

  const unicos = arr => [...new Set(arr.filter(Boolean))];
  const fmt = d => d.toLocaleDateString('pt-BR');
  const periodoDe = execs => {
    const ds = execs.map(x => new Date(x.dataISO)).filter(d => !isNaN(d)).sort((a, b) => a - b);
    if (!ds.length) return '';
    return fmt(ds[0]) === fmt(ds[ds.length - 1]) ? fmt(ds[0]) : `${fmt(ds[0])} a ${fmt(ds[ds.length - 1])}`;
  };
  const agora = new Date();
  const cabecalho = execs => ({
    historia: { id: hist.id || storyId, titulo: hist.titulo || '', link: linkHistoria(opts.jiraBaseUrl, hist.id || storyId) },
    responsaveis: unicos(execs.map(x => x.responsavel)),
    periodo: periodoDe(execs),
    ambiente: unicos(execs.map(x => x.ambiente)).join(', '),
    versao: unicos(execs.map(x => x.versao)).join(', ') || '—',
    atualizadoEm: `${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  });

  const logo = opts.logoPath && fs.existsSync(opts.logoPath) ? arquivoParaDataUrl(opts.logoPath, 'image/png') : '';
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const montar = dados => template
    .replace('__LOGO__', logo)
    .replace('__DADOS__', () => JSON.stringify(dados).replace(/</g, '\\u003c'));

  // estimativa do tamanho com vídeos embutidos (sem montar o HTML, que pode ficar
  // grande demais para caber em memória): versão leve dos vídeos + prints, em base64
  const estimativa = pares => pares.reduce((t, [c, ex]) => t + (ex.evidencias || []).reduce((s, e) => {
    const abs = path.join(dirHist, c.pasta, ...e.arquivo.split('/'));
    const arq = e.tipo === 'video' ? store.versaoRelatorio(abs) : abs;
    try { const n = fs.statSync(arq).size; return s + (e.tipo === 'video' && n > LIMITE_VIDEO ? 0 : n); } catch { return s; }
  }, 0), 0) * 4 / 3;
  // monta com vídeos embutidos; se passar do limite, monta de novo com vídeos como download
  const montarComLimite = dados => {
    if (estimativa(dados.pares) <= LIMITE_RELATORIO) {
      const html = montar(dados.gerar(true));
      if (Buffer.byteLength(html) <= LIMITE_RELATORIO) return html;
    }
    return montar(dados.gerar(false));
  };

  return { dirHist, cenarios, item, cabecalho, montar, montarComLimite };
}

const NAO_PASSOU = ['Falhou', 'Bloqueado'];
const ehBug = status => NAO_PASSOU.includes(status);

function nomeBug(storyId, ct, execucao) {
  return `${store.seguro(storyId)} - ${store.seguro(ct)} - Bug (${execucao}ª execução).html`;
}

/**
 * Relatório sozinho de um cenário que não passou, pronto para anexar no bug.
 * Fica em <história>/Bugs/. Retorna o caminho, ou null se o cenário passou.
 */
function gerarRelatorioBug(base, storyId, ct, opts = {}) {
  const { dirHist, cenarios, item, cabecalho, montarComLimite } = contexto(base, storyId, opts);
  const c = cenarios.find(x => x.ct === ct || x.pasta === store.seguro(ct));
  if (!c) return null;
  const ex = c.execucoes[c.execucoes.length - 1];
  if (!ehBug(ex.status)) return null;
  const dir = path.join(dirHist, 'Bugs');
  fs.mkdirSync(dir, { recursive: true });
  // vídeos: embutidos (o arquivo vai sozinho para o Jira); se ficar grande demais, viram download
  const it = embutir => {
    const i = item(c, ex, embutir);
    // no arquivo do bug os vídeos não embutidos apontam para a pasta do cenário (um nível acima)
    i.evidencias.forEach(e => { if (e.tipo === 'video' && !e.embutido) { e.arquivo = '../' + e.arquivo; e.src = e.arquivo; } });
    return i;
  };
  const dados = embutir => ({ ...cabecalho([ex]), documento: 'Relatório para abertura de bug', simples: true, cenarios: [it(embutir)] });
  const html = montarComLimite({ pares: [[c, ex]], gerar: dados });
  return gravar(path.join(dir, nomeBug(storyId, c.ct, ex.execucao)), html);
}

function gerarRelatorio(base, storyId, opts = {}) {
  const { dirHist, cenarios, item, cabecalho, montar, montarComLimite } = contexto(base, storyId, opts);

  // ---- histórico (só se houver reexecução) ----
  const temHistorico = cenarios.some(c => c.execucoes.length > 1);
  const arqHistorico = path.join(dirHist, nomeHistorico(storyId));
  if (temHistorico) {
    const todas = cenarios.flatMap(c => c.execucoes);
    gravar(arqHistorico, montar({
      ...cabecalho(todas),
      documento: 'Histórico de execuções', rotuloItens: 'execuções',
      cenarios: cenarios.flatMap(c => [...c.execucoes].reverse().map(ex => ({ ...item(c, ex, false), id: `${c.ct}-exec-${ex.execucao}`, titulo: `${ex.titulo} · ${ex.execucao}ª execução`, execucao: 0 })))
    }));
  } else if (fs.existsSync(arqHistorico)) fs.rmSync(arqHistorico);

  // ---- relatório (execução atual) ----
  // plano, critérios e cobertura (quando a história veio do Jira)
  const visao = montarVisao(base, storyId);
  const porCt = Object.fromEntries(visao.cenarios.map(c => [c.ct, c]));
  const subPlano = visao.plano && visao.plano.subtarefa;
  const rotuloOrigem = v => {
    if (!v) return '';
    if (v.origem === 'plano') return subPlano ? `plano ${subPlano}, cenário ${Number(String(v.ct).replace(/\D/g, ''))}` : 'plano';
    if (v.origem === 'criterio') return `criado no app para o ${v.origemDetalhe}` + (subPlano && !v.editado ? ` · gravado na ${subPlano}` : '');
    if (v.origem === 'comentario') return `criado a partir do ${v.origemDetalhe}`;
    return v.noPlano ? 'criado no app' : '';
  };
  const extras = (ct, ex, execucoes) => {
    const v = porCt[ct];
    const out = { natureza: (ex && ex.natureza) || (v && v.natureza) || null, cobre: v ? v.cobre : ((ex && ex.criterios) || []), origem: rotuloOrigem(v) };
    // falhas antes do sucesso (Bloqueado não conta)
    if (ex && ex.status === 'Passou') {
      out.falhasAntes = execucoes.slice(0, -1).filter(x => x.status === 'Falhou').map(x => ({ execucao: x.execucao, data: x.data, subFalha: x.subFalha || null }));
    }
    if (ex && ex.subFalha) out.subFalha = ex.subFalha;
    return out;
  };
  const atuais = cenarios.map(c => c.execucoes[c.execucoes.length - 1]);
  const dadosRel = embutir => ({
    ...cabecalho(atuais),
    linkHistorico: temHistorico ? encodeURIComponent(nomeHistorico(storyId)) : '',
    plano: subPlano ? { subtarefa: subPlano, lidoEm: visao.plano.lidoEm } : null,
    projeto: visao.jira && visao.jira.projeto ? visao.jira.projeto.nome : '',
    cobertura: visao.criterios ? {
      cobertos: visao.cobertura.cobertos, total: visao.cobertura.total, semCenario: visao.cobertura.semCenario, naoSeAplica: visao.cobertura.naoSeAplica,
      criterios: visao.cobertura.criterios.map(c => ({ id: c.id, texto: c.texto, grupo: c.grupo, naoSeAplica: c.naoSeAplica || null, cts: c.cts }))
    } : null,
    cenarios: [
      ...cenarios.map(c => {
        const ex = c.execucoes[c.execucoes.length - 1];
        const i = { ...item(c, ex, embutir), ...extras(c.ct, ex, c.execucoes) };
        const bug = path.join(dirHist, 'Bugs', nomeBug(storyId, c.ct, ex.execucao));
        if (ehBug(ex.status) && fs.existsSync(bug)) i.linkBug = 'Bugs/' + encodeURIComponent(path.basename(bug));
        return i;
      }),
      // CTs do plano ainda sem evidência: aparecem como "Não executado"
      ...visao.cenarios.filter(v => v.noPlano && !v.execucoes).map(v => ({
        ct: v.ct, titulo: v.titulo, bdd: v.bdd, tipo: null, status: 'Não executado', naoExecutado: true, evidencias: [], ...extras(v.ct, null, [])
      }))
    ].sort((a, b) => a.ct.localeCompare(b.ct, 'pt-BR', { numeric: true }))
  });
  const html = montarComLimite({ pares: cenarios.map(c => [c, c.execucoes[c.execucoes.length - 1]]), gerar: dadosRel });
  const destino = gravar(path.join(dirHist, nomeRelatorio(storyId)), html);
  if (opts.out) opts.out.historico = temHistorico ? arqHistorico : null;
  return destino;
}

module.exports = { gerarRelatorio, gerarRelatorioBug, ehBug, nomeRelatorio, nomeHistorico, nomeBug, LIMITE_VIDEO, LIMITE_RELATORIO };
