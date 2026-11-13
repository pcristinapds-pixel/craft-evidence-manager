// Regras de cobertura dos critérios de aceite (funções puras, sem disco).

const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Critérios como a pessoa confirmou na conferência:
//   ajustes.subitens   { CA8: 'separar' | 'manter' }   (padrão: manter)
//   ajustes.ignorados  ['CA5']
//   ajustes.naoSeAplica { CA13: 'validação documental' }
// Devolve lista plana: { id, texto, grupo, subitens, naoSeAplica? }
function criteriosEfetivos(leitura, ajustes = {}) {
  const out = [];
  const ign = new Set(ajustes.ignorados || []);
  const nsa = ajustes.naoSeAplica || {};
  for (const g of (leitura && leitura.grupos) || []) {
    for (const c of g.criterios) {
      if (ign.has(c.id)) continue;
      const separar = (ajustes.subitens || {})[c.id] === 'separar';
      out.push({ id: c.id, texto: c.texto, grupo: g.nome || null, subitens: separar ? [] : c.subitens.map(s => s.texto), ...(c.bdd ? { bdd: c.bdd } : {}), ...(nsa[c.id] != null ? { naoSeAplica: nsa[c.id] || 'não se aplica' } : {}) });
      if (separar) c.subitens.forEach((s, i) => {
        const id = `${c.id}.${i + 1}`;
        if (!ign.has(id)) out.push({ id, texto: s.texto, grupo: g.nome || null, subitens: [], ...(nsa[id] != null ? { naoSeAplica: nsa[id] || 'não se aplica' } : {}) });
      });
    }
  }
  return out;
}

// ---- sugestão de quais critérios um cenário cobre (por palavras em comum, sem IA)
const VAZIAS = new Set(('a o os as de da do das dos e em no na nos nas um uma para por com que se ao aos deve devem devera deverao ser sera '
  + 'como mais quando entao dado given when then and but the is are be should must o usuario sistema caso nao sim mesmo').split(' '));
const raiz = p => p.replace(/(coes|cao|oes|ais|eis|es|s)$/, ''); // "versões" ~ "versão", "idiomas" ~ "idioma"
function palavras(txt) {
  return new Set(sem(txt).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(p => p.length >= 4 && !VAZIAS.has(p)).map(raiz));
}

function sugerirCriterios(cenario, criterios, { limite = 0.3 } = {}) {
  const pc = palavras(`${cenario.titulo || ''} ${cenario.bdd || ''}`);
  const lista = criterios.filter(c => !c.naoSeAplica).map(c => ({ id: c.id, pk: palavras(c.texto + ' ' + (c.subitens || []).join(' ') + ' ' + (c.bdd || '')) }));
  if (!pc.size || !lista.length) return [];
  // palavras que aparecem em muitos critérios ("e-mail", "idioma") pesam pouco;
  // as que distinguem um critério ("espanhol", "assunto") pesam muito
  const df = new Map();
  lista.forEach(c => c.pk.forEach(p => df.set(p, (df.get(p) || 0) + 1)));
  const peso = p => Math.log((lista.length + 1) / ((df.get(p) || 0) + 0.5));
  const distintiva = Math.log((lista.length + 1) / 2.5); // palavra presente em até 2 critérios
  const notas = lista.map(c => {
    let total = 0, comum = 0, temDistintiva = false;
    c.pk.forEach(p => { const w = peso(p); total += w; if (pc.has(p)) { comum += w; if (w >= distintiva) temDistintiva = true; } });
    return { id: c.id, nota: total ? comum / total : 0, temDistintiva };
  }).filter(n => n.temDistintiva);
  // na dúvida, melhor deixar de sugerir do que inflar a cobertura: além do mínimo,
  // o critério precisa chegar perto do mais parecido com o cenário
  const melhor = Math.max(0, ...notas.map(n => n.nota));
  const corte = Math.max(limite, 0.4 * melhor);
  return notas.filter(n => n.nota >= corte).sort((a, b) => b.nota - a.nota).map(n => n.id);
}

// ---- positivo ou negativo, sugerido pelo BDD (a pessoa confirma)
const NEGATIVO = /\b(nao|nenhum|nenhuma|sem|erro|invalid[oa]s?|bloquead[oa]s?|recusad[oa]s?|negad[oa]s?|falha|impedi[rd]|inexistente|vencid[oa]|expirad[oa]|inelegivel|not|without|error|invalid|denied|blocked|fail)\b/;
function sugerirNatureza(bdd) {
  return NEGATIVO.test(sem(bdd)) ? 'negativo' : 'positivo';
}

// ---- resumo da cobertura para a tela e o relatório
// criterios: criteriosEfetivos(); cobertura: { CT01: ['CA3'] }; status: { CT01: 'Passou' }
function resumoCobertura(criterios, cobertura = {}, status = {}) {
  const porCriterio = criterios.map(c => {
    const cts = Object.keys(cobertura).filter(ct => (cobertura[ct] || []).includes(c.id)).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    return { ...c, cts: cts.map(ct => ({ ct, status: status[ct] || 'Não executado' })) };
  });
  const aplicaveis = porCriterio.filter(c => !c.naoSeAplica);
  return {
    criterios: porCriterio,
    total: criterios.length,
    cobertos: aplicaveis.filter(c => c.cts.length).length,
    semCenario: aplicaveis.filter(c => !c.cts.length).length,
    naoSeAplica: porCriterio.length - aplicaveis.length
  };
}

module.exports = { criteriosEfetivos, sugerirCriterios, sugerirNatureza, resumoCobertura };
