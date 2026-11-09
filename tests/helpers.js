// Utilitários compartilhados pelos testes
const fs = require('fs');
const os = require('os');
const path = require('path');

// PNG 1x1 válido (para simular prints)
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pastaTemp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-evid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Arquivo falso (conteúdo irrelevante) com o tamanho pedido
function arquivo(caminho, bytes = 16) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, Buffer.alloc(bytes, 1));
  return caminho;
}

// Dados de um cenário, no formato que a tela envia
function cenario(extra = {}) {
  return {
    storyId: 'QMS-1036', storyTitle: 'Consulta de histórico do aéreo',
    testCaseId: 'CT01', tipo: 'front', author: 'Paloma', environment: 'QA', version: '2.14.0',
    title: 'Validação da tabela', bddText: 'Dado que estou logado\nQuando abro o histórico\nEntão vejo a tabela',
    status: 'Passou', observacao: '', evidences: [{ type: 'image', dataUrl: PNG_1PX, width: 1, height: 1, legenda: 'Tabela' }],
    ...extra
  };
}

// Lê o JSON de dados embutido no relatório .html
function dadosDoRelatorio(arq) {
  const html = fs.readFileSync(arq, 'utf8');
  const m = html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

module.exports = { PNG_1PX, pastaTemp, arquivo, cenario, dadosDoRelatorio };
