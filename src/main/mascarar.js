// Troca dados sensíveis do cURL por variáveis no padrão do Postman ({{TOKEN}}, {{SENHA}}...).
// Assim nenhum segredo vai para o relatório e o dev consegue copiar, colocar o próprio token e executar.
const SEGREDOS = ['password', 'senha', 'secret', 'client_secret', 'clientsecret', 'cvv', 'pin'];
const TOKENS = ['token', 'access_token', 'accesstoken', 'refresh_token', 'refreshtoken', 'id_token'];
const CHAVES_API = ['apikey', 'api_key', 'x-api-key', 'api-key'];

const lista = l => l.map(k => k.replace(/[-_]/g, '[-_]?')).join('|');

function mascarar(texto) {
  if (!texto) return texto;
  let t = String(texto);

  // Authorization: Bearer xxx / Basic xxx / Token xxx
  t = t.replace(/(authorization["']?\s*[:=]\s*["']?\s*)(bearer|basic|token)?(\s*)([A-Za-z0-9\-._~+/=]{6,})/gi,
    (_, pre, tipo, esp, tok) => pre + (tipo || '') + (tipo ? esp || ' ' : '') + (/basic/i.test(tipo || '') ? '{{CREDENCIAIS_BASE64}}' : '{{TOKEN}}'));
  // cabeçalhos de chave de API
  t = t.replace(new RegExp(`((?:${lista(CHAVES_API)})["']?\\s*[:=]\\s*["']?)([A-Za-z0-9\\-._~+/=]{6,})`, 'gi'), (_, pre) => pre + '{{API_KEY}}');
  // cURL -u usuario:senha
  t = t.replace(/((?:-u|--user)\s+["']?[^:\s"']+:)([^\s"']+)/g, (_, pre) => pre + '{{SENHA}}');
  // JSON: "senha": "valor"  /  "token": "valor"
  t = t.replace(new RegExp(`("(?:${lista(SEGREDOS)})"\\s*:\\s*")([^"]*)(")`, 'gi'), (_, a, v, c) => a + '{{SENHA}}' + c);
  t = t.replace(new RegExp(`("(?:${lista(TOKENS)})"\\s*:\\s*")([^"]*)(")`, 'gi'), (_, a, v, c) => a + '{{TOKEN}}' + c);
  // query string / form: senha=valor, token=valor
  t = t.replace(new RegExp(`([?&](?:${lista(SEGREDOS)})=)([^&\\s"']+)`, 'gi'), (_, a) => a + '{{SENHA}}');
  t = t.replace(new RegExp(`([?&](?:${lista(TOKENS)})=)([^&\\s"']+)`, 'gi'), (_, a) => a + '{{TOKEN}}');
  t = t.replace(new RegExp(`([?&](?:${lista(CHAVES_API)})=)([^&\\s"']+)`, 'gi'), (_, a) => a + '{{API_KEY}}');
  // CPF (formatado, ou em campo "cpf")
  t = t.replace(/("cpf"\s*:\s*")([^"]*)(")/gi, '$1{{CPF}}$3');
  t = t.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '{{CPF}}');
  return t;
}

// Lista as variáveis usadas, para avisar o dev no relatório
function variaveis(texto) {
  return [...new Set((String(texto || '').match(/\{\{[A-Z_0-9]+\}\}/g) || []))];
}

module.exports = { mascarar, variaveis };
