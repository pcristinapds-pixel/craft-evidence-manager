// Junta o cliente do Jira, os leitores e a pasta de evidências.
// Tudo o que a tela pede ao Jira passa por aqui (os IPCs do main.js só repassam).
const store = require('./evidence-store');
const L = require('./leitores');
const { montarVisao } = require('./visao');
const { JiraErro } = require('./jira');

const ehPrefixo = (titulo, prefixo) => String(titulo || '').trim().toUpperCase().startsWith(String(prefixo || '').toUpperCase());

function criarServico({ cliente, base, prefixo = '[QA]' }) {
  // Lê a história (ou a história mãe, se a chave for de uma sub-task), o plano e os critérios
  async function carregarHistoria(chave) {
    let h = await cliente.historia(chave);
    if (h.subtarefa && h.pai) h = await cliente.historia(h.pai.chave);
    if (h.epico) throw new JiraErro('Isso é um épico. Escolha uma das histórias dele.', 'epico');

    const qa = h.subtarefas.filter(s => ehPrefixo(s.titulo, prefixo));
    const candidatas = await Promise.all(qa.map(async s => {
      const st = await cliente.subtarefa(s.chave);
      return { chave: s.chave, titulo: s.titulo, blocos: st.blocos, atualizadoEm: st.atualizadoEm };
    }));
    const local = store.lerHistoria(base, h.chave);
    let escolha = L.escolherSubtarefaPlano(candidatas, prefixo);
    const escolhidaAntes = local.plano && local.plano.subtarefaEscolhida;
    if (escolhidaAntes && candidatas.some(c => c.chave === escolhidaAntes)) escolha = { ...escolha, escolhida: escolhidaAntes };
    const sub = candidatas.find(c => c.chave === escolha.escolhida);

    store.salvarDadosJira(base, h.chave, {
      titulo: h.titulo,
      jira: { projeto: h.projeto, tipo: h.tipo, status: h.status, campoDescricao: h.campoDescricao, site: cliente.site, atualizadoEm: h.atualizadoEm },
      criterios: L.lerCriterios(h.blocos),
      plano: sub ? { subtarefa: sub.chave, atualizadoEm: sub.atualizadoEm, cenarios: L.lerPlano(sub.blocos) } : null,
      regras: L.lerRegrasComentarios(h.comentarios)
    });
    return {
      ...montarVisao(base, h.chave),
      escolhaPlano: { escolhida: escolha.escolhida, motivo: escolha.motivo || null, opcoes: candidatas.map(c => ({ chave: c.chave, titulo: c.titulo })) }
    };
  }

  // A pessoa escolheu qual sub-task [QA] tem o plano
  async function escolherPlano(storyId, chaveSub) {
    const h = store.lerHistoria(base, storyId);
    h.id = storyId;
    h.plano = { ...(h.plano || { cenarios: [] }), subtarefaEscolhida: chaveSub };
    store.gravarHistoria(base, storyId, h);
    return carregarHistoria(storyId);
  }

  // Grava no Jira a edição de um cenário (só o trecho dele na sub-task).
  // Se o cenário mudou no Jira desde a última leitura, não grava: devolve as duas versões.
  async function gravarCenarioNoJira(storyId, ct, { titulo, bdd }) {
    const h = store.lerHistoria(base, storyId);
    const subChave = h.plano && h.plano.subtarefa;
    if (!subChave) throw new JiraErro('Esta história não tem sub-task de plano para gravar.', 'config');
    const sub = await cliente.subtarefa(subChave);
    const noJira = L.lerPlano(sub.blocos).find(c => c.ct === ct);
    const local = (h.plano.cenarios || []).find(c => c.ct === ct);
    if (noJira) {
      const lido = local && local.lidoDoJira;
      if (lido && (lido.titulo !== noJira.titulo || lido.bdd !== noJira.bdd)) {
        return { conflito: true, noJira: { titulo: noJira.titulo, bdd: noJira.bdd } };
      }
      await cliente.atualizarDescricao(subChave, L.substituirCenario(sub.descricao, noJira, { titulo, bdd }));
    } else {
      const numero = Number(String(ct).replace(/\D/g, '')) || 1;
      await cliente.atualizarDescricao(subChave, L.acrescentarCenario(sub.descricao, numero, titulo, bdd));
    }
    store.atualizarCenario(base, storyId, ct, { titulo, bdd, gravadoNoJira: true });
    return { gravado: true, subtarefa: subChave };
  }

  return { carregarHistoria, escolherPlano, gravarCenarioNoJira };
}

module.exports = { criarServico };
