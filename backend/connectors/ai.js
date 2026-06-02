'use strict';

const axios    = require('axios');
const settings = require('../settings.json');

const PROMPT_PADRAO = `Você é um redator de assessoria de imprensa política.
Recebe um briefing e escreve uma matéria jornalística completa.
Responda APENAS com JSON válido no formato:
{"chapeu": "...", "titulo": "...", "resumo": "...", "corpo": "..."}

Campos:
- chapeu: etiqueta editorial curta em MAIÚSCULAS (2 a 4 palavras). Ex: "POLÍTICA", "CAMPANHA 2026", "SAÚDE PÚBLICA"
- titulo: manchete completa e objetiva
- resumo: 1 a 2 frases resumindo a notícia (usado como subtítulo/lide)
- corpo: HTML com parágrafos <p>. Sem markdown. Mínimo 3, máximo 5 parágrafos.

Tom: formal, objetivo, jornalístico.`;

async function gerarMateria({ texto, prompt }) {
  const systemPrompt = prompt || PROMPT_PADRAO;

  let resultado;
  if (settings.ai_provider === 'deepseek') {
    resultado = await gerarDeepSeek(texto, systemPrompt);
  } else {
    resultado = await gerarOpenAI(texto, systemPrompt);
  }

  // Garante que todos os campos existem
  return {
    chapeu:  resultado.chapeu  || '',
    titulo:  resultado.titulo  || resultado.title  || '',
    resumo:  resultado.resumo  || resultado.summary || '',
    corpo:   resultado.corpo   || resultado.body    || resultado.content || '',
  };
}

// Parser tolerante — lida com blocos markdown e aspas não-escapadas
function parseJsonIA(raw) {
  const limpo = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')  // remove ```json ou ```
    .replace(/\s*```$/, '')
    .trim();

  // Tentativa 1: parse direto
  try { return JSON.parse(limpo); } catch {}

  // Tentativa 2: extrai o primeiro objeto { ... } da string
  const match = limpo.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }

  // Tentativa 3: corrige quebras de linha dentro de strings JSON
  // (causa mais comum do "Expected ',' or '}'" em textos HTML)
  try {
    const corrigido = limpo.replace(
      /"(corpo|body|content)":\s*"([\s\S]*?)(?<!\\)"/g,
      (_, k, v) => `"${k}": "${v.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/(?<!\\)"/g, '\\"')}"`
    );
    const m2 = corrigido.match(/\{[\s\S]*\}/);
    if (m2) return JSON.parse(m2[0]);
  } catch {}

  throw new Error('A IA retornou JSON inválido. Tente novamente em alguns segundos.');
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
  return parseJsonIA(r.data.choices[0].message.content);
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
  return parseJsonIA(r.data.choices[0].message.content);
}

const PROMPT_LEGENDA_VIDEO = `Você é um assessor de comunicação política.
Com base na descrição a seguir, crie uma legenda profissional para publicação em redes sociais.
Retorne APENAS o texto da legenda, sem aspas, sem títulos, sem explicações.
Tom: direto, envolvente, político. Máximo 250 palavras.`;

// Gera legenda de texto simples para vídeo (não JSON — retorna string direta)
async function gerarLegendaVideo({ texto, prompt }) {
  const systemPrompt = prompt
    ? `${prompt}\n\nCrie uma legenda de até 250 palavras para redes sociais com base na descrição do vídeo abaixo. Retorne apenas a legenda.`
    : PROMPT_LEGENDA_VIDEO;

  if (settings.ai_provider === 'deepseek') {
    return _textoDeepSeek(texto, systemPrompt);
  }
  return _textoOpenAI(texto, systemPrompt);
}

async function _textoDeepSeek(texto, systemPrompt) {
  const r = await axios.post('https://api.deepseek.com/chat/completions', {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: texto },
    ],
  }, {
    headers: { Authorization: `Bearer ${settings.deepseek_api_key}` },
    timeout: 60000,
  });
  return (r.data.choices[0].message.content || '').trim();
}

async function _textoOpenAI(texto, systemPrompt) {
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: texto },
    ],
  }, {
    headers: { Authorization: `Bearer ${settings.openai_api_key}` },
    timeout: 60000,
  });
  return (r.data.choices[0].message.content || '').trim();
}

module.exports = { gerarMateria, gerarLegendaVideo };
