// Conversão do formato de texto do Jira Cloud (ADF, Atlassian Document Format).
//
// paraBlocos(adf): lista "plana" de blocos, um por linha lógica, usada pelos leitores
//   de critérios e cenários:
//     { tipo: 'titulo', nivel: 1..6, texto }
//     { tipo: 'paragrafo', texto }
//     { tipo: 'item', nivel: 1.., numero: 3 | null, texto }   (item de lista; nivel 1 = lista de fora)
//     { tipo: 'linha' }                                       (régua horizontal)
//     { tipo: 'codigo', texto }
// paraTexto(adf): texto simples, com listas numeradas e marcadores, para mostrar na tela.
// deTexto(texto): monta um ADF simples a partir de texto (para gravar no Jira).

const chaveDoLink = url => (String(url || '').match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/) || [])[1];

// Texto de um nó "inline" (dentro de parágrafo, título ou item)
function inline(n) {
  if (!n) return '';
  switch (n.type) {
    case 'text': return n.text || '';
    case 'hardBreak': return '\n';
    case 'mention': return (n.attrs && n.attrs.text || '').replace(/^@/, '');
    case 'emoji': return (n.attrs && (n.attrs.text || n.attrs.shortName)) || '';
    case 'status': return (n.attrs && n.attrs.text) || '';
    case 'date': {
      const t = Number(n.attrs && n.attrs.timestamp);
      return isNaN(t) ? '' : new Date(t).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    }
    case 'inlineCard': case 'blockCard': case 'embedCard': {
      const url = n.attrs && n.attrs.url;
      return chaveDoLink(url) || url || '';
    }
    default: return (n.content || []).map(inline).join('');
  }
}

const limpa = s => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();

function paraBlocos(adf) {
  if (adf == null) return [];
  // Jira Server / API v2 devolve texto simples
  if (typeof adf === 'string') {
    return adf.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(texto => ({ tipo: 'paragrafo', texto }));
  }
  const out = [];
  const bloco = (n, nivelLista) => {
    if (!n) return;
    switch (n.type) {
      case 'doc': case 'panel': case 'blockquote': case 'layoutSection': case 'layoutColumn': case 'nestedExpand': case 'bodiedExtension':
        (n.content || []).forEach(c => bloco(c, nivelLista)); break;
      case 'expand':
        if (n.attrs && n.attrs.title) out.push({ tipo: 'titulo', nivel: 6, texto: n.attrs.title });
        (n.content || []).forEach(c => bloco(c, nivelLista)); break;
      case 'heading': {
        const texto = limpa(inline(n));
        if (texto) out.push({ tipo: 'titulo', nivel: (n.attrs && n.attrs.level) || 1, texto });
        break;
      }
      case 'paragraph': {
        const texto = limpa(inline(n));
        if (texto) texto.split('\n').forEach(t => out.push({ tipo: 'paragrafo', texto: t }));
        break;
      }
      case 'bulletList': case 'orderedList': {
        let numero = n.type === 'orderedList' ? ((n.attrs && n.attrs.order) || 1) : null;
        (n.content || []).forEach(item => {
          // o texto do item é o primeiro parágrafo; listas dentro dele viram itens de nível maior
          const partes = item.content || [];
          const texto = limpa(partes.filter(p => p.type !== 'bulletList' && p.type !== 'orderedList').map(p => p.type === 'paragraph' || p.type === 'heading' ? inline(p) : '').join('\n'));
          out.push({ tipo: 'item', nivel: nivelLista + 1, numero, texto: texto.replace(/\n+/g, ' ') });
          partes.filter(p => p.type === 'bulletList' || p.type === 'orderedList').forEach(sub => bloco(sub, nivelLista + 1));
          if (numero != null) numero++;
        });
        break;
      }
      case 'rule': out.push({ tipo: 'linha' }); break;
      case 'codeBlock': out.push({ tipo: 'codigo', texto: (n.content || []).map(inline).join('') }); break;
      case 'table':
        (n.content || []).forEach(row => {
          const celulas = (row.content || []).map(c => limpa((c.content || []).map(inline).join(' ')));
          if (celulas.some(Boolean)) out.push({ tipo: 'paragrafo', texto: celulas.join(' | ') });
        });
        break;
      case 'mediaSingle': case 'mediaGroup': case 'media': break; // imagens e anexos não entram no texto
      default:
        if (n.content) n.content.forEach(c => bloco(c, nivelLista));
        else { const t = limpa(inline(n)); if (t) out.push({ tipo: 'paragrafo', texto: t }); }
    }
  };
  bloco(adf, 0);
  return out;
}

function paraTexto(adf) {
  return paraBlocos(adf).map(b => {
    if (b.tipo === 'item') return '  '.repeat(b.nivel - 1) + (b.numero != null ? `${b.numero}. ` : '- ') + b.texto;
    if (b.tipo === 'linha') return '---';
    return b.texto;
  }).join('\n');
}

// ADF simples a partir de texto: cada linha vira um parágrafo; "---" vira régua
function deTexto(texto) {
  const content = String(texto || '').split(/\r?\n/).map(l => l.trim() === '---'
    ? { type: 'rule' }
    : { type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] });
  return { type: 'doc', version: 1, content };
}

module.exports = { paraBlocos, paraTexto, deTexto, chaveDoLink };
