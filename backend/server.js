'use strict';

const express = require('express');
const path    = require('path');
const { migrate } = require('./db');
const authRoutes     = require('./routes/auth');
const clientesRoutes = require('./routes/clientes');
const whatsappRoutes = require('./routes/whatsapp');
const { iniciarBots } = require('./bot');

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

async function start() {
  await migrate();
  await iniciarBots();
  app.listen(PORT, () => console.log(`[server] Plataforma Candidatos rodando na porta ${PORT}`));
}

start().catch(err => { console.error('[server] Falha ao iniciar:', err); process.exit(1); });
