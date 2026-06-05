'use strict';

// Compositor de card com MOLDURA por candidato.
// Modelo de camadas: foto (fundo, cobre o canvas) → moldura PNG (janela transparente
// deixa a foto aparecer) → título (SVG) na zona de texto.
// A config vem de clientes.template_config (JSON). Ver utils/imageTemplate.js para o
// card padrão (usado por quem NÃO tem template_config).

const sharp = require('sharp');
const axios = require('axios');
const path  = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function quebrarTexto(texto, maxChars) {
  const palavras = String(texto || '').split(' ');
  const linhas = [];
  let linha = '';
  for (const p of palavras) {
    if ((linha + ' ' + p).trim().length > maxChars) {
      if (linha) linhas.push(linha.trim());
      linha = p;
    } else {
      linha = (linha + ' ' + p).trim();
    }
  }
  if (linha) linhas.push(linha.trim());
  return linhas;
}

/**
 * Gera o card a partir da moldura do candidato.
 * config = {
 *   template_file: 'nicolau.png',
 *   canvas: { w, h },
 *   foto:   { x, y, w, h },                      // posição/tamanho da foto (cover)
 *   texto:  { x, y, w, h, cor, fonte, align, maxChars } // zona do título
 * }
 */
async function gerarCardComTemplate({ config, imagemUrl, titulo }) {
  const canvas = config.canvas || { w: 1600, h: 1600 };
  const foto   = config.foto   || { x: 0, y: 0, w: canvas.w, h: canvas.h };
  const texto  = config.texto  || {};
  const templatePath = path.join(TEMPLATES_DIR, config.template_file);

  // 1. Foto de fundo (cover na zona definida)
  const imgResp = await axios.get(imagemUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const fotoBuf = await sharp(Buffer.from(imgResp.data))
    .resize(foto.w, foto.h, { fit: 'cover', position: foto.position || 'centre' })
    .toBuffer();

  // 2. Moldura (redimensiona ao canvas por segurança)
  const moldura = await sharp(templatePath)
    .resize(canvas.w, canvas.h, { fit: 'fill' })
    .png()
    .toBuffer();

  // 3. Texto (título) na zona, com alinhamento configurável
  const fonte    = texto.fonte    || 60;
  const maxChars = texto.maxChars || 24;
  const align    = texto.align    || 'left';
  const anchor   = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const tx = align === 'center' ? texto.x + texto.w / 2
           : align === 'right'  ? texto.x + texto.w
           : texto.x;
  const linhas = quebrarTexto(titulo, maxChars);
  const lh     = fonte * 1.18;
  const blocoH = linhas.length * lh;
  const y0     = (texto.y || 0) + ((texto.h || 0) - blocoH) / 2 + fonte * 0.8;
  const tspans = linhas.map((l, i) =>
    `<text x="${tx}" y="${y0 + i * lh}" font-family="'Arial Black', Arial, sans-serif" ` +
    `font-size="${fonte}" font-weight="900" fill="${texto.cor || '#ffffff'}" ` +
    `text-anchor="${anchor}">${esc(l)}</text>`
  ).join('');
  const svg = `<svg width="${canvas.w}" height="${canvas.h}" xmlns="http://www.w3.org/2000/svg">${tspans}</svg>`;

  // 4. Composição: fundo branco → foto → moldura → texto
  const base = sharp({
    create: { width: canvas.w, height: canvas.h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  });
  return base.composite([
    { input: fotoBuf,            left: foto.x || 0, top: foto.y || 0 },
    { input: moldura,            left: 0, top: 0 },
    { input: Buffer.from(svg),   left: 0, top: 0 },
  ]).jpeg({ quality: 90 }).toBuffer();
}

module.exports = { gerarCardComTemplate };
