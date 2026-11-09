// Validação da estrutura mínima do cenário BDD.
// Usado pela tela (app.js) e pelos testes unitários (Node).
(function (raiz) {
  // Estrutura mínima do BDD: linhas começando com Dado, Quando e Então, nessa ordem
  // (E / Mas / Contexto / Cenário / Exemplos são aceitos entre elas)
  function validarBdd(texto) {
    const sem = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const linhas = String(texto || '').split('\n').map(l => sem(l.trim())).filter(Boolean);
    const pos = chave => linhas.findIndex(l => new RegExp('^' + chave + '\\b').test(l));
    const dado = pos('dad[oa]s?'), quando = pos('quando'), entao = pos('entao');
    const faltam = [dado < 0 && 'Dado', quando < 0 && 'Quando', entao < 0 && 'Então'].filter(Boolean);
    const exemplo = '\n\nExemplo:\nDado que estou na tela de histórico\nQuando filtro pelo localizador\nEntão vejo os eventos da reserva';
    if (faltam.length) return `Cada passo deve começar em uma linha nova. Faltou: ${faltam.join(', ')}.` + exemplo;
    if (!(dado < quando && quando < entao)) return 'Os passos devem seguir a ordem Dado → Quando → Então.' + exemplo;
    return '';
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { validarBdd };
  else raiz.validarBdd = validarBdd;
})(typeof window !== 'undefined' ? window : globalThis);
