// Ferramentas de vídeo com FFmpeg: padronizar a gravação e aplicar edições
// (recortar início/fim, excluir trechos e dividir em partes) com corte exato.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function caminhoFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    let p = require('ffmpeg-static');
    // dentro do app empacotado, o binário fica fora do arquivo .asar
    if (p) p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/');
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function disponivel() { return !!caminhoFfmpeg(); }

function executar(args, { saidaBinaria = false } = {}) {
  return new Promise((resolve, reject) => {
    const bin = caminhoFfmpeg();
    if (!bin) return reject(new Error('FFmpeg não encontrado. Rode "npm install" na pasta do projeto.'));
    const proc = spawn(bin, ['-hide_banner', ...args], { windowsHide: true });
    const out = [];
    let err = '';
    proc.stdout.on('data', d => out.push(d));
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => resolve({ code, stderr: err, stdout: saidaBinaria ? Buffer.concat(out) : Buffer.concat(out).toString() }));
  });
}

// Lê duração, tamanho e codec a partir da saída do ffmpeg
async function info(arquivo) {
  const { stderr } = await executar(['-i', arquivo]);
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = stderr.match(/Stream #\S+.*Video:\s*(\w+).*?,\s*(\d{2,5})x(\d{2,5})/);
  return {
    duracao: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : null,
    codec: v ? v[1] : null,
    largura: v ? +v[2] : null,
    altura: v ? +v[3] : null
  };
}

// Algumas gravações (WebM, MP4 fragmentado) não informam a duração; contando os frames resolve
async function duracaoReal(arquivo) {
  const { stderr } = await executar(['-i', arquivo, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  const tempos = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!tempos.length) return null;
  const t = tempos[tempos.length - 1];
  return (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]);
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
const PAR = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'; // H.264 exige largura/altura pares

async function capa(arquivo) {
  const { stdout } = await executar(['-ss', '0.05', '-i', arquivo, '-frames:v', '1', '-vf', 'scale=1280:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', 'pipe:1'], { saidaBinaria: true });
  return stdout && stdout.length ? 'data:image/jpeg;base64,' + stdout.toString('base64') : null;
}

async function descrever(arquivo) {
  const i = await info(arquivo);
  return { filePath: arquivo, duration: i.duracao, width: i.largura, height: i.altura, cover: await capa(arquivo) };
}

// Converte a gravação para MP4 (H.264) com duração e índice corretos,
// o formato que o PowerPoint reproduz e que permite navegar na linha do tempo.
async function padronizar(entrada, pastaSaida) {
  const saida = path.join(pastaSaida, `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`);
  const i = await info(entrada);
  let r;
  if (i.codec === 'h264') r = await executar(['-y', '-i', entrada, '-map', '0:v:0', '-c:v', 'copy', '-movflags', '+faststart', '-an', saida]);
  if (!r || r.code !== 0) r = await executar(['-y', '-i', entrada, '-map', '0:v:0', '-vf', PAR, ...H264, saida]);
  if (r.code !== 0) throw new Error('Falha ao converter o vídeo: ' + r.stderr.split('\n').slice(-3).join(' '));
  return descrever(saida);
}

/**
 * Aplica a edição.
 * @param entrada  caminho do vídeo original (MP4)
 * @param partes   [[ [inicio, fim], [inicio, fim] ], ...]  cada parte vira um vídeo;
 *                 os intervalos de uma parte são emendados (trechos excluídos ficam de fora)
 */
async function editar(entrada, partes, pastaSaida) {
  const resultados = [];
  for (const intervalos of partes) {
    const validos = intervalos.filter(([a, b]) => b - a >= 0.1);
    if (!validos.length) continue;
    const saida = path.join(pastaSaida, `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`);
    const filtros = validos.map(([a, b], k) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${k}]`);
    const juntar = validos.map((_, k) => `[v${k}]`).join('') + `concat=n=${validos.length}:v=1:a=0,${PAR}[out]`;
    const r = await executar(['-y', '-i', entrada, '-filter_complex', [...filtros, juntar].join(';'), '-map', '[out]', ...H264, saida]);
    if (r.code !== 0) throw new Error('Falha ao editar o vídeo: ' + r.stderr.split('\n').slice(-3).join(' '));
    resultados.push(await descrever(saida));
  }
  return resultados;
}

module.exports = { disponivel, info, duracaoReal, padronizar, editar, capa };
