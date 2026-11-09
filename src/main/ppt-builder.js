// Gera o PowerPoint de evidência
//   Slide 1 -> logo da Craft
//   Slide 2 -> título + cenário BDD + informações (história com link, CT, data, responsável, ambiente, versão, status)
//   Slides seguintes -> um print por slide ("Passo N de M") e/ou vídeo embutido
const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

// Slide widescreen 13,333 x 7,5 pol. (LAYOUT_WIDE). O "LAYOUT_16x9" do pptxgenjs é 10 x 5,625,
// e era isso que fazia tabela, BDD e prints vazarem para fora do slide.
const W = 13.333;
const H = 7.5;

const COR = {
  vermelho: 'E30613',
  ardosia: '2B3640',
  aco: 'A7B4BE',
  acoEscuro: '6B7B88',
  texto: '1C252D',
  fundoClaro: 'F3F6F8',
  borda: 'DCE3E8',
  branco: 'FFFFFF',
  link: '0B63C9'
};
const STATUS_COR = { 'Passou': '1A7F37', 'Falhou': 'C8102E', 'Bloqueado': 'B35900', 'Não executado': '6B7B88' };
const STATUS_FUNDO = { 'Passou': 'E8F4EB', 'Falhou': 'FCE8EA', 'Bloqueado': 'FBF0E4', 'Não executado': 'EEF1F4' };
const FONTE = 'Segoe UI';
const FONTE_TITULO = 'Bahnschrift';
const FONTE_MONO = 'Consolas';

const PALAVRAS_BDD = ['Esquema do Cenário', 'Funcionalidade', 'Cenário', 'Contexto', 'Exemplos',
  'Dado que', 'Dado', 'Quando', 'Então', 'Entao', 'E', 'Mas',
  'Feature', 'Scenario', 'Given', 'When', 'Then', 'And', 'But'];
const TITULOS_BDD = ['Esquema do Cenário', 'Funcionalidade', 'Cenário', 'Contexto', 'Exemplos', 'Feature', 'Scenario'];

function getUniqueFilePath(baseFolder, fileName) {
  let fullPath = path.join(baseFolder, `${fileName}.pptx`);
  let counter = 2;
  while (fs.existsSync(fullPath)) fullPath = path.join(baseFolder, `${fileName} (${counter++}).pptx`);
  return fullPath;
}

function limparNome(s) {
  return String(s || '').replace(/[\\/:*?"<>|\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim();
}

// Lê largura/altura de um PNG ou JPEG (data URL ou arquivo) sem dependências
function dimensoesImagem(fonte) {
  try {
    let buf;
    if (typeof fonte === 'string' && fonte.startsWith('data:')) {
      buf = Buffer.from(fonte.slice(fonte.indexOf(',') + 1, fonte.indexOf(',') + 1 + 70000), 'base64');
    } else if (fonte) {
      buf = fs.readFileSync(fonte);
    }
    if (!buf) return null;
    if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* usa padrão */ }
  return null;
}

// Encaixa mantendo a proporção (telas ultrawide 21:9, 16:9, janelas...)
function encaixar(imgW, imgH, x, y, w, h) {
  const e = Math.min(w / imgW, h / imgH);
  const ww = imgW * e;
  const hh = imgH * e;
  return { x: x + (w - ww) / 2, y: y + (h - hh) / 2, w: ww, h: hh };
}

function bddParaRuns(texto) {
  const linhas = String(texto || '').replace(/\r/g, '').split('\n');
  const ordenadas = [...PALAVRAS_BDD].sort((a, b) => b.length - a.length);
  const runs = [];
  linhas.forEach((original, i) => {
    const quebra = i < linhas.length - 1;
    const linha = original.trimEnd();
    const corpo = linha.trimStart();
    const recuo = '   '.repeat(Math.min(Math.floor((linha.length - corpo.length) / 2), 3));
    const chave = ordenadas.find(p => corpo.toLowerCase().startsWith(p.toLowerCase()) && /^([\s:,]|$)/.test(corpo.slice(p.length)));
    if (chave) {
      const titulo = TITULOS_BDD.includes(chave);
      const secundaria = ['E', 'Mas', 'And', 'But'].includes(chave);
      runs.push({ text: recuo + corpo.slice(0, chave.length), options: { bold: true, color: titulo ? COR.ardosia : (secundaria ? COR.acoEscuro : COR.vermelho) } });
      runs.push({ text: corpo.slice(chave.length), options: { color: COR.texto, bold: titulo, breakLine: quebra } });
    } else {
      runs.push({ text: (recuo + corpo) || ' ', options: { color: COR.texto, breakLine: quebra } });
    }
  });
  return runs.length ? runs : [{ text: ' ' }];
}

// "08/11/2026, 20:37:54" -> "08/11/2026 20:37"
function dataCurta(t) {
  const m = String(t || '').match(/(\d{2}\/\d{2}\/\d{4}),?\s*(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : (t || '');
}

function linkHistoria(base, id) {
  if (!id) return '';
  if (/^https?:\/\//i.test(id)) return id;
  if (!base) return '';
  return base.replace(/\/?$/, '/') + encodeURIComponent(String(id).trim());
}

async function generatePPTX(data, saveFolder, logoPath) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = data.author || 'QA Craft';
  pptx.company = 'Craft';

  const titulo = limparNome(data.title);
  const nome = [data.storyId, data.testCaseId, titulo].map(s => String(s || '').trim()).filter(Boolean).join(' - ');
  pptx.title = nome;

  const temLogo = logoPath && fs.existsSync(logoPath);
  const dimLogo = (temLogo && dimensoesImagem(logoPath)) || { w: 504, h: 232 };
  const ratioLogo = dimLogo.w / dimLogo.h;

  // Master dos slides internos: faixa vermelha fina no rodapé, logo pequeno e número do slide
  const objetosMaster = [{ rect: { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: COR.vermelho } } }];
  // logo pequeno no canto superior direito
  if (temLogo) objetosMaster.push({ image: { path: logoPath, x: W - 0.7 - 0.38 * ratioLogo, y: 0.4, w: 0.38 * ratioLogo, h: 0.38 } });
  pptx.defineSlideMaster({
    title: 'EVIDENCIA',
    background: { color: COR.branco },
    objects: objetosMaster,
    slideNumber: { x: 0.7, y: H - 0.62, w: 0.8, h: 0.36, fontFace: FONTE, fontSize: 10, color: COR.aco }
  });

  // ---------------- Slide 1: logo ----------------
  const s1 = pptx.addSlide();
  s1.background = { color: COR.branco };
  if (temLogo) {
    const lw = 6.0, lh = lw / ratioLogo;
    s1.addImage({ path: logoPath, x: (W - lw) / 2, y: (H - lh) / 2 - 0.45, w: lw, h: lh });
    s1.addText('Evidência de teste', {
      x: 0, y: (H + lh) / 2 - 0.15, w: W, h: 0.55, align: 'center', fontFace: FONTE, fontSize: 20, color: COR.acoEscuro
    });
  } else {
    s1.addText('CRAFT', { x: 0, y: 2.8, w: W, h: 1.2, align: 'center', fontFace: FONTE_TITULO, fontSize: 60, bold: true, color: COR.vermelho });
  }
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.14, w: W, h: 0.14, fill: { color: COR.vermelho }, line: { color: COR.vermelho, width: 0 } });

  // ---------------- Slide 2: título, cenário e informações abaixo ----------------
  const s2 = pptx.addSlide({ masterName: 'EVIDENCIA' });
  const M = 0.7;
  s2.addText([data.storyId, data.testCaseId].filter(Boolean).join(' - '), {
    x: M, y: 0.45, w: W - 2 * M - 1.2, h: 0.4, fontFace: FONTE_TITULO, fontSize: 18, bold: true, color: COR.vermelho, margin: 0
  });
  s2.addText(titulo, {
    x: M, y: 0.85, w: W - 2 * M, h: 0.65, fontFace: FONTE_TITULO, fontSize: 30, bold: true, color: COR.texto, margin: 0, fit: 'shrink'
  });
  s2.addShape(pptx.ShapeType.rect, { x: M, y: 1.68, w: 0.9, h: 0.05, fill: { color: COR.vermelho }, line: { color: COR.vermelho, width: 0 } });

  // Cenário (largura total)
  const yB = 2.05, hB = 3.15;
  s2.addText('Cenário', { x: M, y: yB, w: 3, h: 0.35, fontFace: FONTE, fontSize: 12, bold: true, color: COR.acoEscuro, margin: 0 });
  s2.addShape(pptx.ShapeType.roundRect, {
    x: M, y: yB + 0.42, w: W - 2 * M, h: hB - 0.42, fill: { color: 'F5F7F9' }, line: { color: 'E3E8EC', width: 0.75 }, rectRadius: 0.08
  });
  s2.addText(bddParaRuns(data.bddText), {
    x: M + 0.1, y: yB + 0.5, w: W - 2 * M - 0.2, h: hB - 0.58, fontFace: FONTE, fontSize: 16, valign: 'top',
    lineSpacingMultiple: 1.4, margin: [10, 14, 10, 14], fit: 'shrink'
  });

  // Informações em uma linha, abaixo do cenário
  const yI = yB + hB + 0.35;
  s2.addText('Informações', { x: M, y: yI, w: 3, h: 0.35, fontFace: FONTE, fontSize: 12, bold: true, color: COR.acoEscuro, margin: 0 });
  const link = linkHistoria(data.jiraBaseUrl, data.storyId);
  const itens = [
    ['História', data.storyId, 'link'], ['Caso de teste', data.testCaseId], ['Data', dataCurta(data.dateTime)],
    ['Responsável', data.author], ['Ambiente', data.environment], ['Versão', data.version], ['Status', data.status, 'status']
  ];
  const larguras = [1.5, 1.35, 1.95, 1.8, 1.8, 1.15];
  larguras.push(W - 2 * M - larguras.reduce((a, b) => a + b, 0));
  const yv = yI + 0.45;
  let xi = M;
  itens.forEach(([rotulo, valor, tipo], i) => {
    const w = larguras[i];
    if (i) s2.addShape(pptx.ShapeType.line, { x: xi - 0.15, y: yv + 0.05, w: 0, h: 0.7, line: { color: 'E3E8EC', width: 0.75 } });
    s2.addText(rotulo, { x: xi, y: yv, w: w - 0.25, h: 0.3, fontFace: FONTE, fontSize: 11, color: COR.acoEscuro, margin: 0 });
    if (tipo === 'status') {
      const cor = STATUS_COR[valor] || COR.acoEscuro;
      const largSelo = Math.max(1.15, 0.35 + String(valor || '').length * 0.11);
      s2.addShape(pptx.ShapeType.roundRect, {
        x: xi, y: yv + 0.34, w: largSelo, h: 0.36, fill: { color: STATUS_FUNDO[valor] || 'EEF1F4' }, line: { color: STATUS_FUNDO[valor] || 'EEF1F4', width: 0 }, rectRadius: 0.18
      });
      s2.addText('● ' + (valor || '—'), {
        x: xi, y: yv + 0.34, w: largSelo, h: 0.36, fontFace: FONTE, fontSize: 12, bold: true, color: cor, align: 'center', valign: 'middle', margin: 0
      });
    } else if (tipo === 'link' && link) {
      s2.addText(String(valor || '—'), {
        x: xi, y: yv + 0.32, w: w - 0.25, h: 0.4, fontFace: FONTE, fontSize: 14, bold: true, color: COR.link,
        underline: { style: 'sng' }, hyperlink: { url: link, tooltip: 'Abrir história' }, valign: 'middle', margin: 0, fit: 'shrink'
      });
    } else {
      s2.addText(String(valor || '—'), {
        x: xi, y: yv + 0.32, w: w - 0.25, h: 0.4, fontFace: FONTE, fontSize: 14, color: COR.texto, bold: tipo === 'link',
        valign: 'middle', margin: 0, fit: 'shrink'
      });
    }
    xi += w;
  });

  // ---------------- Slides de evidência ----------------
  const evid = data.evidences || [];
  const totalPrints = evid.filter(e => e.type === 'image').length;
  const destino = getUniqueFilePath(saveFolder, limparNome(nome) || 'evidencia');
  let passo = 0;

  for (const item of evid) {
    const s = pptx.addSlide({ masterName: 'EVIDENCIA' });
    const ehVideo = item.type === 'video';
    s.addText([
      { text: ehVideo ? 'Vídeo da execução' : `Passo ${++passo} de ${totalPrints}`, options: { bold: true, color: COR.vermelho } },
      { text: '    ' + nome, options: { color: COR.acoEscuro } }
    ], { x: 0.7, y: 0.37, w: W - 1.4 - 1.3, h: 0.45, fontFace: FONTE, fontSize: 13, fit: 'shrink', valign: 'middle', margin: 0 });

    const area = { x: 0.7, y: 1.0, w: W - 1.4, h: H - 1.0 - 0.72 };

    if (!ehVideo) {
      const img = item.dataUrl;
      const dim = (item.width && item.height) ? { w: item.width, h: item.height } : (dimensoesImagem(img) || { w: 1920, h: 1080 });
      const box = encaixar(dim.w, dim.h, area.x, area.y, area.w, area.h);
      s.addImage({ data: img, ...box });
      s.addShape(pptx.ShapeType.rect, { ...box, fill: { type: 'none' }, line: { color: COR.borda, width: 0.75 } });
      continue;
    }

    // Vídeo embutido
    const dim = (item.width && item.height) ? { w: item.width, h: item.height } : { w: 16, h: 9 };
    const box = encaixar(dim.w, dim.h, area.x, area.y, area.w, area.h - 0.3);
    const ext = path.extname(item.filePath || '').toLowerCase();
    try {
      if (!item.filePath || !fs.existsSync(item.filePath)) throw new Error('arquivo de vídeo não encontrado');
      const opts = { type: 'video', path: item.filePath, ...box };
      if (item.cover) opts.cover = item.cover;
      s.addMedia(opts);
      if (ext !== '.mp4') {
        // PowerPoint pode não tocar WebM: guarda uma cópia ao lado do PPT
        const copia = destino.replace(/\.pptx$/i, ` - vídeo${ext}`);
        fs.copyFileSync(item.filePath, copia);
        s.addText([{ text: 'Se o vídeo não reproduzir, abra o arquivo: ' + path.basename(copia), options: { hyperlink: { url: 'file:///' + copia.replace(/\\/g, '/') } } }],
          { x: area.x, y: box.y + box.h + 0.05, w: area.w, h: 0.3, fontFace: FONTE, fontSize: 10, color: COR.acoEscuro, align: 'center' });
      }
    } catch (e) {
      s.addText(`Não foi possível embutir o vídeo (${e.message}).`, {
        x: area.x, y: area.y + area.h / 2 - 0.3, w: area.w, h: 0.6, align: 'center', fontFace: FONTE, fontSize: 16, color: COR.ardosia
      });
    }
  }

  fs.mkdirSync(saveFolder, { recursive: true });
  await pptx.writeFile({ fileName: destino });
  return destino;
}

module.exports = { generatePPTX };
