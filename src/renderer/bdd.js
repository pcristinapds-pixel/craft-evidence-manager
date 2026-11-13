// Validação da estrutura mínima do cenário BDD.
// Usado pela tela (app.js) e pelos testes unitários (Node).
(function (raiz) {
  // Cada passo aceita a palavra em português ou em inglês (Gherkin)
  const PASSOS = [
    { pt: 'Dado', en: 'Given', re: '(dad[oa]s?|given)' },
    { pt: 'Quando', en: 'When', re: '(quando|when)' },
    { pt: 'Então', en: 'Then', re: '(entao|then)' }
  ];
  const INGLES = /^(given|when|then|and|but|scenario|feature|background|examples)\b/;

  // Estrutura mínima do BDD: linhas começando com Dado/Given, Quando/When e Então/Then, nessa ordem
  // (E / Mas / And / But / Cenário / Scenario / Exemplos e outras linhas são aceitas entre elas)
  function validarBdd(texto) {
    const sem = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const linhas = String(texto || '').split('\n').map(l => sem(l.trim())).filter(Boolean);
    const emIngles = linhas.some(l => INGLES.test(l));
    const nome = p => emIngles ? p.en : p.pt;
    const pos = linhas.length ? PASSOS.map(p => linhas.findIndex(l => new RegExp('^' + p.re + '\\b').test(l))) : [-1, -1, -1];
    const faltam = PASSOS.filter((p, i) => pos[i] < 0).map(nome);
    const exemplo = emIngles
      ? '\n\nExemplo:\nGiven que estou na tela de histórico\nWhen filtro pelo localizador\nThen vejo os eventos da reserva'
      : '\n\nExemplo:\nDado que estou na tela de histórico\nQuando filtro pelo localizador\nEntão vejo os eventos da reserva';
    if (faltam.length) return `Cada passo deve começar em uma linha nova. Faltou: ${faltam.join(', ')}.` + exemplo;
    if (!(pos[0] < pos[1] && pos[1] < pos[2])) return `Os passos devem seguir a ordem ${PASSOS.map(nome).join(' → ')}.` + exemplo;
    return '';
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { validarBdd };
  else raiz.validarBdd = validarBdd;
})(typeof window !== 'undefined' ? window : globalThis);
