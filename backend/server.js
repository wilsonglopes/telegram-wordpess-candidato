'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { migrate, query } = require('./db');
const authRoutes     = require('./routes/auth');
const { authMiddleware } = require('./routes/auth');
const clientesRoutes = require('./routes/clientes');
const whatsappRoutes = require('./routes/whatsapp');
const meRoutes         = require('./routes/me');
const dashboardRoutes  = require('./routes/dashboard');
const financeiroRoutes = require('./routes/financeiro');
const { iniciarBots, reiniciarBot, verificarRelatorioSemanal } = require('./bot');
const { statusConexao } = require('./connectors/evolution');

const settings = require('./settings.json');
const PORT = settings.port || 3003;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
// Cards sociais gerados (acessíveis publicamente para FB/IG/WhatsApp)
app.use('/cards',  express.static(path.join(__dirname, 'cards')));
// Vídeos recebidos do Telegram e distribuídos para FB/WhatsApp
app.use('/videos', express.static(path.join(__dirname, 'videos')));

app.use('/api/auth',      authRoutes);
app.use('/api/clientes',  clientesRoutes);
app.use('/api/whatsapp',  whatsappRoutes);
app.use('/api/me',          meRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/financeiro',  financeiroRoutes);

// Rota de saúde
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// Token global do bot — leitura e atualização (admin-only)
app.get('/api/config/bot-token', authMiddleware, (_, res) => {
  res.json({ token: settings.telegram_bot_token || '' });
});

app.patch('/api/config/bot-token', authMiddleware, async (req, res) => {
  const { token } = req.body;
  if (token === undefined) return res.status(400).json({ erro: 'Campo token obrigatório' });

  const SETTINGS_PATH = path.join(__dirname, 'settings.json');
  try {
    const atual = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    atual.telegram_bot_token = token || '';
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(atual, null, 2));
    await reiniciarBot(token || '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Serve frontend admin
app.get('/admin*', (_, res) => res.sendFile(path.join(__dirname, '../frontend/admin/index.html')));

// Serve painel do usuário (SPA — cobre sub-rotas além de /painel/index.html)
app.get('/painel*', (_, res) => res.sendFile(path.join(__dirname, '../frontend/painel/index.html')));

// Serve página de conexão QR (sem login)
app.get('/conectar/:token', (_, res) => res.sendFile(path.join(__dirname, '../frontend/conectar/index.html')));

// Landing page de vendas
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

async function monitorarWhatsApp() {
  try {
    const { rows } = await query(`SELECT id, evolution_instancia FROM clientes WHERE ativo = true AND evolution_instancia IS NOT NULL`);
    for (const c of rows) {
      try {
        const state = await statusConexao(c.evolution_instancia);
        const novoStatus = state === 'open' ? 'conectado' : state === 'connecting' ? 'pendente' : 'desconectado';
        await query(`UPDATE clientes SET whatsapp_status = $1 WHERE id = $2 AND whatsapp_status != $1`, [novoStatus, c.id]);
      } catch {}
    }
  } catch (err) {
    console.error('[monitor-wa] Erro:', err.message);
  }
}

async function start() {
  await migrate();
  await iniciarBots();
  app.listen(PORT, () => console.log(`[server] Plataforma Candidatos rodando na porta ${PORT}`));
  // Monitoramento de status WhatsApp a cada 5 minutos
  setInterval(monitorarWhatsApp, 5 * 60 * 1000);
  // Relatório semanal: verifica a cada hora se é segunda às 8h
  setInterval(verificarRelatorioSemanal, 60 * 60 * 1000);
}

start().catch(err => { console.error('[server] Falha ao iniciar:', err); process.exit(1); });
