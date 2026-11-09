// Testes com FFmpeg de verdade (ffmpeg-static, instalado pelo npm install).
// São pulados se o FFmpeg não estiver disponível.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const video = require('../src/main/video-tools');
const { pastaTemp } = require('./helpers');

const pular = !video.disponivel() && 'FFmpeg não encontrado (rode npm install)';

// gera um vídeo de teste: 1920x1080, 30 fps, 4 s
async function videoTeste(dir) {
  const { spawnSync } = require('child_process');
  const bin = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const saida = path.join(dir, 'teste.mp4');
  const r = spawnSync(bin, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=4', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', saida]);
  assert.equal(r.status, 0, String(r.stderr));
  return saida;
}

test('padronizar() gera MP4 H.264 com a duração correta', { skip: pular }, async t => {
  const dir = pastaTemp(t);
  const v = await video.padronizar(await videoTeste(dir), dir);
  const i = await video.info(v.filePath);
  assert.equal(i.codec, 'h264');
  assert.ok(Math.abs(v.duration - 4) < 0.2, `duração ${v.duration}`);
  assert.match(v.cover, /^data:image\/jpeg;base64,/);
});

test('compactar() limita a 1600 px e reduz o tamanho', { skip: pular }, async t => {
  const dir = pastaTemp(t);
  const orig = await videoTeste(dir);
  const leve = await video.compactar(orig, path.join(dir, 'leve.mp4'));
  const i = await video.info(leve);
  assert.equal(i.largura, 1600);
  assert.equal(i.altura, 900);
  assert.ok(fs.statSync(leve).size < fs.statSync(orig).size);
});

test('editar() recorta, exclui trecho e divide com corte exato', { skip: pular }, async t => {
  const dir = pastaTemp(t);
  const orig = await videoTeste(dir);
  // parte 1: 0–1 s + 2–3 s (trecho 1–2 excluído) | parte 2: 3–4 s
  const partes = await video.editar(orig, [[[0, 1], [2, 3]], [[3, 4]]], dir);
  assert.equal(partes.length, 2);
  assert.ok(Math.abs(partes[0].duration - 2) < 0.15, `parte 1: ${partes[0].duration}`);
  assert.ok(Math.abs(partes[1].duration - 1) < 0.15, `parte 2: ${partes[1].duration}`);
});
