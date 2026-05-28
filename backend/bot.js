'use strict';

const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const FormData    = require('form-data');
const fs          = require('fs');
const path        = require('path');
const { query }         = require('./db');
const { gerarMateria }  = require('./connectors/ai');
const { publicarWP }    = require('./connectors/wordpress');
const { enviarGrupos }  = require('./connectors/evolution');
const { distribuirRedes } = require('./connectors/social');
const { gerarImagemTemplate } = require('./utils/imageTemplate');
const settings = require('./settings.json');

const CARDS_DIR = path.join(__dirname, 'cards');

const botsAtivos = new Map();

// ── SESSÕES ────────────────────────────────────────────────────────────────────
// Rascunho por assessor enquanto coleta o material antes de gerar
// chave: `${clienteId}:${telegramUserId}`
const sessoes = new Map();

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

// ── TECLADO INLINE ─────────────────────────────────────────────────────────────
function teclado(canais) {
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

function textoPrevia(materia, canais) {
  const chapeu = materia.chapeu ? `🏷️ _${materia.chapeu}_\n` : '';
  const resumo = materia.resumo ? `\n📝 ${materia.resumo}\n` : '';
  return (
    `📰 *PRÉVIA DA MATÉRIA*\n\n` +
    `${chapeu}*${materia.titulo}*${resumo}\n` +
    `*Publicar em:*\n` +
    `${canais.wa ? '✅' : '⬜'} WhatsApp grupos\n` +
    `${canais.fb ? '✅' : '⬜'} Facebook\n` +
    `${canais.ig ? '✅' : '⬜'} Instagram\n\n` +
    `_Ative ou desative os canais e clique em 🚀 Publicar_`
  );
}

// ── INICIALIZAÇÃO ──────────────────────────────────────────────────────────────
async function iniciarBots() {
  const { rows } = await query(
    `SELECT * FROM clientes WHERE ativo = true AND telegram_bot_token IS NOT NULL`
  );
  for (const c of rows) iniciarBot(c);
  console.log(`[bot] ${rows.length} bot(s) iniciados`);
}

function iniciarBot(cliente) {
  if (botsAtivos.has(cliente.id)) return;

  const bot = new TelegramBot(cliente.telegram_bot_token, { polling: true });
  botsAtivos.set(cliente.id, bot);

  bot.on('message', async (msg) => {
    try { await processarMensagem(bot, cliente, msg); }
    catch (err) {
      console.error(`[bot:${cliente.slug}] Erro:`, err.message);
      bot.sendMessage(msg.chat.id, `❌ Erro: ${err.message}`).catch(() => {});
    }
  });

  bot.on('callback_query', async (query) => {
    try { await processarCallback(bot, cliente, query); }
    catch (err) {
      console.error(`[bot:${cliente.slug}] Callback erro:`, err.message);
      bot.answerCallbackQuery(query.id, { text: '❌ Erro ao processar.' });
    }
  });

  bot.on('polling_error', (err) =>
    console.error(`[bot:${cliente.slug}] Polling error:`, err.message)
  );
  console.log(`[bot] Bot iniciado: ${cliente.nome}`);
}

async function pararBot(clienteId) {
  const bot = botsAtivos.get(clienteId);
  if (!bot) return;
  botsAtivos.delete(clienteId);
  try { await bot.stopPolling(); } catch {}
}

// ── PROCESSAMENTO DE MENSAGENS ─────────────────────────────────────────────────
async function processarMensagem(bot, cliente, msg) {
  const userId = msg.from?.id;
  const chatId = msg.chat.id;

  // Verifica autorização
  const { rows } = await query(
    `SELECT id FROM assessores WHERE cliente_id = $1 AND telegram_user_id = $2 AND ativo = true`,
    [cliente.id, userId]
  );
  if (rows.length === 0) {
    return bot.sendMessage(chatId, '⛔ Você não está autorizado. Fale com o administrador.');
  }

  const texto = msg.text || msg.caption || '';
  const sessao = getSessao(cliente.id, userId);

  // ── COMANDOS ────────────────────────────────────────────────────
  if (texto === '/start' || texto === '/ajuda') {
    return bot.sendMessage(chatId,
      `👋 *Bot de assessoria — ${cliente.nome}*\n\n` +
      `*Como usar:*\n` +
      `1️⃣ Envie textos, fotos e/ou áudios com o material\n` +
      `2️⃣ Digite /gerar quando terminar\n` +
      `3️⃣ Revise a prévia e escolha os canais\n` +
      `4️⃣ Clique em 🚀 Publicar\n\n` +
      `*Comandos:*\n` +
      `/gerar — gera a matéria com o material enviado\n` +
      `/rascunho — vê o que foi acumulado\n` +
      `/limpar — descarta o rascunho atual\n` +
      `/status — status da conexão\n` +
      `/grupos — grupos de WhatsApp ativos\n` +
      `/ajuda — esta mensagem`,
      { parse_mode: 'Markdown' }
    );
  }

  if (texto === '/status') return cmdStatus(bot, cliente, chatId);
  if (texto === '/grupos') return cmdGrupos(bot, cliente, chatId);

  if (texto === '/limpar') {
    limparSessao(cliente.id, userId);
    return bot.sendMessage(chatId, '🗑️ Rascunho descartado. Pode começar de novo.');
  }

  if (texto === '/rascunho') {
    if (!sessao.textos.length && !sessao.imagemUrl) {
      return bot.sendMessage(chatId, '📋 Rascunho vazio. Envie textos ou fotos para começar.');
    }
    const resumo =
      `📋 *Rascunho atual:*\n\n` +
      (sessao.imagemUrl ? `📸 1 foto anexada\n` : '') +
      (sessao.textos.length ? `📝 ${sessao.textos.length} texto(s):\n${sessao.textos.map((t,i) => `${i+1}. ${t.slice(0,80)}…`).join('\n')}` : '');
    return bot.sendMessage(chatId, resumo, { parse_mode: 'Markdown' });
  }

  if (texto === '/gerar') {
    return gerarMateriaDaSessao(bot, cliente, chatId, userId, sessao);
  }

  // ── ÁUDIO (Whisper) ────────────────────────────────────────────
  if (msg.voice || msg.audio) {
    if (!settings.openai_api_key) {
      return bot.sendMessage(chatId, '🎤 Transcrição não configurada. Envie o texto digitado.');
    }
    const transcrevendo = await bot.sendMessage(chatId, '🎤 Transcrevendo áudio…');
    try {
      const fileId   = (msg.voice || msg.audio).file_id;
      const fileInfo = await bot.getFile(fileId);
      const audioUrl = `https://api.telegram.org/file/bot${cliente.telegram_bot_token}/${fileInfo.file_path}`;
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
      if (!transcricao) return bot.editMessageText('❌ Não foi possível transcrever.', { chat_id: chatId, message_id: transcrevendo.message_id });
      sessao.textos.push(transcricao);
      return bot.editMessageText(
        `🎤 *Transcrição adicionada ao rascunho:*\n_${transcricao}_\n\nEnvie mais material ou /gerar para criar a matéria.`,
        { chat_id: chatId, message_id: transcrevendo.message_id, parse_mode: 'Markdown' }
      );
    } catch (err) {
      return bot.editMessageText(`❌ Erro na transcrição: ${err.message}`, { chat_id: chatId, message_id: transcrevendo.message_id });
    }
  }

  // ── FOTO ────────────────────────────────────────────────────────
  if (msg.photo) {
    const fileId   = msg.photo[msg.photo.length - 1].file_id;
    const fileInfo = await bot.getFile(fileId);
    sessao.imagemUrl = `https://api.telegram.org/file/bot${cliente.telegram_bot_token}/${fileInfo.file_path}`;
    if (texto) sessao.textos.push(texto);
    return bot.sendMessage(chatId,
      `📸 Foto ${texto ? '+ texto ' : ''}adicionada ao rascunho.\nEnvie mais material ou /gerar para criar a matéria.`
    );
  }

  // ── TEXTO ───────────────────────────────────────────────────────
  if (texto && !texto.startsWith('/')) {
    sessao.textos.push(texto);
    return bot.sendMessage(chatId,
      `📝 Texto adicionado ao rascunho (${sessao.textos.length} texto(s) acumulado(s)).\nEnvie mais ou /gerar para criar a matéria.`
    );
  }

  // Mensagem não reconhecida
  return bot.sendMessage(chatId,
    '📋 Envie textos, fotos ou áudios para acumular o material.\nDigite /gerar quando quiser criar a matéria.\nUse /ajuda para ver todos os comandos.'
  );
}

// ── GERAÇÃO DA MATÉRIA ─────────────────────────────────────────────────────────
async function gerarMateriaDaSessao(bot, cliente, chatId, userId, sessao) {
  if (!sessao.textos.length && !sessao.imagemUrl) {
    return bot.sendMessage(chatId,
      '⚠️ Rascunho vazio! Envie textos, fotos ou áudios antes de /gerar.'
    );
  }

  sessao.stage = 'confirming';
  const gerando = await bot.sendMessage(chatId, '⏳ Gerando matéria com IA…');

  const textoCompleto = sessao.textos.join('\n\n');
  const materia = await gerarMateria({ texto: textoCompleto, prompt: cliente.ai_prompt });
  sessao.materia = materia;

  await bot.deleteMessage(chatId, gerando.message_id).catch(() => {});

  const preview = await bot.sendMessage(chatId, textoPrevia(materia, sessao.canais), {
    parse_mode:   'Markdown',
    reply_markup: teclado(sessao.canais),
  });
  sessao.msgId = preview.message_id;
}

// ── CALLBACKS DOS BOTÕES INLINE ────────────────────────────────────────────────
async function processarCallback(bot, cliente, cbQuery) {
  const userId = cbQuery.from.id;
  const chatId = cbQuery.message.chat.id;
  const data   = cbQuery.data;
  const sessao = getSessao(cliente.id, userId);

  // Para toggles e cancelar: responde imediatamente (operações rápidas)
  // Para publicar: responde imediatamente e executa em background (evita timeout de 30s)
  if (data === 'publicar') {
    await bot.answerCallbackQuery(cbQuery.id, { text: '🚀 Publicando…' });
    await bot.editMessageText('⏳ Publicando nos canais selecionados…', {
      chat_id: chatId, message_id: cbQuery.message.message_id,
    });
    // Não aguarda — publica em background para não travar o handler do callback
    publicarEmTodosOsCanais(bot, cliente, chatId, userId, sessao).catch(err => {
      console.error(`[bot:${cliente.slug}] Erro na publicação:`, err.message);
      bot.sendMessage(chatId, `❌ Erro inesperado: ${err.message}`).catch(() => {});
    });
    return;
  }

  await bot.answerCallbackQuery(cbQuery.id);

  if (data === 'cancelar') {
    limparSessao(cliente.id, userId);
    await bot.editMessageText('🗑️ Publicação cancelada. Rascunho descartado.', {
      chat_id: chatId, message_id: cbQuery.message.message_id,
    });
    return;
  }

  if (data.startsWith('toggle_')) {
    const canal = data.replace('toggle_', '');
    sessao.canais[canal] = !sessao.canais[canal];
    await bot.editMessageText(textoPrevia(sessao.materia, sessao.canais), {
      chat_id:      chatId,
      message_id:   cbQuery.message.message_id,
      parse_mode:   'Markdown',
      reply_markup: teclado(sessao.canais),
    });
    return;
  }
}

// ── PUBLICAÇÃO ─────────────────────────────────────────────────────────────────
async function publicarEmTodosOsCanais(bot, cliente, chatId, userId, sessao) {
  const { materia, canais, imagemUrl } = sessao;

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
      `⚠️ Falha ao publicar no WordPress.\n\n*Erro:* ${err.message}`,
      { parse_mode: 'Markdown' }
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
    try {
      const buffer = await gerarImagemTemplate({
        imagemUrl:  imagemPostada,
        chapeu:     materia.chapeu,
        titulo:     materia.titulo,
        logoUrl:    cliente.logo_url || null,
        brandColor: cliente.brand_color || '#f97316',
      });
      const filename = `${cliente.slug}-${Date.now()}.jpg`;
      fs.writeFileSync(path.join(CARDS_DIR, filename), buffer);
      const base = (settings.base_url || '').replace(/\/$/, '');
      imagemSocial = `${base}/cards/${filename}`;
    } catch (err) {
      console.warn(`[card] Falha ao gerar template: ${err.message} — usando foto original`);
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
    `INSERT INTO publicacoes (cliente_id, titulo, wp_post_url, status) VALUES ($1, $2, $3, 'publicado')`,
    [cliente.id, materia.titulo, post.link]
  );

  limparSessao(cliente.id, userId);

  const chapeuTexto = materia.chapeu ? `🏷️ _${materia.chapeu}_\n` : '';
  const erroTexto = erros.length ? `\n\n⚠️ _Erros:_\n${erros.map(e => `• ${e}`).join('\n')}` : '';

  await bot.sendMessage(chatId,
    `✅ *Publicado em ${publicados.length} canal(is)!*\n\n` +
    `${chapeuTexto}📰 *${materia.titulo}*\n\n` +
    `🔗 ${post.link}\n\n` +
    `_${publicados.join(' · ')}_${erroTexto}`,
    { parse_mode: 'Markdown' }
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

  let msg = `📊 *Status — ${cliente.nome}*\n\n${waIcon} WhatsApp: ${wa}\n\n`;
  if (pubs.length) {
    msg += `📰 *Últimas publicações:*\n`;
    pubs.forEach(p => {
      msg += `• ${p.titulo || 'Sem título'} (${new Date(p.criado_em).toLocaleDateString('pt-BR')})\n`;
      if (p.wp_post_url) msg += `  🔗 ${p.wp_post_url}\n`;
    });
  } else {
    msg += `📰 Nenhuma publicação ainda.`;
  }
  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
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
  let msg = `📱 *Grupos — ${cliente.nome}*\n\n`;
  if (ativos.length)   msg += `✅ *Ativos (${ativos.length}):*\n` + ativos.map(g => `• ${g.nome}`).join('\n') + '\n\n';
  if (inativos.length) msg += `⏸️ *Pausados:*\n` + inativos.map(g => `• ${g.nome}`).join('\n');
  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

// ── RELATÓRIO SEMANAL ──────────────────────────────────────────────────────────
async function verificarRelatorioSemanal() {
  const agora = new Date();
  if (agora.getDay() !== 1 || agora.getHours() !== 8) return;
  try {
    const { rows: clientes } = await query(`
      SELECT c.id, c.nome,
        (SELECT COUNT(*) FROM publicacoes p
          WHERE p.cliente_id = c.id AND p.status = 'publicado'
            AND p.criado_em > NOW() - INTERVAL '7 days') AS total_semana
      FROM clientes c WHERE c.ativo = true AND c.telegram_bot_token IS NOT NULL
    `);
    for (const cliente of clientes) {
      const bot = botsAtivos.get(cliente.id);
      if (!bot) continue;
      const { rows: assessores } = await query(
        `SELECT telegram_user_id FROM assessores WHERE cliente_id = $1 AND ativo = true`,
        [cliente.id]
      );
      if (!assessores.length) continue;
      const total = parseInt(cliente.total_semana) || 0;
      const msg =
        `📊 *Relatório Semanal — ${cliente.nome}*\n\n` +
        `📰 *${total}* matéria${total !== 1 ? 's' : ''} publicada${total !== 1 ? 's' : ''} nos últimos 7 dias.\n\n` +
        `_Relatório automático — toda segunda-feira às 8h._`;
      for (const a of assessores) {
        bot.sendMessage(a.telegram_user_id, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }
    }
  } catch (err) { console.error('[relatorio] Erro:', err.message); }
}

module.exports = { iniciarBots, iniciarBot, pararBot, verificarRelatorioSemanal };
