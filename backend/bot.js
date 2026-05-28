'use strict';

const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const FormData    = require('form-data');
const { query }   = require('./db');
const { gerarMateria } = require('./connectors/ai');
const { publicarWP }   = require('./connectors/wordpress');
const { enviarGrupos }    = require('./connectors/evolution');
const { distribuirRedes } = require('./connectors/social');
const settings = require('./settings.json');

// Mapa de bots ativos: clienteId → TelegramBot instance
const botsAtivos = new Map();

async function iniciarBots() {
  const { rows } = await query(`SELECT * FROM clientes WHERE ativo = true AND telegram_bot_token IS NOT NULL`);
  for (const cliente of rows) iniciarBot(cliente);
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
      bot.sendMessage(msg.chat.id, `❌ Erro ao processar: ${err.message}`).catch(() => {});
    }
  });

  bot.on('polling_error', (err) => console.error(`[bot:${cliente.slug}] Polling error:`, err.message));
  console.log(`[bot] Bot iniciado: ${cliente.nome}`);
}

function pararBot(clienteId) {
  const bot = botsAtivos.get(clienteId);
  if (!bot) return;
  try { bot.stopPolling(); } catch {}
  botsAtivos.delete(clienteId);
}

async function processarMensagem(bot, cliente, msg) {
  const telegramUserId = msg.from?.id;
  const chatId = msg.chat.id;

  // Verifica autorização
  const { rows } = await query(
    `SELECT id FROM assessores WHERE cliente_id = $1 AND telegram_user_id = $2 AND ativo = true`,
    [cliente.id, telegramUserId]
  );
  if (rows.length === 0) {
    return bot.sendMessage(chatId, '⛔ Você não está autorizado. Fale com o administrador.');
  }

  const texto = msg.text || msg.caption || '';

  // ── COMANDOS ──────────────────────────────────────────────────────────────
  if (texto === '/start' || texto === '/ajuda') {
    return bot.sendMessage(chatId,
      `👋 *Bot de assessoria — ${cliente.nome}*\n\n` +
      `📝 Envie *texto* descrevendo o evento\n` +
      `📸 Envie *foto com legenda* para incluir imagem\n` +
      `🎤 Envie *áudio de voz* (transcrição automática)\n\n` +
      `*Comandos:*\n` +
      `/status — Status da conexão\n` +
      `/grupos — Grupos de distribuição ativos\n` +
      `/ajuda — Esta mensagem`,
      { parse_mode: 'Markdown' }
    );
  }

  if (texto === '/status') return cmdStatus(bot, cliente, chatId);
  if (texto === '/grupos') return cmdGrupos(bot, cliente, chatId);

  // ── ÁUDIO (Whisper) ───────────────────────────────────────────────────────
  if (msg.voice || msg.audio) {
    if (!settings.openai_api_key) {
      return bot.sendMessage(chatId, '🎤 Transcrição de áudio não está configurada. Envie o texto digitado.');
    }
    await bot.sendMessage(chatId, '🎤 Transcrevendo áudio…');
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
    if (!transcricao) return bot.sendMessage(chatId, '❌ Não foi possível transcrever o áudio. Tente enviar o texto.');

    await bot.sendMessage(chatId, `🎤 *Transcrição:*\n${transcricao}`, { parse_mode: 'Markdown' });
    return processarConteudo(bot, cliente, chatId, transcricao, null);
  }

  // ── CONTEÚDO NORMAL ───────────────────────────────────────────────────────
  let imagemUrl = null;
  if (msg.photo) {
    const fileId   = msg.photo[msg.photo.length - 1].file_id;
    const fileInfo = await bot.getFile(fileId);
    imagemUrl = `https://api.telegram.org/file/bot${cliente.telegram_bot_token}/${fileInfo.file_path}`;
  }

  if (!texto && !imagemUrl) {
    return bot.sendMessage(chatId, '📝 Envie texto, foto com legenda ou áudio descrevendo o evento.\nDigite /ajuda para ver os comandos.');
  }

  return processarConteudo(bot, cliente, chatId, texto, imagemUrl);
}

async function processarConteudo(bot, cliente, chatId, texto, imagemUrl) {
  await bot.sendMessage(chatId, '⏳ Gerando matéria…');

  const materia = await gerarMateria({ texto, prompt: cliente.ai_prompt });

  let post;
  let erroWP = null;
  try {
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
      slug:          materia.titulo?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '',
    });
  } catch (err) {
    erroWP = err.message;
    // Salva com status de erro para reprocessamento futuro
    await query(
      `INSERT INTO publicacoes (cliente_id, titulo, status) VALUES ($1, $2, 'erro_wp')`,
      [cliente.id, materia.titulo]
    ).catch(() => {});
    return bot.sendMessage(chatId,
      `⚠️ Matéria gerada mas falhou ao publicar no WordPress.\n\n*Erro:* ${erroWP}\n\n*Título gerado:* ${materia.titulo}`,
      { parse_mode: 'Markdown' }
    );
  }

  const imagemPostada = post.imagemUrl || null;

  // WhatsApp — imagem + resumo + link
  await enviarGrupos({
    instancia: cliente.evolution_instancia,
    clienteId: cliente.id,
    titulo:    materia.titulo,
    resumo:    materia.resumo,
    postUrl:   post.link,
    imagemUrl: imagemPostada,
  });

  // Facebook + Instagram
  const social = await distribuirRedes(cliente, {
    chapeu:    materia.chapeu,
    titulo:    materia.titulo,
    resumo:    materia.resumo,
    postUrl:   post.link,
    imagemUrl: imagemPostada,
  });

  await query(
    `INSERT INTO publicacoes (cliente_id, titulo, wp_post_url, status) VALUES ($1, $2, $3, 'publicado')`,
    [cliente.id, materia.titulo, post.link]
  );

  if (social.facebook_erro)  console.warn(`[bot:${cliente.slug}] FB erro: ${social.facebook_erro}`);
  if (social.instagram_erro) console.warn(`[bot:${cliente.slug}] IG erro: ${social.instagram_erro}`);

  const chapeuTexto = materia.chapeu ? `🏷️ _${materia.chapeu}_\n` : '';
  const canais = ['✅ WordPress', '📱 WhatsApp'];
  if (social.facebook)  canais.push('📘 Facebook');
  if (social.instagram) canais.push('📸 Instagram');

  await bot.sendMessage(chatId,
    `✅ *Publicado em ${canais.length} canal(is)!*\n\n${chapeuTexto}📰 *${materia.titulo}*\n\n🔗 ${post.link}\n\n_${canais.join(' · ')}_`,
    { parse_mode: 'Markdown' }
  );
}

// ── COMANDOS INTERNOS ─────────────────────────────────────────────────────────
async function cmdStatus(bot, cliente, chatId) {
  const { rows: pubs } = await query(
    `SELECT titulo, wp_post_url, criado_em FROM publicacoes WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 3`,
    [cliente.id]
  );
  const { rows: [c] } = await query(`SELECT whatsapp_status FROM clientes WHERE id = $1`, [cliente.id]);
  const waStatus = c?.whatsapp_status || 'desconhecido';
  const waIcon   = waStatus === 'conectado' ? '🟢' : waStatus === 'pendente' ? '🟡' : '🔴';

  let msg = `📊 *Status — ${cliente.nome}*\n\n${waIcon} WhatsApp: ${waStatus}\n\n`;
  if (pubs.length) {
    msg += `📰 *Últimas publicações:*\n`;
    pubs.forEach(p => {
      const data = new Date(p.criado_em).toLocaleDateString('pt-BR');
      msg += `• ${p.titulo || 'Sem título'} (${data})\n`;
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
    return bot.sendMessage(chatId, '📱 Nenhum grupo cadastrado ainda.\nConfigure os grupos no painel admin.');
  }
  const ativos   = rows.filter(g => g.ativo);
  const inativos = rows.filter(g => !g.ativo);
  let msg = `📱 *Grupos de distribuição — ${cliente.nome}*\n\n`;
  if (ativos.length)   msg += `✅ *Ativos (${ativos.length}):*\n` + ativos.map(g => `• ${g.nome}`).join('\n') + '\n\n';
  if (inativos.length) msg += `⏸️ *Pausados (${inativos.length}):*\n` + inativos.map(g => `• ${g.nome}`).join('\n');
  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

// ── RELATÓRIO SEMANAL ─────────────────────────────────────────────────────────
// Chamado a cada hora pelo server.js; dispara apenas segunda-feira às 8h
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
  } catch (err) {
    console.error('[relatorio] Erro:', err.message);
  }
}

module.exports = { iniciarBots, iniciarBot, pararBot, verificarRelatorioSemanal };
