'use strict';

const sharp = require('sharp');
const axios = require('axios');

// Quebra texto em linhas respeitando largura máxima de caracteres
function quebrarTexto(texto, maxChars = 30) {
  const palavras = texto.split(' ');
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
  return linhas.slice(0, 4); // máximo 4 linhas
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/**
 * Gera imagem 1080x1080 com template de campanha:
 * - Foto da notícia no topo
 * - Gradiente escuro na base
 * - Badge colorido com chapéu
 * - Título em branco
 * - Logo do candidato (opcional)
 */
async function gerarImagemTemplate({ imagemUrl, chapeu, titulo, logoUrl, brandColor = '#f97316' }) {
  // 1. Baixa a foto da notícia
  const imgResp = await axios.get(imagemUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const fotoBase = await sharp(Buffer.from(imgResp.data))
    .resize(1080, 1080, { fit: 'cover', position: 'top' })
    .jpeg({ quality: 90 })
    .toBuffer();

  // 2. Monta SVG overlay
  const { r, g, b } = hexToRgb(brandColor);
  const linhasTitulo = quebrarTexto(titulo, 28);

  const alturaBadge   = 60;   // altura da faixa do chapéu
  const gapBadgeTitulo = 50;  // respiro entre o chapéu e a 1ª linha do título
  const lineHeight    = 70;   // espaçamento entre linhas do título
  const margemInferior = 56;  // respiro abaixo da última linha

  // baseline da 1ª linha do título, medido a partir do topo do badge (yBase)
  const primeiraBaseline = alturaBadge + gapBadgeTitulo + 50;
  const alturaOverlay = primeiraBaseline + (linhasTitulo.length - 1) * lineHeight + margemInferior;
  const yBase = 1080 - alturaOverlay - 40;
  const larguraBadge = Math.min(chapeu.length * 26 + 48, 600);

  let linhasYSvg = linhasTitulo.map((linha, i) =>
    `<text x="56" y="${yBase + primeiraBaseline + (i * lineHeight)}"
      font-family="'Arial Black', Arial, sans-serif"
      font-size="58" font-weight="900" fill="white"
      text-anchor="start"
      style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8))"
    >${esc(linha)}</text>`
  ).join('\n');

  const svg = `
<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0)" />
      <stop offset="50%" stop-color="rgba(0,0,0,0.6)" />
      <stop offset="100%" stop-color="rgba(${r},${g},${b},0.92)" />
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#g)" />
  ${chapeu ? `
  <rect x="48" y="${yBase}" width="${larguraBadge}" height="${alturaBadge}" fill="rgb(${r},${g},${b})" rx="6"/>
  <text x="72" y="${yBase + 40}"
    font-family="'Arial Black', Arial, sans-serif"
    font-size="28" font-weight="900" fill="white"
    letter-spacing="3">${esc(chapeu.toUpperCase())}</text>
  ` : ''}
  ${linhasYSvg}
</svg>`;

  // 3. Compoe foto + overlay SVG
  const resultado = await sharp(fotoBase)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();

  // 4. Adiciona logo do candidato (canto inferior direito), se disponível
  if (logoUrl) {
    try {
      const logoResp = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 15000 });
      const logoBuffer = await sharp(Buffer.from(logoResp.data))
        .resize(180, 80, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const { width: logoW, height: logoH } = await sharp(logoBuffer).metadata();
      const margin = 40;
      const logoBuf = await sharp(resultado)
        .composite([{ input: logoBuffer, left: 1080 - logoW - margin, top: 1080 - logoH - margin }])
        .jpeg({ quality: 90 })
        .toBuffer();
      return logoBuf;
    } catch {
      // logo opcional — falha silenciosa
    }
  }

  return resultado;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { gerarImagemTemplate };
