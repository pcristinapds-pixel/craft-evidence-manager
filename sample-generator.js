// Gera um PPT de exemplo sem abrir o app: npm run test:ppt
// O arquivo é salvo na pasta "exemplo-saida" dentro do projeto.
const path = require('path');
const fs = require('fs');
const { generatePPTX } = require('./src/main/ppt-builder');

const ex = n => path.join(__dirname, 'assets', 'exemplo', n);
const dataUrl = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

generatePPTX({
  storyId: 'QMS-1036',
  testCaseId: 'CT01',
  title: 'Consulta de histórico do aéreo',
  author: 'QA Craft',
  environment: 'Homologação',
  version: '2.14.0',
  status: process.argv[2] || 'Passou',
  dateTime: new Date().toLocaleString('pt-BR'),
  jiraBaseUrl: 'https://suaempresa.atlassian.net/browse/',
  bddText: [
    'Cenário: Consultar histórico de uma reserva aérea',
    'Dado que estou logado como agente de viagens',
    'E possuo uma reserva aérea emitida',
    'Quando acesso a tela de histórico do aéreo',
    'Então devo visualizar todas as alterações da reserva em ordem cronológica'
  ].join('\n'),
  evidences: [
    { type: 'image', dataUrl: dataUrl(ex('print1.png')) },  // tela ultrawide 21:9
    { type: 'image', dataUrl: dataUrl(ex('print2.png')) },  // tela 16:9
    { type: 'video', filePath: ex('video.mp4'), width: 1280, height: 720 }
  ]
}, path.join(__dirname, 'exemplo-saida'), path.join(__dirname, 'assets', 'logo.png'))
  .then(f => console.log('PPT de exemplo gerado em:', f))
  .catch(e => { console.error(e); process.exit(1); });
