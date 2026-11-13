// Guarda o token de API do Jira criptografado neste computador.
// No app, `cifra` é o safeStorage do Electron (no Windows usa a proteção da conta do usuário).
// O token nunca vai para relatórios, PPTs ou logs.

function salvarToken(store, cifra, token) {
  const t = String(token || '').trim();
  if (!t) { store.delete('jiraToken'); return; }
  if (!cifra.isEncryptionAvailable()) throw new Error('Este computador não oferece armazenamento seguro para o token.');
  store.set('jiraToken', cifra.encryptString(t).toString('base64'));
}

function lerToken(store, cifra) {
  const guardado = store.get('jiraToken');
  if (!guardado) return '';
  try { return cifra.decryptString(Buffer.from(guardado, 'base64')); } catch { return ''; }
}

// Configuração do Jira para a tela: nunca devolve o token, só se ele existe
function configJira(store, cifra) {
  return {
    site: store.get('jiraSite') || '',
    email: store.get('jiraEmail') || '',
    temToken: !!lerToken(store, cifra),
    prefixoPlano: store.get('jiraPrefixoPlano') || '[QA]'
  };
}

module.exports = { salvarToken, lerToken, configJira };
