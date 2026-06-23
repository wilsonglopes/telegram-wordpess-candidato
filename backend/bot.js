'use strict';

const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const FormData    = require('form-data');
const fs          = require('fs');
const path        = require('path');
const { query }         = require('./db');
const { gerarMateria, gerarLegendaVideo: gerarLegendaVideoAI } = require('./connectors/ai');
const { publicarWP }    = require('./connectors/wordpress');
const { enviarGrupos, enviarVideoGrupos } = require('./connectors/evolution');
const { distribuirRedes, publicarVideoFacebook, publicarVideoInstagram } = require('./connectors/social');
const { gerarImagemTemplate } = require('./utils/imageTemplate');
const { gerarCardComTemplate } = require('./utils/templateCompositor');
const previewStore = require('./utils/previewStore');
const settings = require('./settings.json');

const CARDS_DIR  = path.join(__dirname, 'cards');
const VIDEOS_DIR = path.join(__dirname, 'videos');
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

// Escapa caracteres especiais do HTML para o parse_mode 'HTML' do Telegram.
// Usado em todo conteúdo dinâmico (título, chapéu, resumo gerados pela IA)
// para evitar erro "can't parse entities".
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const botsAtivos = new Map(); // chave: '_bot' (único bot global)

// ── SESSÕES ────────────────────────────────────────────────────────────────────
// Rascunho por assessor enquanto coleta o material antes de gerar
// chave: `${clienteId}:${telegramUserId}`
const sessoes = new Map();

// Candidato ativo por assessor — persiste durante a vida do processo.
// Necessário quando um assessor presta assessoria a mais de um candidato.
// chave: telegram_user_id (number) → cliente_id (number)
const candidatoAtivo = new Map();

// ── REPLY KEYBOARD (botões no rodapé do chat) ──────────────────────────────────
const BTN_GERAR  = '✨ Gerar matéria';
const BTN_LIMPAR = '🗑️ Limpar rascunho';

const TECLADO_RASCUNHO = {
  keyboard: [[{ text: BTN_GERAR }, { text: BTN_LIMPAR }]],
  resize_keyboard: true,
};

const REMOVER_TECLADO = { remove_keyboard: true };

function chave(clienteId, userId) { return `${clienteId}:${userId}`; }

function getSessao(clienteId, userId) {
  const k = chave(clienteId, userId);
  if (!sessoes.has(k)) {
    sessoes.set(k, {
      textos:    [],      // strings acumuladas
      imagemUrl: null,    // última foto enviada
      stage:     'collecting', // 'collecting' | 'confirming'
      materia:   null,    // { chapeu, titulo, resumo, corpo }
      canais:    { wa: true, fb: true, ig: true },
      msgId:     null,    // id da mensagem de prévia (para editar)
    });
  }
  return sessoes.get(k);
}

function limparSessao(clienteId, userId) {
  sessoes.delete(chave(clienteId, userId));
}

// ── SESSÃO TEMPORÁRIA (antes da seleção do candidato) ──────────────────────────
// Quando assessor tem múltiplos candidatos e ainda não escolheu um, o conteúdo
// (texto/áudio/foto/vídeo) é acumulado aqui. Ao selecionar o candidato, o conteúdo
// é migrado para a sessão definitiva. O candidato só é perguntado no /gerar.
function chaveTmp(userId) { return `tmp:${userId}`; }

function getSessaoTmp(userId) {
  const k = chaveTmp(userId);
  if (!sessoes.has(k)) {
    sessoes.set(k, {
      textos: [], imagemUrl: null, videoUrl: null, videoLocal: null,
      stage: 'collecting', materia: null,
      canais: { wa: true, fb: true, ig: true }, msgId: null,
      pendingAction: null, // ação a executar automaticamente após seleção de candidato
    });
  }
  return sessoes.get(k);
}

function migrarSessaoTemp(userId, clienteId) {
  const tmpKey = chaveTmp(userId);
  if (!sessoes.has(tmpKey)) return;
  const tmp     = sessoes.get(tmpKey);
  const destKey = chave(clienteId, userId);
  if (!sessoes.has(destKey)) {
    sessoes.set(destKey, tmp);
  } else {
    // Sessão definitiva já existe → mescla o conteúdo da temp em vez de descartá-lo,
    // senão textos/foto/vídeo (e o pendingAction='gerar') acumulados se perdem.
    const dest = sessoes.get(destKey);
    if (tmp.textos.length)  dest.textos.push(...tmp.textos);
    if (tmp.imagemUrl)      dest.imagemUrl  = tmp.imagemUrl;
    if (tmp.videoUrl)       dest.videoUrl   = tmp.videoUrl;
    if (tmp.videoLocal)     dest.videoLocal = tmp.videoLocal;
    if (tmp.pendingAction)  dest.pendingAction = tmp.pendingAction;
  }
  sessoes.delete(tmpKey);
}

// ── TECLADO INLINE ─────────────────────────────────────────────────────────────
function teclado(canais, previewUrl, temFoto) {
  const linhas = [
    [
      { text: `${canais.wa ? '✅' : '⬜'} WhatsApp`, callback_data: 'toggle_wa' },
      { text: `${canais.fb ? '✅' : '⬜'} Facebook`,  callback_data: 'toggle_fb' },
      { text: `${canais.ig ? '✅' : '⬜'} Instagram`, callback_data: 'toggle_ig' },
    ],
  ];
  // Linha de ações: prévia web (link) + ver card (se há foto) + corrigir matéria
  const acoes = [];
  if (previewUrl) acoes.push({ text: '👁️ Ver prévia', url: previewUrl });
  if (temFoto)    acoes.push({ text: '🖼️ Ver card', callback_data: 'vercard' });
  acoes.push({ text: '✏️ Corrigir', callback_data: 'corrigir' });
  linhas.push(acoes);
  linhas.push([
    { text: '🚀 Publicar agora', callback_data: 'publicar' },
    { text: '🗑️ Cancelar',       callback_data: 'cancelar' },
  ]);
  return { inline_keyboard: linhas };
}

// Teclado do menu "Corrigir" — escolha do campo a editar manualmente
function tecladoCorrigir() {
  return { inline_keyboard: [
    [{ text: '📰 Título', callback_data: 'edit_titulo' }, { text: '🏷️ Chápeu', callback_data: 'edit_chapeu' }],
    [{ text: '📝 Resumo', callback_data: 'edit_resumo' }, { text: '📄 Corpo',  callback_data: 'edit_corpo'  }],
    [{ text: '⬅️ Voltar', callback_data: 'corrigir_voltar' }],
  ]};
}

function nomeCampo(c) {
  return { titulo: 'Título', chapeu: 'Chápeu', resumo: 'Resumo', corpo: 'Corpo' }[c] || c;
}

// Converte o corpo (HTML com <p>) em texto puro, para exibir ao editar
function corpoParaTexto(html) {
  return String(html || '')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p>/gi, '')
    .trim();
}

// Divide o corpo (HTML) em blocos <p> — cada bloco é um parágrafo (preservado como está)
function corpoBlocos(html) {
  const s = String(html || '').trim();
  const blocos = s.match(/<p[^>]*>[\s\S]*?<\/p>/gi);
  if (blocos && blocos.length) return blocos;
  // fallback: corpo sem <p> → cria um bloco por linha em branco
  return s.split(/\n\s*\n|\n/).map(t => t.trim()).filter(Boolean).map(t => `<p>${esc(t)}</p>`);
}

// Texto puro de um bloco <p> (para exibir ao assessor)
function blocoTexto(bloco) {
  return String(bloco || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}

// Monta a lista numerada dos parágrafos do corpo + teclado de seleção
function montarListaParagrafos(corpo) {
  const blocos = corpoBlocos(corpo);
  if (!blocos.length) {
    return { texto: '📄 O corpo está vazio.', teclado: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'corrigir_voltar' }]] } };
  }
  let texto = '✏️ <b>Corpo — toque no número do parágrafo para editar ou apagar:</b>\n\n';
  blocos.forEach((b, i) => {
    const t = blocoTexto(b);
    texto += `<b>[${i + 1}]</b> ${esc(t.slice(0, 140))}${t.length > 140 ? '…' : ''}\n\n`;
  });
  const btns = blocos.map((_, i) => ({ text: `${i + 1}`, callback_data: `par_${i}` }));
  const linhas = [];
  for (let i = 0; i < btns.length; i += 4) linhas.push(btns.slice(i, i + 4));
  linhas.push([{ text: '⬅️ Voltar', callback_data: 'corrigir_voltar' }]);
  return { texto, teclado: { inline_keyboard: linhas } };
}

// (Re)cria a prévia web efêmera para a matéria atual da sessão e atualiza sessao.previewUrl
function criarPreviewWeb(cliente, sessao) {
  sessao.previewUrl = null;
  try {
    const base = (settings.base_url || '').replace(/\/$/, '');
    if (base && sessao.materia) {
      const token = previewStore.criar({
        chapeu:    sessao.materia.chapeu,
        titulo:    sessao.materia.titulo,
        resumo:    sessao.materia.resumo,
        corpo:     sessao.materia.corpo,
        imagemUrl: sessao.imagemUrl,
        candidato: cliente.nome,
      });
      sessao.previewUrl = `${base}/preview/${token}`;
    }
  } catch {}
}

// Aplica a edição manual de um campo e volta para a prévia atualizada
async function aplicarEdicaoCampo(bot, cliente, chatId, userId, sessao, texto) {
  const campo = sessao.editando;
  if (!sessao.materia) {
    sessao.editando = null;
    return bot.sendMessage(chatId, '⚠️ Nada para corrigir. Gere a matéria primeiro.');
  }
  if (!texto || !texto.trim()) {
    return bot.sendMessage(chatId, '✏️ Envie o novo texto do campo (apenas texto).');
  }

  // Reescrever um parágrafo específico do corpo → volta para a lista de parágrafos
  if (campo && campo.startsWith('corpo_par_')) {
    const n = parseInt(campo.replace('corpo_par_', ''), 10);
    const blocos = corpoBlocos(sessao.materia.corpo);
    if (n >= 0 && n < blocos.length) {
      blocos[n] = `<p>${esc(texto.trim())}</p>`;
      sessao.materia.corpo = blocos.join('');
    }
    sessao.editando = null;
    criarPreviewWeb(cliente, sessao);
    await bot.sendMessage(chatId, `✅ Parágrafo ${n + 1} atualizado.`);
    const lista = montarListaParagrafos(sessao.materia.corpo);
    const m = await bot.sendMessage(chatId, lista.texto, { parse_mode: 'HTML', reply_markup: lista.teclado });
    sessao.msgId = m.message_id;
    return;
  }

  if (campo === 'corpo') {
    const paras = texto.split(/\n\s*\n|\n/).map(p => p.trim()).filter(Boolean);
    sessao.materia.corpo = paras.map(p => `<p>${esc(p)}</p>`).join('');
  } else if (['titulo', 'chapeu', 'resumo'].includes(campo)) {
    sessao.materia[campo] = texto.trim();
  }
  sessao.editando = null;
  criarPreviewWeb(cliente, sessao); // regenera a prévia web com o novo conteúdo

  await bot.sendMessage(chatId, `✅ ${nomeCampo(campo)} atualizado.`);
  const preview = await bot.sendMessage(chatId, textoPrevia(sessao.materia, sessao.canais), {
    parse_mode:   'HTML',
    reply_markup: teclado(sessao.canais, sessao.previewUrl, !!sessao.imagemUrl),
  });
  sessao.msgId = preview.message_id;
}

function textoPrevia(materia, canais) {
  const chapeu = materia.chapeu ? `🏷️ <i>${esc(materia.chapeu)}</i>\n` : '';
  const resumo = materia.resumo ? `\n📝 ${esc(materia.resumo)}\n` : '';
  return (
    `📰 <b>PRÉVIA DA MATÉRIA</b>\n\n` +
    `${chapeu}<b>${esc(materia.titulo)}</b>${resumo}\n` +
    `<b>Publicar em:</b>\n` +
    `${canais.wa ? '✅' : '⬜'} WhatsApp grupos\n` +
    `${canais.fb ? '✅' : '⬜'} Facebook\n` +
    `${canais.ig ? '✅' : '⬜'} Instagram\n\n` +
    `<i>Ative ou desative os canais e clique em 🚀 Publicar</i>`
  );
}

// ── TECLADO E PRÉVIA — VÍDEO ───────────────────────────────────────────────────
// Teclado inline para vídeo: apenas WhatsApp e Facebook (sem WordPress nem Instagram)
function tecladoVideo(canais) {
  return {
    inline_keyboard: [
      [
        { text: `${canais.wa ? '✅' : '⬜'} WhatsApp`, callback_data: 'toggle_wa' },
        { text: `${canais.fb ? '✅' : '⬜'} Facebook`,  callback_data: 'toggle_fb' },
        { text: `${canais.ig ? '✅' : '⬜'} Instagram`, callback_data: 'toggle_ig' },
      ],
      [
        { text: '🚀 Publicar agora', callback_data: 'publicar' },
        { text: '🗑️ Cancelar',       callback_data: 'cancelar' },
      ],
    ],
  };
}

function textoPreviewVideo(sessao) {
  const legenda = sessao.textos.join('\n\n') || '(sem legenda)';
  return (
    `📹 <b>VÍDEO PRONTO PARA DISTRIBUIÇÃO</b>\n\n` +
    `📝 <b>Legenda:</b>\n<i>${esc(legenda.slice(0, 300))}${legenda.length > 300 ? '…' : ''}</i>\n\n` +
    `<b>Publicar em:</b>\n` +
    `${sessao.canais.wa ? '✅' : '⬜'} WhatsApp grupos\n` +
    `${sessao.canais.fb ? '✅' : '⬜'} Facebook\n` +
    `${sessao.canais.ig ? '✅' : '⬜'} Instagram\n\n` +
    `<i>Ative ou desative os canais e clique em 🚀 Publicar</i>`
  );
}

// ── INICIALIZAÇÃO ──────────────────────────────────────────────────────────────

// Resolve qual candidato o assessor está operando agora.
// Retornos possíveis:
//   null                          → não autorizado (nenhum vínculo ativo)
//   { selecionar, candidatos }    → precisa escolher (múltiplos candidatos, nenhum ativo)
//   objeto cliente                → candidato único ou já selecionado
async function resolverCliente(userId) {
  // Se já tem candidato ativo em memória, carrega e retorna
  if (candidatoAtivo.has(userId)) {
    const { rows } = await query(
      `SELECT * FROM clientes WHERE id = $1 AND ativo = true`,
      [candidatoAtivo.get(userId)]
    );
    if (rows[0]) return rows[0];
    // Candidato foi desativado desde a última seleção — limpa e reprocessa
    candidatoAtivo.delete(userId);
  }

  // Busca todos os candidatos vinculados a este assessor
  const { rows } = await query(
    `SELECT a.cliente_id, c.nome FROM assessores a
     JOIN clientes c ON c.id = a.cliente_id
     WHERE a.telegram_user_id = $1 AND a.ativo = true AND c.ativo = true
     ORDER BY c.nome`,
    [userId]
  );

  if (!rows.length) return null; // Não autorizado

  if (rows.length === 1) {
    // Único candidato — registra como ativo automaticamente
    const { rows: cr } = await query(`SELECT * FROM clientes WHERE id = $1`, [rows[0].cliente_id]);
    if (cr[0]) candidatoAtivo.set(userId, cr[0].id);
    return cr[0] || null;
  }

  // Múltiplos candidatos — precisa de seleção explícita
  return { selecionar: true, candidatos: rows };
}

// Exibe menu inline para o assessor escolher com qual candidato vai trabalhar.
function mostrarSelecaoCandidato(bot, chatId, candidatos) {
  return bot.sendMessage(chatId,
    '👥 <b>Você assessora mais de um candidato.</b>\n\nPara qual você está enviando agora?',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: candidatos.map(c => [{
          text: `👤 ${c.nome}`,
          callback_data: `sel_cand_${c.cliente_id}`,
        }]),
      },
    }
  );
}

async function iniciarBots() {
  const token = settings.telegram_bot_token;
  if (!token) {
    console.log('[bot] telegram_bot_token não configurado em settings.json — bot não iniciado');
    return;
  }
  if (botsAtivos.has('_bot')) return;

  const bot = new TelegramBot(token, { polling: true });
  botsAtivos.set('_bot', bot);

  bot.on('message', async (msg) => {
    try { await processarMensagem(bot, msg); }
    catch (err) {
      console.error('[bot] Erro:', err.message);
      bot.sendMessage(msg.chat.id, `❌ Erro: ${err.message}`).catch(() => {});
    }
  });

  bot.on('callback_query', async (cbQuery) => {
    try { await processarCallback(bot, cbQuery); }
    catch (err) {
      console.error('[bot] Callback erro:', err.message);
      bot.answerCallbackQuery(cbQuery.id, { text: '❌ Erro ao processar.' });
    }
  });

  bot.on('polling_error', (err) => console.error('[bot] Polling error:', err.message));
  console.log('[bot] Bot único (AssessorPolítico) iniciado');
}

// Mantidos por compatibilidade com clientes.js — sem efeito com bot único.
function iniciarBot(_cliente) {}
async function pararBot(_clienteId) {}

async function reiniciarBot(novoToken) {
  const bot = botsAtivos.get('_bot');
  if (bot) {
    botsAtivos.delete('_bot');
    try { await bot.stopPolling(); } catch {}
  }
  settings.telegram_bot_token = novoToken;
  if (novoToken) await iniciarBots();
}

// ── PROCESSAMENTO DE MENSAGENS ─────────────────────────────────────────────────
async function processarMensagem(bot, msg) {
  const userId = msg.from?.id;
  const chatId = msg.chat.id;
  const texto  = msg.text || msg.caption || '';

  // /trocar — limpa candidato ativo e força nova seleção
  if (texto === '/trocar') {
    candidatoAtivo.delete(userId);
    const resultado = await resolverCliente(userId);
    if (!resultado) {
      return bot.sendMessage(chatId, '⛔ Você não está autorizado. Fale com o administrador.');
    }
    if (resultado.selecionar) {
      return mostrarSelecaoCandidato(bot, chatId, resultado.candidatos);
    }
    // Assessor tem apenas 1 candidato — não há o que trocar
    return bot.sendMessage(chatId,
      `↩️ Você assessora apenas <b>${esc(resultado.nome)}</b>. Nada para trocar.`,
      { parse_mode: 'HTML' }
    );
  }

  const resultado = await resolverCliente(userId);

  if (!resultado) {
    return bot.sendMessage(chatId, '⛔ Você não está autorizado. Fale com o administrador.');
  }

  // Comandos que precisam do candidato definido para operar
  const CMDS_CANDIDATO = new Set(['/gerar', BTN_GERAR, '/status', '/grupos', '/publicar_video']);

  if (resultado.selecionar) {
    if (CMDS_CANDIDATO.has(texto)) {
      // Marcar ação pendente → executada automaticamente após o assessor escolher o candidato
      if (texto === '/gerar' || texto === BTN_GERAR) {
        getSessaoTmp(userId).pendingAction = 'gerar';
      }
      return mostrarSelecaoCandidato(bot, chatId, resultado.candidatos);
    }
    // Conteúdo (texto/áudio/foto/vídeo): acumula na sessão temporária SEM pedir candidato.
    // O candidato só será pedido quando o assessor apertar /gerar ou ✨ Gerar matéria.
    return acumularConteudo(bot, msg, null, getSessaoTmp(userId), userId, chatId, texto);
  }

  const cliente = resultado;
  migrarSessaoTemp(userId, cliente.id); // traz conteúdo acumulado antes da seleção
  const sessao = getSessao(cliente.id, userId);

  // Edição de campo da prévia em andamento → o texto digitado vira o novo valor.
  // Um comando (/...) cancela a edição e segue o fluxo normal.
  if (sessao.editando) {
    if (texto && texto.startsWith('/')) {
      sessao.editando = null;
    } else {
      return aplicarEdicaoCampo(bot, cliente, chatId, userId, sessao, texto);
    }
  }

  // ── COMANDOS ────────────────────────────────────────────────────
  if (texto === '/start' || texto === '/ajuda') {
    return bot.sendMessage(chatId,
      `👋 <b>Bot de assessoria — ${esc(cliente.nome)}</b>\n\n` +
      `<b>Como usar:</b>\n` +
      `1️⃣ Envie textos, fotos e/ou áudios com o material\n` +
      `2️⃣ Digite /gerar quando terminar\n` +
      `3️⃣ Revise a prévia e escolha os canais\n` +
      `4️⃣ Clique em 🚀 Publicar\n\n` +
      `<b>Comandos:</b>\n` +
      `/gerar — gera a matéria com o material enviado\n` +
      `/publicar_video — distribui o vídeo no rascunho (WA + FB)\n` +
      `/rascunho — vê o que foi acumulado\n` +
      `/limpar — descarta o rascunho atual\n` +
      `/status — status da conexão\n` +
      `/grupos — grupos de WhatsApp ativos\n` +
      `/trocar — trocar de candidato (se assessora mais de um)\n` +
      `/ajuda — esta mensagem`,
      { parse_mode: 'HTML' }
    );
  }

  if (texto === '/status') return cmdStatus(bot, cliente, chatId);
  if (texto === '/grupos') return cmdGrupos(bot, cliente, chatId);

  if (texto === '/limpar' || texto === BTN_LIMPAR) {
    if (sessao.videoLocal) {
      try { fs.unlinkSync(sessao.videoLocal); } catch {}
    }
    limparSessao(cliente.id, userId);
    return bot.sendMessage(chatId, '🗑️ Rascunho descartado. Pode começar de novo.', {
      reply_markup: REMOVER_TECLADO,
    });
  }

  if (texto === '/publicar_video') {
    if (!sessao.videoUrl) {
      return bot.sendMessage(chatId, '⚠️ Nenhum vídeo no rascunho. Envie um vídeo primeiro.');
    }
    sessao.stage = 'confirming';
    const preview = await bot.sendMessage(chatId, textoPreviewVideo(sessao), {
      parse_mode:   'HTML',
      reply_markup: tecladoVideo(sessao.canais),
    });
    sessao.msgId = preview.message_id;
    return;
  }

  if (texto === '/rascunho') {
    if (!sessao.textos.length && !sessao.imagemUrl) {
      return bot.sendMessage(chatId, '📋 Rascunho vazio. Envie textos ou fotos para começar.');
    }
    const resumo =
      `📋 <b>Rascunho atual:</b>\n\n` +
      (sessao.imagemUrl ? `📸 1 foto anexada\n` : '') +
      (sessao.textos.length ? `📝 ${sessao.textos.length} texto(s):\n${esc(sessao.textos.map((t,i) => `${i+1}. ${t.slice(0,80)}…`).join('\n'))}` : '');
    return bot.sendMessage(chatId, resumo, { parse_mode: 'HTML' });
  }

  if (texto === '/gerar' || texto === BTN_GERAR) {
    return gerarMateriaDaSessao(bot, cliente, chatId, userId, sessao);
  }

  return acumularConteudo(bot, msg, cliente, sessao, userId, chatId, texto);
}

// ── ACÚMULO DE CONTEÚDO ────────────────────────────────────────────────────────
// Centraliza o processamento de áudio/foto/vídeo/texto.
// Funciona com ou sem `cliente` (null = sessão temporária, candidato ainda não escolhido).
async function acumularConteudo(bot, msg, cliente, sessao, userId, chatId, texto) {
  const slug = cliente?.slug || `u${userId}`;

  // ── ÁUDIO (Whisper) ────────────────────────────────────────────
  if (msg.voice || msg.audio) {
    if (!settings.openai_api_key) {
      return bot.sendMessage(chatId, '🎤 Transcrição não configurada. Envie o texto digitado.');
    }
    const transcrevendo = await bot.sendMessage(chatId, '🎤 Transcrevendo áudio…');
    try {
      const fileId   = (msg.voice || msg.audio).file_id;
      const fileInfo = await bot.getFile(fileId);
      const audioUrl = `https://api.telegram.org/file/bot${settings.telegram_bot_token}/${fileInfo.file_path}`;
      const audioResp = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const form = new FormData();
      form.append('file', Buffer.from(audioResp.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');
      form.append('language', 'pt');
      const whisper = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { Authorization: `Bearer ${settings.openai_api_key}`, ...form.getHeaders() },
        timeout: 60000,
      });
      const transcricao = whisper.data?.text;
      if (!transcricao) {
        return bot.editMessageText('❌ Não foi possível transcrever.', { chat_id: chatId, message_id: transcrevendo.message_id });
      }
      sessao.textos.push(transcricao);
      bot.deleteMessage(chatId, transcrevendo.message_id).catch(() => {});
      return bot.sendMessage(chatId,
        `🎤 <b>Transcrição adicionada ao rascunho:</b>\n<i>${esc(transcricao)}</i>`,
        { parse_mode: 'HTML', reply_markup: TECLADO_RASCUNHO }
      );
    } catch (err) {
      return bot.editMessageText(`❌ Erro na transcrição: ${err.message}`, { chat_id: chatId, message_id: transcrevendo.message_id });
    }
  }

  // ── VÍDEO ───────────────────────────────────────────────────────
  if (msg.video || msg.video_note) {
    const fileObj = msg.video || msg.video_note;
    const tamanho = fileObj.file_size || 0;

    if (tamanho > 50 * 1024 * 1024) {
      return bot.sendMessage(chatId, '⚠️ Vídeo muito grande (máx 50 MB). Comprima o arquivo e tente novamente.');
    }
    if (sessao.videoUrl) {
      return bot.sendMessage(chatId, '⚠️ Já há um vídeo no rascunho. Use /publicar_video ou /limpar.');
    }

    const baixando = await bot.sendMessage(chatId, '⏳ Baixando vídeo…');
    try {
      const fileInfo  = await bot.getFile(fileObj.file_id);
      const telegramUrl = `https://api.telegram.org/file/bot${settings.telegram_bot_token}/${fileInfo.file_path}`;
      const filename  = `${slug}-${Date.now()}.mp4`;
      const localPath = path.join(VIDEOS_DIR, filename);
      const base      = (settings.base_url || '').replace(/\/$/, '');
      const publicUrl = `${base}/videos/${filename}`;

      const videoResp = await axios.get(telegramUrl, { responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(localPath, Buffer.from(videoResp.data));

      sessao.videoUrl   = publicUrl;
      sessao.videoLocal = localPath;
      const captionTelegram = msg.caption || '';
      if (captionTelegram) sessao.textos.push(captionTelegram);

      await bot.editMessageText(
        `📹 <b>Vídeo recebido!</b> (${(tamanho / 1024 / 1024).toFixed(1)} MB)\n\n` +
        `Envie uma <b>descrição/legenda</b> para gerar com IA, ou clique abaixo para publicar sem legenda.`,
        {
          chat_id: chatId, message_id: baixando.message_id, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '🚀 Publicar sem legenda', callback_data: 'video_publicar' }]] },
        }
      );
    } catch (err) {
      sessao.videoUrl = null; sessao.videoLocal = null;
      await bot.editMessageText(`❌ Erro ao baixar vídeo: ${esc(err.message)}`,
        { chat_id: chatId, message_id: baixando.message_id, parse_mode: 'HTML' });
    }
    return;
  }

  // ── FOTO ────────────────────────────────────────────────────────
  if (msg.photo) {
    const fileId   = msg.photo[msg.photo.length - 1].file_id;
    const fileInfo = await bot.getFile(fileId);
    sessao.imagemUrl = `https://api.telegram.org/file/bot${settings.telegram_bot_token}/${fileInfo.file_path}`;
    if (texto) sessao.textos.push(texto);
    return bot.sendMessage(chatId, `📸 Foto ${texto ? '+ texto ' : ''}adicionada ao rascunho.`, { reply_markup: TECLADO_RASCUNHO });
  }

  // ── TEXTO ───────────────────────────────────────────────────────
  if (texto && !texto.startsWith('/')) {
    sessao.textos.push(texto);
    if (sessao.videoUrl) {
      return bot.sendMessage(chatId, `📝 Descrição recebida. O que deseja fazer?`, {
        reply_markup: { inline_keyboard: [[
          { text: '🤖 Gerar legenda com IA',   callback_data: 'video_gerar'    },
          { text: '🚀 Publicar com esse texto', callback_data: 'video_publicar' },
        ]]},
      });
    }
    return bot.sendMessage(chatId, `📝 Texto adicionado (${sessao.textos.length} texto(s) no rascunho).`, { reply_markup: TECLADO_RASCUNHO });
  }

  // Mensagem não reconhecida
  const temConteudo = sessao.textos.length > 0 || !!sessao.imagemUrl || !!sessao.videoUrl;
  return bot.sendMessage(chatId,
    temConteudo
      ? `📋 Rascunho: ${sessao.textos.length} texto(s)${sessao.imagemUrl ? ' + foto' : ''}.\nToque em ${BTN_GERAR} quando estiver pronto.`
      : '📋 Envie textos, fotos ou áudios para acumular o material.\nUse /ajuda para ver todos os comandos.',
    temConteudo ? { reply_markup: TECLADO_RASCUNHO } : {}
  );
}

// ── GERAÇÃO DA MATÉRIA ─────────────────────────────────────────────────────────
async function gerarMateriaDaSessao(bot, cliente, chatId, userId, sessao) {
  if (!sessao.textos.length && !sessao.imagemUrl) {
    return bot.sendMessage(chatId,
      '⚠️ Rascunho vazio! Envie textos, fotos ou áudios antes de gerar.',
      { reply_markup: REMOVER_TECLADO }
    );
  }

  // Remove o reply keyboard e mostra "Gerando…" ao mesmo tempo
  const gerando = await bot.sendMessage(chatId, '⏳ Gerando matéria com IA…', {
    reply_markup: REMOVER_TECLADO,
  });

  try {
    const textoCompleto = sessao.textos.join('\n\n');
    const materia = await gerarMateria({ texto: textoCompleto, prompt: cliente.ai_prompt });

    sessao.materia = materia;
    sessao.stage   = 'confirming';

    // Cria prévia web efêmera e guarda o link (botão "Ver prévia completa").
    // sessao.previewUrl é reusado nos toggles para o botão não sumir.
    sessao.previewUrl = null;
    try {
      const base = (settings.base_url || '').replace(/\/$/, '');
      if (base) {
        const token = previewStore.criar({
          chapeu:    materia.chapeu,
          titulo:    materia.titulo,
          resumo:    materia.resumo,
          corpo:     materia.corpo,
          imagemUrl: sessao.imagemUrl,
          candidato: cliente.nome,
        });
        sessao.previewUrl = `${base}/preview/${token}`;
      }
    } catch {}

    await bot.deleteMessage(chatId, gerando.message_id).catch(() => {});

    const preview = await bot.sendMessage(chatId, textoPrevia(materia, sessao.canais), {
      parse_mode:   'HTML',
      reply_markup: teclado(sessao.canais, sessao.previewUrl, !!sessao.imagemUrl),
    });
    sessao.msgId = preview.message_id;
  } catch (err) {
    // Edita o "⏳ Gerando…" para mostrar o erro — nunca fica preso na tela
    sessao.stage = 'collecting'; // volta ao estado de coleta
    await bot.editMessageText(
      `❌ Falha ao gerar matéria: ${esc(err.message)}\n\nO rascunho foi mantido. Tente novamente.`,
      { chat_id: chatId, message_id: gerando.message_id }
    ).catch(() => {});
    // Restaura o teclado de rascunho para o assessor tentar de novo
    bot.sendMessage(chatId, '🔄 Use o botão abaixo para tentar novamente.', {
      reply_markup: TECLADO_RASCUNHO,
    }).catch(() => {});
  }
}

// ── CALLBACKS DOS BOTÕES INLINE ────────────────────────────────────────────────
async function processarCallback(bot, cbQuery) {
  const userId = cbQuery.from.id;
  const chatId = cbQuery.message.chat.id;
  const data   = cbQuery.data;

  // Seleção de candidato — tratada ANTES de resolverCliente porque é justamente
  // o callback que define qual candidato ficará ativo em candidatoAtivo.
  if (data.startsWith('sel_cand_')) {
    const clienteId = parseInt(data.replace('sel_cand_', ''), 10);
    // Garante que este assessor realmente está vinculado ao candidato clicado
    const { rows: auth } = await query(
      `SELECT 1 FROM assessores
       WHERE telegram_user_id = $1 AND cliente_id = $2 AND ativo = true`,
      [userId, clienteId]
    );
    if (!auth.length) {
      return bot.answerCallbackQuery(cbQuery.id, { text: '⛔ Não autorizado.' });
    }
    const { rows: cr } = await query(
      `SELECT * FROM clientes WHERE id = $1 AND ativo = true`,
      [clienteId]
    );
    if (!cr[0]) {
      return bot.answerCallbackQuery(cbQuery.id, { text: '❌ Candidato não encontrado.' });
    }
    candidatoAtivo.set(userId, clienteId);
    migrarSessaoTemp(userId, clienteId); // migra conteúdo acumulado antes da seleção

    const sessaoReal = sessoes.get(chave(clienteId, userId));

    // Se havia ação pendente (ex: /gerar), executa automaticamente
    if (sessaoReal?.pendingAction === 'gerar' && (sessaoReal.textos.length || sessaoReal.imagemUrl)) {
      delete sessaoReal.pendingAction;
      await bot.answerCallbackQuery(cbQuery.id, { text: `✅ ${cr[0].nome}` });
      await bot.editMessageText(
        `✅ Trabalhando para <b>${esc(cr[0].nome)}</b>. Gerando matéria…`,
        { chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML' }
      );
      return gerarMateriaDaSessao(bot, cr[0], chatId, userId, sessaoReal);
    }
    if (sessaoReal?.pendingAction) delete sessaoReal.pendingAction;

    await bot.answerCallbackQuery(cbQuery.id, { text: `✅ ${cr[0].nome}` });
    await bot.editMessageText(
      `✅ Trabalhando para <b>${esc(cr[0].nome)}</b>.\n\nAgora envie textos, fotos ou áudios normalmente.\nUse /trocar para mudar de candidato.`,
      { chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML' }
    );
    return;
  }

  const resultado = await resolverCliente(userId);
  if (!resultado) {
    return bot.answerCallbackQuery(cbQuery.id, { text: '⛔ Não autorizado.' });
  }
  if (resultado.selecionar) {
    await bot.answerCallbackQuery(cbQuery.id);
    return mostrarSelecaoCandidato(bot, chatId, resultado.candidatos);
  }

  const cliente = resultado;
  const sessao = getSessao(cliente.id, userId);

  // Para toggles e cancelar: responde imediatamente (operações rápidas)
  // Para publicar: responde imediatamente e executa em background (evita timeout de 30s)
  // Gerar legenda com IA para o vídeo
  if (data === 'video_gerar') {
    await bot.answerCallbackQuery(cbQuery.id);
    if (!sessao.videoUrl) {
      return bot.sendMessage(chatId, '⚠️ Nenhum vídeo no rascunho.');
    }
    if (!sessao.textos.length) {
      return bot.sendMessage(chatId, '⚠️ Envie uma descrição antes de gerar a legenda.');
    }
    return gerarLegendaVideo(bot, cliente, chatId, userId, sessao);
  }

  // Ir direto para a prévia (sem gerar com IA)
  if (data === 'video_publicar') {
    await bot.answerCallbackQuery(cbQuery.id);
    if (!sessao.videoUrl) {
      return bot.sendMessage(chatId, '⚠️ Nenhum vídeo no rascunho.');
    }
    sessao.stage = 'confirming';
    const preview = await bot.sendMessage(chatId, textoPreviewVideo(sessao), {
      parse_mode:   'HTML',
      reply_markup: tecladoVideo(sessao.canais),
    });
    sessao.msgId = preview.message_id;
    return;
  }

  if (data === 'publicar') {
    await bot.answerCallbackQuery(cbQuery.id, { text: '🚀 Publicando…' });
    await bot.editMessageText('⏳ Publicando nos canais selecionados…', {
      chat_id: chatId, message_id: cbQuery.message.message_id,
    });
    // Branch: vídeo ou matéria de texto/foto
    if (sessao.videoUrl) {
      publicarVideo(bot, cliente, chatId, userId, sessao).catch(err => {
        console.error(`[bot:${cliente.slug}] Erro na publicação de vídeo:`, err.message);
        bot.sendMessage(chatId, `❌ Erro inesperado: ${err.message}`).catch(() => {});
      });
    } else {
      publicarEmTodosOsCanais(bot, cliente, chatId, userId, sessao).catch(err => {
        console.error(`[bot:${cliente.slug}] Erro na publicação:`, err.message);
        bot.sendMessage(chatId, `❌ Erro inesperado: ${err.message}`).catch(() => {});
      });
    }
    return;
  }

  // Prévia do card (imagem) antes de publicar — gera sob demanda e envia a foto.
  // Usa a MESMA função da publicação, então o que o assessor vê é o que vai ao ar.
  if (data === 'vercard') {
    await bot.answerCallbackQuery(cbQuery.id, { text: '🖼️ Gerando card…' });
    if (!sessao.materia || !sessao.imagemUrl) {
      return bot.sendMessage(chatId, '⚠️ Não há foto no rascunho para gerar o card.');
    }
    const aviso = await bot.sendMessage(chatId, '⏳ Gerando prévia do card…');
    const buffer = await montarBufferCard(cliente, sessao.materia, sessao.imagemUrl);
    await bot.deleteMessage(chatId, aviso.message_id).catch(() => {});
    if (!buffer) {
      return bot.sendMessage(chatId, '⚠️ Não foi possível gerar o card. Na publicação será usada a foto original.');
    }
    return bot.sendPhoto(chatId, buffer,
      { caption: '🖼️ Prévia do card — é assim que será postado nas redes.' },
      { filename: 'card.jpg', contentType: 'image/jpeg' }
    ).catch(err => {
      bot.sendMessage(chatId, `⚠️ Erro ao enviar o card: ${esc(err.message)}`).catch(() => {});
    });
  }

  await bot.answerCallbackQuery(cbQuery.id);

  if (data === 'cancelar') {
    if (sessao.videoLocal) {
      try { fs.unlinkSync(sessao.videoLocal); } catch {}
    }
    limparSessao(cliente.id, userId);
    await bot.editMessageText('🗑️ Publicação cancelada. Rascunho descartado.', {
      chat_id: chatId, message_id: cbQuery.message.message_id,
    });
    return;
  }

  // ── CORREÇÃO POR CAMPO (antes de publicar) ──
  if (data === 'corrigir') {
    if (!sessao.materia) return;
    await bot.editMessageText('✏️ <b>O que deseja corrigir?</b>\n\nEscolha o campo:', {
      chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML',
      reply_markup: tecladoCorrigir(),
    });
    return;
  }

  if (data === 'corrigir_voltar') {
    sessao.editando = null;
    await bot.editMessageText(textoPrevia(sessao.materia, sessao.canais), {
      chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML',
      reply_markup: teclado(sessao.canais, sessao.previewUrl, !!sessao.imagemUrl),
    });
    return;
  }

  if (data.startsWith('edit_')) {
    const campo = data.replace('edit_', '');
    if (!['titulo', 'chapeu', 'resumo', 'corpo'].includes(campo) || !sessao.materia) return;
    sessao.editando = null;
    if (campo === 'corpo') {
      // Corpo é editado POR PARÁGRAFO — mostra a lista numerada
      const lista = montarListaParagrafos(sessao.materia.corpo);
      await bot.editMessageText(lista.texto, {
        chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML', reply_markup: lista.teclado,
      });
      return;
    }
    sessao.editando = campo;
    const atual = sessao.materia[campo] || '(vazio)';
    await bot.editMessageText(
      `✏️ <b>${nomeCampo(campo)} atual:</b>\n<i>${esc(atual).slice(0, 600)}</i>\n\nEnvie agora o novo texto para substituir:`,
      { chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Cancelar', callback_data: 'corrigir_voltar' }]] } }
    );
    return;
  }

  // Parágrafo do corpo selecionado → JÁ espera o novo texto (digite direto) ou apagar/voltar
  if (/^par_\d+$/.test(data)) {
    if (!sessao.materia) return;
    const n = parseInt(data.replace('par_', ''), 10);
    const blocos = corpoBlocos(sessao.materia.corpo);
    if (n < 0 || n >= blocos.length) return;
    sessao.editando = `corpo_par_${n}`; // qualquer texto digitado agora substitui este parágrafo
    await bot.editMessageText(
      `📄 <b>Parágrafo ${n + 1}:</b>\n<i>${esc(blocoTexto(blocos[n]))}</i>\n\n` +
      `✏️ <b>Envie agora o novo texto</b> para substituir este parágrafo, ou use os botões abaixo:`,
      { chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '🗑️ Apagar parágrafo', callback_data: `pardel_${n}` }],
          [{ text: '⬅️ Voltar', callback_data: 'edit_corpo' }],
        ] } }
    );
    return;
  }

  // Apagar parágrafo → remove e volta para a lista atualizada
  if (/^pardel_\d+$/.test(data)) {
    if (!sessao.materia) return;
    sessao.editando = null;
    const n = parseInt(data.replace('pardel_', ''), 10);
    const blocos = corpoBlocos(sessao.materia.corpo);
    if (n >= 0 && n < blocos.length) {
      blocos.splice(n, 1);
      sessao.materia.corpo = blocos.join('');
      criarPreviewWeb(cliente, sessao);
    }
    const lista = montarListaParagrafos(sessao.materia.corpo);
    await bot.editMessageText(lista.texto, {
      chat_id: chatId, message_id: cbQuery.message.message_id, parse_mode: 'HTML', reply_markup: lista.teclado,
    });
    return;
  }

  if (data.startsWith('toggle_')) {
    const canal = data.replace('toggle_', '');
    sessao.canais[canal] = !sessao.canais[canal];
    // Usa teclado e texto correto para o tipo de conteúdo
    const novoTexto    = sessao.videoUrl ? textoPreviewVideo(sessao) : textoPrevia(sessao.materia, sessao.canais);
    const novoTeclado  = sessao.videoUrl ? tecladoVideo(sessao.canais) : teclado(sessao.canais, sessao.previewUrl, !!sessao.imagemUrl);
    await bot.editMessageText(novoTexto, {
      chat_id:      chatId,
      message_id:   cbQuery.message.message_id,
      parse_mode:   'HTML',
      reply_markup: novoTeclado,
    });
    return;
  }
}

// Gera o buffer do card social (1080x1080) a partir da matéria + foto.
// Reutilizado na prévia (botão "🖼️ Ver card") e na publicação, para o card
// exibido ser EXATAMENTE o mesmo que vai ao ar. Retorna null se não há foto
// ou se a geração falha (a publicação cai para a foto original nesse caso).
async function montarBufferCard(cliente, materia, imagemUrl) {
  if (!imagemUrl) return null;
  try {
    if (cliente.template_config) {
      // Card com moldura própria do candidato (config JSON de zonas)
      const cfg = typeof cliente.template_config === 'string'
        ? JSON.parse(cliente.template_config)
        : cliente.template_config;
      return await gerarCardComTemplate({
        config:    cfg,
        imagemUrl,
        titulo:    materia.titulo,
      });
    }
    // Card padrão (gradiente + chapéu + título + logo)
    return await gerarImagemTemplate({
      imagemUrl,
      chapeu:     materia.chapeu,
      titulo:     materia.titulo,
      logoUrl:    cliente.logo_url || null,
      brandColor: cliente.brand_color || '#f97316',
    });
  } catch (err) {
    console.warn(`[card] Falha ao gerar template: ${err.message} — usando foto original`);
    return null;
  }
}

// ── PUBLICAÇÃO ─────────────────────────────────────────────────────────────────
async function publicarEmTodosOsCanais(bot, clienteCache, chatId, userId, sessao) {
  const { materia, canais, imagemUrl } = sessao;

  // Recarrega o cliente do banco — garante credenciais atualizadas (token FB,
  // chave do plugin, etc.) em vez do snapshot capturado no startup do bot.
  let cliente = clienteCache;
  try {
    const { rows } = await query(`SELECT * FROM clientes WHERE id = $1`, [clienteCache.id]);
    if (rows[0]) cliente = rows[0];
  } catch {}

  // 1. WordPress (sempre)
  let post;
  try {
    const slug = materia.titulo?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '';
    post = await publicarWP({
      wp_url:        cliente.wp_url,
      wp_plugin_key: cliente.wp_plugin_key || null,
      wp_usuario:    cliente.wp_usuario,
      wp_senha:      cliente.wp_senha,
      chapeu:        materia.chapeu,
      titulo:        materia.titulo,
      resumo:        materia.resumo,
      corpo:         materia.corpo,
      imagemUrl,
      slug,
      post_format:   cliente.wp_post_format || 'editorial',
    });
  } catch (err) {
    await query(
      `INSERT INTO publicacoes (cliente_id, titulo, status) VALUES ($1, $2, 'erro_wp')`,
      [cliente.id, materia.titulo]
    ).catch(() => {});
    limparSessao(cliente.id, userId);
    return bot.sendMessage(chatId,
      `⚠️ Falha ao publicar no WordPress.\n\n<b>Erro:</b> ${esc(err.message)}`,
      { parse_mode: 'HTML' }
    );
  }

  const imagemPostada = post.imagemUrl || imagemUrl || null;
  const publicados = ['✅ WordPress'];
  const erros = [];

  // 1.5. Gera o card social (1080x1080 com chapéu + título + logo)
  // WordPress fica com a foto limpa; redes sociais recebem o card brandado.
  let imagemSocial = imagemPostada;
  const querCard = cliente.gerar_card !== false;
  if (querCard && imagemPostada && (canais.wa || canais.fb || canais.ig)) {
    const buffer = await montarBufferCard(cliente, materia, imagemPostada);
    if (buffer) {
      const filename = `${cliente.slug}-${Date.now()}.jpg`;
      fs.writeFileSync(path.join(CARDS_DIR, filename), buffer);
      const base = (settings.base_url || '').replace(/\/$/, '');
      imagemSocial = `${base}/cards/${filename}`;
    }
  }

  // 2. WhatsApp
  if (canais.wa) {
    try {
      await enviarGrupos({
        instancia: cliente.evolution_instancia,
        clienteId: cliente.id,
        chapeu:    materia.chapeu,
        titulo:    materia.titulo,
        resumo:    materia.resumo,
        postUrl:   post.link,
        imagemUrl: imagemSocial,
        slug:      cliente.slug,
        template:  cliente.social_template || 'padrao',
      });
      publicados.push('📱 WhatsApp');
    } catch (err) { erros.push(`WhatsApp: ${err.message}`); }
  }

  // 3. Facebook + Instagram
  if (canais.fb || canais.ig) {
    const clienteAtualizado = { ...cliente };
    if (!canais.fb) clienteAtualizado.fb_page_id = null;
    if (!canais.ig) clienteAtualizado.ig_user_id = null;

    const social = await distribuirRedes(clienteAtualizado, {
      chapeu:    materia.chapeu,
      titulo:    materia.titulo,
      resumo:    materia.resumo,
      postUrl:   post.link,
      imagemUrl: imagemSocial,
    });
    if (social.facebook)       publicados.push('📘 Facebook');
    if (social.instagram)      publicados.push('📸 Instagram');
    if (social.facebook_erro)  erros.push(`Facebook: ${social.facebook_erro}`);
    if (social.instagram_erro) erros.push(`Instagram: ${social.instagram_erro}`);
  }

  // 4. Registra
  await query(
    `INSERT INTO publicacoes (cliente_id, titulo, wp_post_url, status, canal_wp, canal_wa, canal_fb, canal_ig)
     VALUES ($1, $2, $3, 'publicado', true, $4, $5, $6)`,
    [cliente.id, materia.titulo, post.link,
     publicados.includes('📱 WhatsApp'),
     publicados.includes('📘 Facebook'),
     publicados.includes('📸 Instagram')]
  );

  limparSessao(cliente.id, userId);

  const chapeuTexto = materia.chapeu ? `🏷️ <i>${esc(materia.chapeu)}</i>\n` : '';
  const erroTexto = erros.length ? `\n\n⚠️ <i>Erros:</i>\n${esc(erros.map(e => `• ${e}`).join('\n'))}` : '';

  await bot.sendMessage(chatId,
    `✅ <b>Publicado em ${publicados.length} canal(is)!</b>\n\n` +
    `${chapeuTexto}📰 <b>${esc(materia.titulo)}</b>\n\n` +
    `🔗 ${esc(post.link)}\n\n` +
    `<i>${esc(publicados.join(' · '))}</i>${erroTexto}`,
    { parse_mode: 'HTML' }
  );
}

// ── GERAÇÃO DE LEGENDA PARA VÍDEO COM IA ──────────────────────────────────────
async function gerarLegendaVideo(bot, cliente, chatId, userId, sessao) {
  const gerando = await bot.sendMessage(chatId, '🤖 Gerando legenda com IA…');
  try {
    const descricao = sessao.textos.join('\n\n');
    const legenda   = await gerarLegendaVideoAI({ texto: descricao, prompt: cliente.ai_prompt });

    // Substitui a descrição bruta pela legenda gerada
    sessao.textos = [legenda];

    await bot.deleteMessage(chatId, gerando.message_id).catch(() => {});

    sessao.stage = 'confirming';
    const preview = await bot.sendMessage(chatId, textoPreviewVideo(sessao), {
      parse_mode:   'HTML',
      reply_markup: tecladoVideo(sessao.canais),
    });
    sessao.msgId = preview.message_id;
  } catch (err) {
    await bot.editMessageText(
      `❌ Erro ao gerar legenda: ${esc(err.message)}`,
      { chat_id: chatId, message_id: gerando.message_id, parse_mode: 'HTML' }
    );
  }
}

// ── PUBLICAÇÃO DE VÍDEO (WA + FB + IG, sem WordPress) ─────────────────────────
async function publicarVideo(bot, clienteCache, chatId, userId, sessao) {
  const { videoUrl, videoLocal, canais } = sessao;
  const legenda = sessao.textos.join('\n\n') || '';
  const publicados = [];
  const erros      = [];

  // Recarrega cliente para pegar credenciais atualizadas
  let cliente = clienteCache;
  try {
    const { rows } = await query(`SELECT * FROM clientes WHERE id = $1`, [clienteCache.id]);
    if (rows[0]) cliente = rows[0];
  } catch {}

  // 1. WhatsApp
  if (canais.wa) {
    try {
      await enviarVideoGrupos({
        instancia: cliente.evolution_instancia,
        clienteId: cliente.id,
        videoUrl,
        legenda,
      });
      publicados.push('📱 WhatsApp');
    } catch (err) { erros.push(`WhatsApp: ${err.message}`); }
  }

  // 2. Facebook
  if (canais.fb) {
    try {
      await publicarVideoFacebook({
        fb_page_id:      cliente.fb_page_id,
        fb_access_token: cliente.fb_access_token,
        videoUrl,
        legenda,
      });
      publicados.push('📘 Facebook');
    } catch (err) { erros.push(`Facebook: ${err.message}`); }
  }

  // 3. Instagram (Reels) — processamento pode demorar até 90s
  if (canais.ig && cliente.ig_user_id && cliente.fb_access_token) {
    try {
      await publicarVideoInstagram({
        ig_user_id:      cliente.ig_user_id,
        fb_access_token: cliente.fb_access_token,
        videoUrl,
        legenda,
      });
      publicados.push('📸 Instagram');
    } catch (err) { erros.push(`Instagram: ${err.message}`); }
  }

  // Registra no banco
  await query(
    `INSERT INTO publicacoes (cliente_id, titulo, status, canal_wp, canal_wa, canal_fb, canal_ig)
     VALUES ($1, $2, 'publicado', false, $3, $4, $5)`,
    [cliente.id, '📹 Vídeo',
     publicados.includes('📱 WhatsApp'),
     publicados.includes('📘 Facebook'),
     publicados.includes('📸 Instagram')]
  ).catch(() => {});

  // Remove arquivo local — libera espaço no servidor
  if (videoLocal) {
    try { fs.unlinkSync(videoLocal); } catch {}
  }

  limparSessao(cliente.id, userId);

  const erroTexto = erros.length
    ? `\n\n⚠️ <i>Erros:</i>\n${esc(erros.map(e => `• ${e}`).join('\n'))}`
    : '';

  if (!publicados.length) {
    return bot.sendMessage(chatId,
      `❌ <b>Falha ao distribuir o vídeo.</b>\n\n${esc(erros.join('\n'))}`,
      { parse_mode: 'HTML' }
    );
  }

  await bot.sendMessage(chatId,
    `✅ <b>Vídeo distribuído em ${publicados.length} canal(is)!</b>\n\n` +
    `<i>${esc(publicados.join(' · '))}</i>${erroTexto}`,
    { parse_mode: 'HTML' }
  );
}

// ── COMANDOS INTERNOS ──────────────────────────────────────────────────────────
async function cmdStatus(bot, cliente, chatId) {
  const { rows: pubs } = await query(
    `SELECT titulo, wp_post_url, criado_em FROM publicacoes WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 3`,
    [cliente.id]
  );
  const { rows: [c] } = await query(`SELECT whatsapp_status FROM clientes WHERE id = $1`, [cliente.id]);
  const wa = c?.whatsapp_status || 'desconhecido';
  const waIcon = wa === 'conectado' ? '🟢' : wa === 'pendente' ? '🟡' : '🔴';

  let msg = `📊 <b>Status — ${esc(cliente.nome)}</b>\n\n${waIcon} WhatsApp: ${wa}\n\n`;
  if (pubs.length) {
    msg += `📰 <b>Últimas publicações:</b>\n`;
    pubs.forEach(p => {
      msg += `• ${esc(p.titulo || 'Sem título')} (${new Date(p.criado_em).toLocaleDateString('pt-BR')})\n`;
      if (p.wp_post_url) msg += `  🔗 ${esc(p.wp_post_url)}\n`;
    });
  } else {
    msg += `📰 Nenhuma publicação ainda.`;
  }
  bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
}

async function cmdGrupos(bot, cliente, chatId) {
  const { rows } = await query(
    `SELECT nome, ativo FROM grupos_whatsapp WHERE cliente_id = $1 ORDER BY nome`,
    [cliente.id]
  );
  if (!rows.length) {
    return bot.sendMessage(chatId, '📱 Nenhum grupo cadastrado.\nConfigure os grupos no painel admin.');
  }
  const ativos   = rows.filter(g => g.ativo);
  const inativos = rows.filter(g => !g.ativo);
  let msg = `📱 <b>Grupos — ${esc(cliente.nome)}</b>\n\n`;
  if (ativos.length)   msg += `✅ <b>Ativos (${ativos.length}):</b>\n` + esc(ativos.map(g => `• ${g.nome}`).join('\n')) + '\n\n';
  if (inativos.length) msg += `⏸️ <b>Pausados:</b>\n` + esc(inativos.map(g => `• ${g.nome}`).join('\n'));
  bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
}

// ── RELATÓRIO SEMANAL ──────────────────────────────────────────────────────────
async function verificarRelatorioSemanal() {
  const agora = new Date();
  if (agora.getDay() !== 1 || agora.getHours() !== 8) return;
  const bot = botsAtivos.get('_bot');
  if (!bot) return;
  try {
    const { rows: clientes } = await query(`
      SELECT c.id, c.nome,
        (SELECT COUNT(*) FROM publicacoes p
          WHERE p.cliente_id = c.id AND p.status = 'publicado'
            AND p.criado_em > NOW() - INTERVAL '7 days') AS total_semana
      FROM clientes c WHERE c.ativo = true
    `);
    for (const cliente of clientes) {
      const { rows: assessores } = await query(
        `SELECT telegram_user_id FROM assessores WHERE cliente_id = $1 AND ativo = true`,
        [cliente.id]
      );
      if (!assessores.length) continue;
      const total = parseInt(cliente.total_semana) || 0;
      const msg =
        `📊 <b>Relatório Semanal — ${esc(cliente.nome)}</b>\n\n` +
        `📰 <b>${total}</b> matéria${total !== 1 ? 's' : ''} publicada${total !== 1 ? 's' : ''} nos últimos 7 dias.\n\n` +
        `<i>Relatório automático — toda segunda-feira às 8h.</i>`;
      for (const a of assessores) {
        bot.sendMessage(a.telegram_user_id, msg, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  } catch (err) { console.error('[relatorio] Erro:', err.message); }
}

module.exports = { botsAtivos, iniciarBots, iniciarBot, pararBot, reiniciarBot, verificarRelatorioSemanal };
