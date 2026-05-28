'use strict';

const axios    = require('axios');
const settings = require('../settings.json');

const PROMPT_PADRAO = `Você é um redator de assessoria de imprensa política.
Recebe um briefing e escreve uma matéria jornalística completa.
Responda APENAS com JSON válido no formato: {"titulo": "...", "corpo": "..."}
O corpo deve ser HTML simples com parágrafos <p>. Sem markdown.
Tom: formal, objetivo, jornalístico. Máximo 5 parágrafos.`;

async function gerarMateria({ texto, prompt }) {
  const systemPrompt = prompt || PROMPT_PADRAO;

  if (settings.ai_provider === 'deepseek') {
    return gerarDeepSeek(texto, systemPrompt);
  }
  return gerarOpenAI(texto, systemPrompt);
}

async function gerarDeepSeek(texto, systemPrompt) {
  const r = await axios.post('https://api.deepseek.com/chat/completions', {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: texto },
    ],
    response_format: { type: 'json_object' },
  }, {
    headers: { Authorization: `Bearer ${settings.deepseek_api_key}` },
    timeout: 60000,
  });

  return JSON.parse(r.data.choices[0].message.content);
}

async function gerarOpenAI(texto, systemPrompt) {
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: texto },
    ],
    response_format: { type: 'json_object' },
  }, {
    headers: { Authorization: `Bearer ${settings.openai_api_key}` },
    timeout: 60000,
  });

  return JSON.parse(r.data.choices[0].message.content);
}

module.exports = { gerarMateria };
