// Monta, a partir do que está salvo na pasta da história, tudo o que a tela e o
// relatório mostram: plano com status de cada CT, critérios efetivos, cobertura,
// positivo/negativo e regras dos comentários.
const store = require('./evidence-store');
const C = require('./cobertura');

const NAO_EXECUTADO = 'Não executado';

// Resumo das execuções de cada CT: status atual e falhas antes do sucesso
function resumoExecucoes(base, storyId) {
  const out = {};
  for (const c of store.listarCenarios(base, storyId)) {
    const ex = c.execucoes;
    const ult = ex[ex.length - 1];
    const anteriores = ex.slice(0, -1);
    out[c.ct] = {
      status: ult.status,
      total: ex.length,
      data: ult.data,
      titulo: ult.titulo, bdd: ult.bdd, tipo: ult.tipo,
      natureza: ult.natureza || null,
      // só conta "Falhou" (Bloqueado não é falha do sistema testado)
      falhasAntes: ult.status === 'Passou' ? anteriores.filter(x => x.status === 'Falhou').length : 0,
      subFalha: ult.subFalha || null
    };
  }
  return out;
}

function montarVisao(base, storyId) {
  const h = store.lerHistoria(base, storyId);
  const leitura = h.criterios && h.criterios.leitura;
  const ajustes = (h.criterios && h.criterios.ajustes) || {};
  const efetivos = leitura ? C.criteriosEfetivos(leitura, ajustes) : [];
  const execs = resumoExecucoes(base, storyId);
  const plano = (h.plano && h.plano.cenarios) || [];
  const cts = [...plano.map(c => c.ct), ...Object.keys(execs).filter(ct => !plano.some(c => c.ct === ct))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));

  const cenarios = cts.map(ct => {
    const p = plano.find(c => c.ct === ct) || {};
    const e = execs[ct];
    const titulo = p.titulo || (e && e.titulo) || '';
    const bdd = p.bdd || (e && e.bdd) || '';
    const coberturaDefinida = Object.prototype.hasOwnProperty.call(h.cobertura || {}, ct);
    const cobre = coberturaDefinida ? h.cobertura[ct] : C.sugerirCriterios({ titulo, bdd }, efetivos);
    const naturezaDefinida = (h.natureza || {})[ct] || (e && e.natureza);
    return {
      ct, titulo, bdd,
      noPlano: !!p.ct,
      origem: p.origem || 'app', origemDetalhe: p.origemDetalhe || '',
      status: e ? e.status : NAO_EXECUTADO,
      execucoes: e ? e.total : 0,
      data: e ? e.data : null,
      tipo: e ? e.tipo : null,
      falhasAntes: e ? e.falhasAntes : 0,
      subFalha: e ? e.subFalha : null,
      natureza: naturezaDefinida || C.sugerirNatureza(bdd),
      naturezaSugerida: !naturezaDefinida,
      cobre, coberturaSugerida: !coberturaDefinida,
      editado: !!p.editadoEm && !p.gravadoNoJira,
      conflito: !!p.conflito, mudouNoJira: !!p.mudouNoJira,
      lidoDoJira: p.lidoDoJira || null
    };
  });

  const status = Object.fromEntries(cenarios.map(c => [c.ct, c.status]));
  const cobreMapa = Object.fromEntries(cenarios.map(c => [c.ct, c.cobre]));
  const criterios = leitura ? {
    encontrado: leitura.encontrado, formato: leitura.formato, incerto: leitura.incerto,
    temSubitens: leitura.temSubitens, agrupado: leitura.agrupado, titulo: leitura.titulo,
    grupos: leitura.grupos, total: leitura.total,
    confirmados: !!h.criterios.confirmados, mudou: !!h.criterios.mudou, ajustes
  } : null;

  return {
    id: h.id || storyId,
    titulo: h.titulo || '',
    jira: h.jira || null,
    plano: h.plano ? { subtarefa: h.plano.subtarefa || null, lidoEm: h.plano.lidoEm || null } : null,
    criterios,
    efetivos,
    cobertura: C.resumoCobertura(efetivos, cobreMapa, status),
    cenarios,
    regras: h.regras || [],
    executados: cenarios.filter(c => c.status !== NAO_EXECUTADO).length,
    // a conferência aparece quando a leitura foi incerta, tem subitens a decidir ou o Jira mudou
    precisaConferir: !!criterios && ((!criterios.confirmados && (criterios.incerto || criterios.temSubitens)) || criterios.mudou)
  };
}

module.exports = { montarVisao, resumoExecucoes, NAO_EXECUTADO };
