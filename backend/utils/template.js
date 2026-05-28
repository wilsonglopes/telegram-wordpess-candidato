'use strict';

const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../templates');

function renderTemplate(rede, nome = 'padrao', vars = {}) {
  const arquivo = path.join(TEMPLATES_DIR, rede, `${nome}.txt`);

  let texto;
  try {
    texto = fs.readFileSync(arquivo, 'utf-8');
  } catch {
    const padrao = path.join(TEMPLATES_DIR, rede, 'padrao.txt');
    try { texto = fs.readFileSync(padrao, 'utf-8'); }
    catch { return `${vars.TITULO || ''}\n\n${vars.LINK || ''}`; }
  }

  for (const [chave, valor] of Object.entries(vars)) {
    if (!valor) {
      texto = texto.replace(new RegExp(`^.*\{\{${chave}\}\}.*$\n?`, 'gm'), '');
    } else {
      texto = texto.replace(new RegExp(`\{\{${chave}\}\}`, 'g'), String(valor));
    }
  }

  return texto.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { renderTemplate };
