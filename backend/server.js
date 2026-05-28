'use strict';

const express = require('express');
const path    = require('path');
const { migrate, query } = require('./db');
const authRoutes     = require('./routes/auth');
const clientesRoutes = require('./routes/clientes');
const whatsappRoutes = require('./routes/whatsapp');
const { iniciarBots, verificarRelatorioSemanal } = require('./bot');
const { statusConexao } = require('./connectors/evolution');

const settings = require('./settings.json');
const PORT = settings.port || 3003;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/auth',      authRoutes);
app.use('/api/clientes',  clientesRoutes);
app.use('/api/whatsapp',  whatsappRoutes);

// Rota de saúde
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// Serve frontend admin
app.get('/admin*', (_, res) => res.sendFile(path.join(__dirname, '../frontend/admin/index.html')));

// Serve página de conexão QR (sem login)
app.get('/conectar/:token', (_, res) => res.sendFile(path.join(__dirname, '../frontend/conectar/index.html')));

// Redireciona raiz para o painel admin
app.get('/', (_, res) => res.redirect('/admin'));

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
