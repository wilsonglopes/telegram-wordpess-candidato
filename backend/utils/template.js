'use strict';

const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../templates');

/**
 * Carrega um template e substitui as variáveis.
 *
 * @param {string} rede     - 'facebook' | 'instagram' | 'whatsapp'
 * @param {string} nome     - nome do arquivo sem extensão (padrão: 'padrao')
 * @param {object} vars     - { CHAPEU, TITULO, RESUMO, LINK, SLUG_CANDIDATO }
 * @returns {string}
 */
function renderTemplate(rede, nome = 'padrao', vars = {}) {
  const arquivo = path.join(DIR, rede, `${nome}.txt`);

  if (!fs.existsSync(arquivo)) {
    throw new Error(`Template não encontrado: templates/${rede}/${nome}.txt`);
  }

  let texto = fs.readFileSync(arquivo, 'utf-8');

  // Substitui todas as variáveis {{NOME}}
  for (const [chave, valor] of Object.entries(vars)) {
    // Se não tem valor (chapeu vazio, por ex.), remove a linha inteira
    if (!valor) {
      texto = texto.replace(new RegExp(`^.*\\{\\{${chave}\\}\\}.*$\n?`, 'gm'), '');
    } else {
      texto = texto.replace(new RegExp(`\\{\\{${chave}\\}\\}`, 'g'), valor);
    }
  }

  // Remove linhas em branco duplas que sobram quando variáveis são removidas
  texto = texto.replace(/\n{3,}/g, '\n\n').trim();

  return texto;
}

/**
 * Lista os templates disponíveis para uma rede.
 * Útil para o painel admin mostrar opções ao cadastrar cliente.
 */
function listarTemplates(rede) {
  const dir = path.join(DIR, rede);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.txt'))
    .map(f => f.replace('.txt', ''));
}

module.exports = { renderTemplate, listarTemplates };
