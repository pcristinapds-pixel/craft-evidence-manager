// Descrições do Jira (formato ADF) parecidas com as reais, usadas nos testes.
// Montadas com funções curtas para ficar legível.
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks: marks.map(type => ({ type })) } : {}) });
const p = (...c) => ({ type: 'paragraph', content: c.map(x => typeof x === 'string' ? t(x) : x) });
const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const li = (texto, ...sub) => ({ type: 'listItem', content: [p(texto), ...sub] });
const ul = (...itens) => ({ type: 'bulletList', content: itens.map(i => typeof i === 'string' ? li(i) : i) });
const ol = (...itens) => ({ type: 'orderedList', attrs: { order: 1 }, content: itens.map(i => typeof i === 'string' ? li(i) : i) });
const rule = () => ({ type: 'rule' });
const doc = (...c) => ({ type: 'doc', version: 1, content: c });
const forte = s => t(s, ['strong']);

// POR-6925 · "Descrição para história": seções numeradas, critérios agrupados por subtítulo em negrito
const POR_6925 = doc(
  p('---------------- Responder obrigatoriamente ----------------'),
  p('1.Descrição/ Objetivo:'),
  p('Garantir que, após a criação de um novo acesso pela empresa, o usuário receba o e-mail de boas-vindas no mesmo idioma.'),
  p('2.Tipo de usuário: Usuário do Portal que teve seu acesso criado pela empresa.'),
  p('3.Existe risco/ restrição para o ambiente de produção?'),
  p('4.Critérios de aceite:'),
  p(forte('Cadastro do idioma')),
  ul('O idioma de preferência informado pela empresa deverá ficar associado ao usuário durante a criação do acesso.',
     'O idioma cadastrado deverá estar disponível para utilização no momento do envio do e-mail.'),
  p(forte('Envio do e-mail')),
  ul('O e-mail de boas-vindas deverá ser enviado no idioma de preferência cadastrado para o usuário.',
     'Usuários com preferência em português deverão receber a versão em português.',
     'Usuários com preferência em espanhol deverão receber a versão em espanhol.',
     'Usuários com preferência em inglês deverão receber a versão em inglês.',
     'O assunto do e-mail deverá acompanhar o idioma selecionado.',
     'O conteúdo, botões, CTAs e demais textos do template deverão respeitar o idioma correspondente, quando aplicável.',
     'As informações dinâmicas existentes no e-mail deverão continuar sendo apresentadas corretamente nas diferentes versões.'),
  p(forte('Regra de disparo')),
  ul('A implementação não deverá alterar o momento ou o gatilho atualmente utilizado para o envio do e-mail de boas-vindas.',
     'A única diferenciação deverá ser a versão do conteúdo enviada de acordo com o idioma do usuário.'),
  p(forte('Ausência de idioma')),
  ul('Caso não exista idioma de preferência preenchido, deverá ser utilizado o idioma padrão definido para a solução.',
     'A regra de fallback deverá ser documentada e validada antes da disponibilização em produção.'),
  p('5.Onde isso acontece? No Portal, envolvendo o fluxo de criação de acessos.'),
  p('6.Link da Documentação no confluence + Sharepoint:'),
  p('7.Anexos/ Protótipos:')
);

// POR-7132 · descrição da sub-task "[QA] Análise e Escrita dos Cenários de Teste"
const cen = (n, titulo, linhas) => [h(2, `${n}. ${titulo}`), ...linhas.map(([k, r]) => k ? p(forte(k), ' ' + r) : p(r))];
const POR_7132 = doc(
  ...cen(1, 'Validar envio do e-mail de boas-vindas conforme idioma da empresa', [
    ['Given', 'um novo acesso foi criado com um idioma de preferência'],
    ['When', 'o e-mail de boas-vindas for enviado'],
    ['Then', 'o e-mail deve ser apresentado no mesmo idioma cadastrado para o usuário'],
    ['And', 'o assunto, conteúdo, botões e CTAs devem respeitar o idioma selecionado'],
    ['And', 'as informações dinâmicas do e-mail devem ser apresentadas corretamente'],
    [null, 'Exemplos de idioma: Português, Espanhol e Inglês.']]),
  rule(),
  ...cen(2, 'Validar recebimento do e-mail de boas-vindas em Espanhol', [
    ['Given', 'um novo acesso foi criado com Espanhol como idioma de preferência'],
    ['When', 'o e-mail de boas-vindas for enviado'],
    ['Then', 'o usuário deve receber o e-mail em Espanhol'],
    ['And', 'o assunto, conteúdo, botões e CTAs devem estar em Espanhol'],
    ['And', 'as informações dinâmicas devem ser apresentadas corretamente']]),
  rule(),
  ...cen(3, 'Validar recebimento do e-mail de boas-vindas em Inglês', [
    ['Given', 'um novo acesso foi criado com Inglês como idioma de preferência'],
    ['When', 'o e-mail de boas-vindas for enviado'],
    ['Then', 'o usuário deve receber o e-mail em Inglês'],
    ['And', 'o assunto, conteúdo, botões e CTAs devem estar em Inglês'],
    ['And', 'as informações dinâmicas devem ser apresentadas corretamente']]),
  rule(),
  ...cen(4, 'Validar recebimento do e-mail de boas-vindas em Português', [
    ['Given', 'um novo acesso foi criado com Português como idioma de preferência'],
    ['When', 'o e-mail de boas-vindas for enviado'],
    ['Then', 'o usuário deve receber o e-mail em Português'],
    ['And', 'o assunto, conteúdo, botões e CTAs devem estar em Português'],
    ['And', 'as informações dinâmicas devem ser apresentadas corretamente']])
);

// QMS-823 · lista numerada, subitem no item 8, citação de outra issue no item 11, lista "DoD" depois
const card = key => ({ type: 'inlineCard', attrs: { url: `https://craft-multi-team.atlassian.net/browse/${key}` } });
const status = text => ({ type: 'status', attrs: { text, color: 'blue' } });
const QMS_823 = doc(
  p('1. Descrição / Objetivo:'),
  p('A cotação aérea com coleta ou entrega nos Estados Unidos quebra hoje de duas formas opostas.'),
  p('4. Critérios de aceite:'),
  ol('Cotação aérea com coleta ou entrega nos Estados Unidos, em localidade que tem transporte terrestre na base: o QMS devolve na modalidade pedida (D2D, D2A ou A2D).',
     'Cotação aérea com coleta ou entrega nos Estados Unidos, em localidade que não tem transporte terrestre na base: o QMS não devolve erro.',
     'O leque traz as rotas consolidadas e as back to back.',
     'Os aeroportos do leque são os da ponta americana.',
     'Só entram no leque as rotas que passam nas validações que já existem.',
     'O leque vem ordenado do all-in mais barato para o mais caro.',
     'Cada opção do leque vem com o aeroporto correspondente.',
     li('Numa cotação porta a porta com coleta nos Estados Unidos e entrega em outro país, só a coleta americana volta em branco.',
        ol('Caso a entrega definida, não tenha cadastro na base, ela segue a regra e se torna inelegível')),
     'O erro de preço de frete não encontrado, gerado pela conversão da modalidade, não sai para o Portal.',
     'Cotação sem nenhuma ponta nos Estados Unidos não monta leque e continua se comportando como hoje.',
     { type: 'listItem', content: [{ type: 'paragraph', content: [t('Primeira entrega: a ordenação pelo aeroporto mais próximo, pela tabela de ZIP code da '), card('QMS-795'), t(' '), status('EM REFINAMENTO (R)'), t(' , entra na etapa seguinte.')] }] }),
  p('5. Onde isso acontece?'),
  p('No atendimento da cotação aérea do QMS.'),
  p('7. Anexos/ Protótipos:'),
  ol(li('DoD', ol('Os 11 critérios exercitados em cotação de ponta a ponta.', 'Os dois cenários de regressão executados.')))
);

// CNN-1935 · épico, "Descrição Épico", títulos sublinhados e "Critérios de sucesso"
const CNN_1935 = doc(
  p(t('Objetivo:', ['underline', 'strong'])),
  p('Validar a viabilidade técnica e operacional do Connect Engine.'),
  p(t('Principais Entregas:', ['underline', 'strong'])),
  ul('Criação do ambiente para testes.', 'Seleção de pipelines candidatas.'),
  p(t('Critérios de sucesso:', ['underline', 'strong'])),
  ul('Execução das integrações selecionadas com estabilidade.',
     'Evidência de viabilidade para substituição da Digibee.',
     'Lista priorizada de melhorias necessárias.')
);

// Comentário com regra (QMS-823, Samuel Gomes)
const COMENTARIO_REGRA = doc(
  h(2, 'Regra complementar — resolução dinâmica de IATA no fluxo PRIMUS'),
  p('Esta regra é uma extensão mínima do fluxo PRIMUS já existente.'),
  h(3, 'Origem US sem IATA e destino definido'),
  p('Exemplo: origem possui endereço US e hasPickup: true, não possui Inland e origin.airportCode é nulo; destino possui IATA, por exemplo AMS.'),
  ol('Consultar Inland da perna ORIGIN com LocationCountry=US.', 'Obter dinamicamente os aeroportos candidatos.'),
  h(3, 'Destino US sem IATA e origem definida'),
  ol('Consultar Inland da perna DESTINATION com LocationCountry=US.', 'Obter os aeroportos americanos candidatos.'),
  h(3, 'Ranking'),
  ul('CONSOL e Back-to-Back participam do mesmo conjunto;', 'o rank é definido pelo menor all-in parcial calculável;')
);
const COMENTARIO_COMMIT = doc(p(forte('Commit registrado')), p('Commit: 98979f3'), p('Branch: jean.oliveira/feature/POR-6925'));

// QMS-1058 · plano em Gherkin com tags "@C07" e "Esquema do Cenário:" em parágrafos, sem réguas
const QMS_1058 = doc(
  p('Funcionalidade: Campos obrigatórios de coleta por país'),
  p('@C07'),
  p('Esquema do Cenário: Validação de Coleta no Brasil para Exportação (Cidade + Estado)'),
  p('Dado que estou em um fluxo de exportação aérea EXW Door to Airport com coleta no Brasil'),
  p('Quando seleciono o Estado e a Cidade da coleta'),
  p('Então os campos Cidade e Estado devem ser os únicos rotulados como obrigatórios (*)'),
  p('E a cotação deve ser gerada normalmente'),
  p('@C08'),
  p('Esquema do Cenário: Envio dos sinalizadores de Coleta na integração com o QMS'),
  p('Dado que a cotação possui coleta ativada'),
  p('Quando o portal consulta a disponibilidade de tarifas no QMS'),
  p('Então o payload da requisição deve enviar obrigatoriamente hasPickup = true e hasDelivery = false'),
  p('E incluir os dados do endereço de coleta com a sublocation correspondente'),
  p('Exemplos:'),
  p('| pais | campos |'),
  p('| Brasil | Cidade, Estado |'),
  p('@C09'),
  p('Esquema do Cenário: Exibição de mensagem amigável para rotas sem tarifa de coleta'),
  p('Dado que não existe tarifa cadastrada na base para a rota com coleta pesquisada'),
  p('Quando concluo a etapa de carga'),
  p('Então a cotação deve ser criada com sucesso'),
  p('E a tela deve exibir a mensagem amigável informando ausência de rotas disponíveis, sem disparar erros genéricos de sistema (HTTP 404)')
);

module.exports = { QMS_1058, t, p, h, li, ul, ol, rule, doc, forte, POR_6925, POR_7132, QMS_823, CNN_1935, COMENTARIO_REGRA, COMENTARIO_COMMIT };
