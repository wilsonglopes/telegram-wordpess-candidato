'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { query }   = require('./db');
const { gerarMateria } = require('./connectors/ai');
const { publicarWP }   = require('./connectors/wordpress');
const { enviarGrupos } = require('./connectors/evolution');

// Mapa de bots ativos: clienteId → TelegramBot instance
const botsAtivos = new Map();

async function iniciarBots() {
  const { rows } = await query(`SELECT * FROM clientes WHERE ativo = true AND telegram_bot_token IS NOT NULL`);
  for (const cliente of rows) {
    iniciarBot(cliente);
  }
  console.log(`[bot] ${rows.length} bot(s) iniciados`);
}

function iniciarBot(cliente) {
  if (botsAtivos.has(cliente.id)) return;

  const bot = new TelegramBot(cliente.telegram_bot_token, { polling: true });
  botsAtivos.set(cliente.id, bot);

  bot.on('message', async (msg) => {
    try {
      await processarMensagem(bot, cliente, msg);
    } catch (err) {
      console.error(`[bot:${cliente.slug}] Erro:`, err.message);
      bot.sendMessage(msg.chat.id, `❌ Erro ao processar: ${err.message}`).catch(() => {});
    }
  });

  bot.on('polling_error', (err) => console.error(`[bot:${cliente.slug}] Polling error:`, err.message));
  console.log(`[bot] Bot iniciado para: ${cliente.nome}`);
}

async function processarMensagem(bot, cliente, msg) {
  const telegramUserId = msg.from?.id;

  // Verifica se o assessor está autorizado
  const { rows } = await query(
    `SELECT id FROM assessores WHERE cliente_id = $1 AND telegram_user_id = $2 AND ativo = true`,
    [cliente.id, telegramUserId]
  );
  if (rows.length === 0) {
    return bot.sendMessage(msg.chat.id, '⛔ Você não está autorizado. Fale com o administrador.');
  }

  // Extrai conteúdo da mensagem
  let texto = msg.text || msg.caption || '';
  let imagemUrl = null;

  if (msg.photo) {
    // Pega a maior resolução disponível
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileInfo = await bot.getFile(fileId);
    imagemUrl = `https://api.telegram.org/file/bot${cliente.telegram_bot_token}/${fileInfo.file_path}`;
  }

  if (!texto && !imagemUrl) {
    return bot.sendMessage(msg.chat.id, '📝 Envie um texto, foto com legenda ou áudio descrevendo o evento.');
  }

  await bot.sendMessage(msg.chat.id, '⏳ Gerando matéria...');

  // Gera matéria via IA
  const materia = await gerarMateria({ texto, prompt: cliente.ai_prompt });

  // Publica no WordPress
  const post = await publicarWP({
    wp_url:     cliente.wp_url,
    wp_usuario: cliente.wp_usuario,
    wp_senha:   cliente.wp_senha,
    titulo:     materia.titulo,
    corpo:      materia.corpo,
    imagemUrl,
  });

  // Distribui nos grupos de WhatsApp
  await enviarGrupos({
    instancia: cliente.evolution_instancia,
    clienteId: cliente.id,
    titulo:    materia.titulo,
    postUrl:   post.link,
  });

  // Registra publicação
  await query(
    `INSERT INTO publicacoes (cliente_id, titulo, wp_post_url, status) VALUES ($1, $2, $3, 'publicado')`,
    [cliente.id, materia.titulo, post.link]
  );

  await bot.sendMessage(
    msg.chat.id,
    `✅ Publicado!\n\n*${materia.titulo}*\n\n🔗 ${post.link}`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { iniciarBots, iniciarBot };
