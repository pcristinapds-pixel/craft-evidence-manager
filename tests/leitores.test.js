const test = require('node:test');
const assert = require('node:assert/strict');
const { paraBlocos, paraTexto } = require('../src/main/adf');
const L = require('../src/main/leitores');
const F = require('./fixtures/adf');

const todos = r => r.grupos.flatMap(g => g.criterios);

// ---------------- critérios

test('POR-6925: 13 critérios em 4 grupos, do "4." até o "5."', () => {
  const r = L.lerCriterios(paraBlocos(F.POR_6925));
  assert.equal(r.encontrado, true);
  assert.equal(r.formato, 'lista');
  assert.deepEqual(r.grupos.map(g => [g.nome, g.criterios.length]), [
    ['Cadastro do idioma', 2], ['Envio do e-mail', 7], ['Regra de disparo', 2], ['Ausência de idioma', 2]]);
  assert.equal(r.total, 13);
  assert.equal(todos(r)[0].id, 'CA1');
  assert.equal(todos(r)[12].id, 'CA13');
  assert.match(todos(r)[12].texto, /fallback/);
  assert.equal(r.incerto, false);
});

test('QMS-823: 11 critérios sem grupos, subitem fica dentro do CA8 e a lista DoD fica de fora', () => {
  const r = L.lerCriterios(paraBlocos(F.QMS_823));
  assert.equal(r.total, 11);
  assert.equal(r.agrupado, false);
  const c8 = todos(r)[7];
  assert.equal(c8.id, 'CA8');
  assert.equal(c8.subitens.length, 1);
  assert.match(c8.subitens[0].texto, /inelegível/);
  assert.equal(r.temSubitens, true);
  assert.match(todos(r)[10].texto, /QMS-795/);
  assert.ok(!todos(r).some(c => /DoD|regressão/.test(c.texto)));
});

test('épico: "Critérios de sucesso" sem número, até o fim do campo', () => {
  const r = L.lerCriterios(paraBlocos(F.CNN_1935));
  assert.equal(r.total, 3);
  assert.match(todos(r)[0].texto, /estabilidade/);
  assert.ok(!todos(r).some(c => /ambiente para testes/.test(c.texto)));
});

test('critérios em Gherkin: cada cenário vira um critério, com o BDD', () => {
  const doc = F.doc(F.p('Critérios de aceite:'),
    F.p('Cenário: Envio em inglês'), F.p('Dado um usuário em inglês'), F.p('Quando o e-mail sair'), F.p('Então chega em inglês'),
    F.p('Scenario: Fallback'), F.p('Given no language'), F.p('When sent'), F.p('Then default language'));
  const r = L.lerCriterios(paraBlocos(doc));
  assert.equal(r.formato, 'gherkin');
  assert.deepEqual(todos(r).map(c => c.texto), ['Envio em inglês', 'Fallback']);
  assert.equal(todos(r)[1].bdd, 'Given no language\nWhen sent\nThen default language');
});

test('Gherkin sem título de cenário: cada "Dado/Given" abre um critério', () => {
  const doc = F.doc(F.p('Acceptance criteria'), F.p('Given a'), F.p('When b'), F.p('Then c'), F.p('Given d'), F.p('When e'), F.p('Then f'));
  const r = L.lerCriterios(paraBlocos(doc));
  assert.equal(r.total, 2);
  assert.equal(todos(r)[1].bdd, 'Given d\nWhen e\nThen f');
});

test('texto corrido: cada parágrafo vira um critério marcado como incerto', () => {
  const doc = F.doc(F.p('Critérios de aceitação:'), F.p('1. O sistema deve aceitar CPF válido.'), F.p('2. O sistema deve recusar CPF inválido.'));
  const r = L.lerCriterios(paraBlocos(doc));
  assert.equal(r.formato, 'texto');
  assert.equal(r.incerto, true);
  assert.deepEqual(todos(r).map(c => c.texto), ['O sistema deve aceitar CPF válido.', 'O sistema deve recusar CPF inválido.']);
});

test('sem seção de critérios: lê a descrição inteira e marca como incerto', () => {
  const r = L.lerCriterios(paraBlocos(F.doc(F.p('Objetivo geral do projeto.'), F.ul('item a', 'item b'))));
  assert.equal(r.encontrado, false);
  assert.equal(r.incerto, true);
  assert.equal(r.total, 3);
});

test('seção seguinte com número pulado também encerra os critérios', () => {
  const doc = F.doc(F.p('4. Critérios de aceite:'), F.ul('a', 'b'), F.p('6. Anexos:'), F.ul('não é critério'));
  assert.equal(L.lerCriterios(paraBlocos(doc)).total, 2);
});

test('descrição vazia não quebra', () => {
  assert.equal(L.lerCriterios([]).total, 0);
  assert.equal(L.lerCriterios(null).total, 0);
});

// ---------------- plano

test('POR-7132: 4 cenários com título, número e BDD em inglês', () => {
  const p = L.lerPlano(paraBlocos(F.POR_7132));
  assert.deepEqual(p.map(c => c.ct), ['CT01', 'CT02', 'CT03', 'CT04']);
  assert.equal(p[2].titulo, 'Validar recebimento do e-mail de boas-vindas em Inglês');
  assert.match(p[0].bdd, /^Given um novo acesso/);
  assert.match(p[0].bdd, /Exemplos de idioma: Português, Espanhol e Inglês\.$/);
  assert.equal(p[3].bdd.split('\n').length, 5);
});

test('aceita "CT01 - título" e "Cenário: título" em parágrafos', () => {
  const doc = F.doc(F.p('CT01 - Login válido'), F.p('Dado x'), F.p('Quando y'), F.p('Então z'),
    F.p('Cenário: Login inválido'), F.p('Dado a'), F.p('Quando b'), F.p('Então c'));
  const p = L.lerPlano(paraBlocos(doc));
  assert.deepEqual(p.map(c => [c.ct, c.titulo]), [['CT01', 'Login válido'], ['CT02', 'Login inválido']]);
});

test('QMS-1058: "Esquema do Cenário:" com tag @C07 em cima vira CT07, sem misturar cenários', () => {
  const p = L.lerPlano(paraBlocos(F.QMS_1058));
  assert.deepEqual(p.map(c => c.ct), ['CT07', 'CT08', 'CT09']);
  assert.equal(p[0].titulo, 'Validação de Coleta no Brasil para Exportação (Cidade + Estado)');
  assert.equal(p[0].bdd.split('\n').length, 4);
  assert.doesNotMatch(p[0].bdd, /@C08|Esquema/);
  assert.match(p[1].bdd, /^Dado que a cotação possui coleta ativada/);
  assert.match(p[1].bdd, /Exemplos:\n\| pais \| campos \|\n\| Brasil \| Cidade, Estado \|$/, 'tabela de exemplos fica no cenário');
  assert.match(p[2].bdd, /HTTP 404\)$/);
  assert.equal(p[2].tag, '@C09');
});

test('"Funcionalidade:" e "Exemplos:" não viram cenário; tag na mesma linha também numera', () => {
  const doc = F.doc(F.p('Feature: Login'), F.p('@CT3 Scenario: Valid login'), F.p('Given a'), F.p('When b'), F.p('Then c'));
  assert.deepEqual(L.lerPlano(paraBlocos(doc)).map(c => [c.ct, c.titulo]), [['CT03', 'Valid login']]);
});

test('regravar mantém o formato "Esquema do Cenário:" sem negrito, e o novo ganha a tag @C10', () => {
  const p = L.lerPlano(paraBlocos(F.QMS_1058));
  const novo = L.substituirCenario(F.QMS_1058, p[1], { titulo: 'Envio dos sinalizadores (revisado)', bdd: 'Dado a\nQuando b\nEntão c' });
  const txt = paraTexto(novo);
  assert.match(txt, /@C08\nEsquema do Cenário: Envio dos sinalizadores \(revisado\)\nDado a\nQuando b\nEntão c\n@C09/);
  assert.ok(!novo.content.some(n => n.content && n.content.some(c => c.marks)), 'sem negrito, como no original');
  const mais = L.acrescentarCenario(novo, 10, 'Coleta na Argentina', 'Dado x\nQuando y\nEntão z');
  assert.match(paraTexto(mais), /HTTP 404\)\n@C10\nEsquema do Cenário: Coleta na Argentina\nDado x/);
  assert.ok(!mais.content.some(n => n.type === 'rule'), 'não inventa régua onde não tinha');
  assert.deepEqual(L.lerPlano(paraBlocos(mais)).map(c => c.ct), ['CT07', 'CT08', 'CT09', 'CT10']);
});

test('tags não viram critério nem passo nos critérios de aceite', () => {
  const doc = F.doc(F.p('Critérios de aceite:'), F.p('@CA1'), F.p('Cenário: A'), F.p('Dado x'), F.p('Quando y'), F.p('Então z'));
  const r = L.lerCriterios(paraBlocos(doc));
  assert.equal(r.total, 1);
  assert.doesNotMatch(r.grupos[0].criterios[0].bdd, /@CA1/);
});

test('pular linha e começar outro Dado depois do Então vira outro cenário', () => {
  const doc = F.doc(F.h(2, '1. Login'), F.p('Dado x'), F.p('Quando y'), F.p('Então z'), F.p(''),
    F.p('Dado que o usuário está bloqueado'), F.p('Quando tenta entrar'), F.p('Então vê o aviso'));
  const p = L.lerPlano(paraBlocos(doc));
  assert.deepEqual(p.map(c => [c.ct, c.titulo, c.bdd.split('\n').length]), [['CT01', 'Login', 3], ['CT02', 'O usuário está bloqueado', 3]]);
  assert.equal(p[1].semTitulo, true);
});

test('plano só com passos, sem nenhum título, também é lido', () => {
  const doc = F.doc(F.p('Given a valid user'), F.p('When logging in'), F.p('Then the home opens'), F.p('Given a blocked user'), F.p('When logging in'), F.p('Then an alert shows'));
  const p = L.lerPlano(paraBlocos(doc));
  assert.deepEqual(p.map(c => c.titulo), ['A valid user', 'A blocked user']);
  // regravar um cenário sem título não cria título
  const novo = L.substituirCenario(doc, p[1], { titulo: 'x', bdd: 'Given a blocked user\nWhen logging in\nThen an alert shows\nAnd nothing else' });
  assert.equal(paraTexto(novo), 'Given a valid user\nWhen logging in\nThen the home opens\nGiven a blocked user\nWhen logging in\nThen an alert shows\nAnd nothing else');
});

test('"E" e "Mas" depois do Então continuam no mesmo cenário', () => {
  const doc = F.doc(F.p('Cenário: A'), F.p('Dado x'), F.p('Quando y'), F.p('Então z'), F.p('E w'), F.p('Mas v'));
  assert.equal(L.lerPlano(paraBlocos(doc))[0].bdd.split('\n').length, 5);
});

test('"contexto:" com Dado/E não vira cenário', () => {
  const doc = F.doc(F.p('contexto:'), F.p('Dado que estou logado no portal como Inside Sales'),
    F.p('E inicio uma cotação aérea do cliente Portlink, EXW, Door to Airport, filial SPO'),
    F.p('@C01'), F.p('Esquema do Cenário: Coleta na Itália'), F.p('Dado que a coleta é na Itália'), F.p('Quando informo o CEP'), F.p('Então o estado é obrigatório'),
    F.p('@C02'), F.p('Esquema do Cenário: Coleta no Brasil'), F.p('Dado que a coleta é no Brasil'), F.p('Quando informo a cidade'), F.p('Então cidade e estado são obrigatórios'));
  const p = L.lerPlano(paraBlocos(doc));
  assert.deepEqual(p.map(c => [c.ct, c.titulo]), [['CT01', 'Coleta na Itália'], ['CT02', 'Coleta no Brasil']]);
  assert.doesNotMatch(p[0].bdd, /Inside Sales/);
});

test('bloco solto só com Dado/E (sem Quando/Então) não vira cenário', () => {
  const doc = F.doc(F.p('Dado que estou logado'), F.p('E tenho uma cotação'), F.p('Cenário: A'), F.p('Dado x'), F.p('Quando y'), F.p('Então z'));
  assert.deepEqual(L.lerPlano(paraBlocos(doc)).map(c => c.titulo), ['A']);
});

test('títulos sem passos BDD não viram cenário', () => {
  assert.equal(L.lerPlano(paraBlocos(F.doc(F.h(2, 'Observações'), F.p('nada aqui')))).length, 0);
});

test('substituirCenario troca só o cenário escolhido e mantém as réguas', () => {
  const blocos = paraBlocos(F.POR_7132);
  const p = L.lerPlano(blocos);
  const novo = L.substituirCenario(F.POR_7132, p[2], { titulo: 'Inglês (revisado)', bdd: 'Given a\nWhen b\nThen c\nAnd o link abre em Inglês' });
  const p2 = L.lerPlano(paraBlocos(novo));
  assert.deepEqual(p2.map(c => c.ct), ['CT01', 'CT02', 'CT03', 'CT04']);
  assert.equal(p2[2].titulo, 'Inglês (revisado)');
  assert.equal(p2[2].bdd, 'Given a\nWhen b\nThen c\nAnd o link abre em Inglês');
  assert.equal(p2[1].bdd, p[1].bdd);
  assert.equal(p2[3].bdd, p[3].bdd);
  assert.equal(novo.content.filter(n => n.type === 'rule').length, 3);
  // palavra-chave em negrito, como no Jira de vocês
  const linha = novo.content.find(n => n.type === 'paragraph' && n.content[0].text === 'And' && /link/.test(n.content[1].text));
  assert.deepEqual(linha.content[0].marks, [{ type: 'strong' }]);
});

test('acrescentarCenario põe régua e o novo cenário no fim', () => {
  const novo = L.acrescentarCenario(F.POR_7132, 5, 'Idioma padrão sem preferência', 'Given sem idioma\nWhen enviado\nThen idioma padrão');
  const p = L.lerPlano(paraBlocos(novo));
  assert.equal(p.length, 5);
  assert.deepEqual([p[4].ct, p[4].titulo], ['CT05', 'Idioma padrão sem preferência']);
  assert.match(paraTexto(L.acrescentarCenario(null, 1, 'x', 'Dado a\nQuando b\nEntão c')), /^1\. x\nDado a/);
});

// ---------------- regras nos comentários

test('regras nos comentários: subtítulos com passos ou exemplo viram regras; commits não', () => {
  const r = L.lerRegrasComentarios([
    { id: '1', autor: 'Jean Oliveira', data: '2026-11-11', blocos: paraBlocos(F.COMENTARIO_COMMIT) },
    { id: '2', autor: 'Samuel Gomes', data: '2026-10-14', blocos: paraBlocos(F.COMENTARIO_REGRA) }
  ]);
  assert.deepEqual(r.map(x => x.titulo), ['Origem US sem IATA e destino definido', 'Destino US sem IATA e origem definida', 'Ranking']);
  assert.equal(r[0].autor, 'Samuel Gomes');
  assert.match(r[0].texto, /LocationCountry=US/);
});

test('comentário sem títulos, com lista de regras, vira uma regra', () => {
  const doc = F.doc(F.p('Ajuste na cotação da primus.'), F.p('Cada opção criada deve passar pelos mesmos critérios de elegibilidade.'),
    F.ul('Custos de origem para o mesmo aeroporto.', 'Limitações de peso e dimensões.'));
  const r = L.lerRegrasComentarios([{ id: '3', autor: 'Marcelo Amaral', blocos: paraBlocos(doc) }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].titulo, 'Ajuste na cotação da primus.');
});

test('comentários curtos e avisos não viram regra', () => {
  const r = L.lerRegrasComentarios([{ id: '4', blocos: paraBlocos(F.doc(F.p('A craft está com problema, não conseguimos entrar no portal.'))) }]);
  assert.equal(r.length, 0);
});

// ---------------- sub-task do plano

test('escolhe a sub-task [QA] que tem cenários', () => {
  const sub = (chave, titulo, adf) => ({ chave, titulo, blocos: paraBlocos(adf) });
  const r = L.escolherSubtarefaPlano([
    sub('POR-7132', '[QA] Análise e Escrita dos Cenários de Teste', F.POR_7132),
    sub('POR-7141', '[QA] Testes e Coleta de Evidências', F.doc(F.p('Evidências em anexo.'))),
    sub('POR-7137', '[FRONT] Templates', F.POR_7132)
  ]);
  assert.equal(r.escolhida, 'POR-7132');
});

test('sem cenários em nenhuma [QA], devolve as opções para a pessoa escolher', () => {
  const r = L.escolherSubtarefaPlano([{ chave: 'QMS-971', titulo: '[QA] Execução de teste', blocos: [] }]);
  assert.deepEqual(r, { escolhida: null, opcoes: ['QMS-971'], motivo: 'sem-cenarios' });
  assert.equal(L.escolherSubtarefaPlano([]).motivo, 'sem-subtarefa');
});
