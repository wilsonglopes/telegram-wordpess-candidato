'use strict';

// Página pública de PRÉVIA da matéria (link efêmero, sem login).
// Renderiza a matéria como será publicada, para o assessor conferir antes de publicar.

const express = require('express');
const router  = express.Router();
const { obter } = require('../utils/previewStore');

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paginaExpirada() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prévia expirada</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff;color:#1a1a1a;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}
.box{max-width:420px}.ico{font-size:48px}h1{font-size:1.3rem;margin:.6rem 0}p{color:#666;line-height:1.6}</style>
</head><body><div class="box"><div class="ico">⌛</div>
<h1>Prévia expirada</h1>
<p>Este link de prévia não está mais disponível (validade de 30 minutos).<br>
Gere a matéria novamente no bot para abrir uma nova prévia.</p></div></body></html>`;
}

function paginaMateria(d) {
  // chapeu/titulo/resumo são texto puro → escapados.
  // corpo é HTML gerado pela IA (parágrafos <p>) → inserido como HTML para fidelidade.
  const chapeu = d.chapeu ? `<div class="chapeu">${esc(d.chapeu)}</div>` : '';
  const resumo = d.resumo ? `<p class="resumo">${esc(d.resumo)}</p>` : '';
  const imagem = d.imagemUrl ? `<img class="capa" src="${esc(d.imagemUrl)}" alt="">` : '';
  const candidato = d.candidato ? esc(d.candidato) : '';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prévia — ${esc(d.titulo || 'Matéria')}</title>
<style>
  :root{--ink:#16181d;--muted:#6b7280;--line:#e5e7eb;--accent:#0A84FF}
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:#f6f7f9;color:var(--ink);margin:0;line-height:1.65}
  .aviso{background:#fff8e1;color:#8a6d00;text-align:center;padding:10px 16px;
    font-size:.85rem;border-bottom:1px solid #f0e2b0}
  .wrap{max-width:680px;margin:0 auto;padding:32px 22px 64px}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;
    padding:34px 34px 40px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .chapeu{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.08em;
    text-transform:uppercase;color:var(--accent);margin-bottom:12px}
  h1{font-size:1.85rem;line-height:1.25;margin:0 0 14px;font-weight:800;letter-spacing:-.01em}
  .resumo{font-size:1.12rem;color:#374151;font-weight:500;margin:0 0 22px}
  .capa{width:100%;height:auto;border-radius:10px;margin:6px 0 26px;display:block}
  .corpo{font-size:1.06rem;color:#23262d}
  .corpo p{margin:0 0 1.05rem}
  .rodape{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);
    font-size:.8rem;color:var(--muted);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  @media (max-width:560px){.card{padding:24px 20px 30px}h1{font-size:1.5rem}}
</style>
</head><body>
  <div class="aviso">👁️ Pré-visualização — esta matéria <strong>ainda não foi publicada</strong>.</div>
  <div class="wrap">
    <article class="card">
      ${chapeu}
      <h1>${esc(d.titulo || '')}</h1>
      ${resumo}
      ${imagem}
      <div class="corpo">${d.corpo || ''}</div>
      <div class="rodape">
        <span>${candidato ? 'Candidato: ' + candidato : ''}</span>
        <span>Prévia gerada automaticamente</span>
      </div>
    </article>
  </div>
</body></html>`;
}

router.get('/:token', (req, res) => {
  const dados = obter(req.params.token);
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (!dados) return res.status(404).send(paginaExpirada());
  res.send(paginaMateria(dados));
});

module.exports = router;
