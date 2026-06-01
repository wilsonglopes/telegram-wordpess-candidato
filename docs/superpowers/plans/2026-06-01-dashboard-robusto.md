# Dashboard Robusto — Plataforma Candidatos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o painel admin de uma lista simples em um dashboard executivo com KPIs, gráficos, controle financeiro e alertas operacionais.

**Architecture:** Três abas no admin (Dashboard / Candidatos / Financeiro). Novos endpoints REST em `routes/dashboard.js` e `routes/financeiro.js`. Duas novas tabelas no banco. Chart.js via CDN para gráficos inline.

**Tech Stack:** Node.js + Express, PostgreSQL, HTML/CSS/JS puro, Chart.js 4.x (CDN)

---

## Resultado visual esperado

```
╔══════════════════════════════════════════════════════════╗
║  🗳️ Plataforma Candidatos      [📊 Dashboard] [👥 Candidatos] [💰 Financeiro]  ⚙️ Sair ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   ║
║  │🟢 Bot    │ │👥 3      │ │📰 47     │ │💰R$2.100 │   ║
║  │  Online  │ │ Ativos   │ │ Pub/mês  │ │  MRR     │   ║
║  └──────────┘ └──────────┘ └──────────┘ └──────────┘   ║
║                                                          ║
║  ┌─ Publicações (30 dias) ──────┐ ┌─ Por canal ───────┐ ║
║  │  ▁▃▅▇▅▃▁▅▇▆▅▄▃▂▁▅▇         │ │   ○ WP   42%      │ ║
║  │  [line chart]                │ │   ○ WA   31%      │ ║
║  └──────────────────────────────┘ │   ○ FB   15%  🍩  │ ║
║                                   │   ○ IG   12%      │ ║
║  ┌─ Ranking ────────────────────┐ └───────────────────┘ ║
║  │ 1. Nicolau Jr  ████████ 23   │                       ║
║  │ 2. Maria Silva ████     11   │ ┌─ Alertas ─────────┐ ║
║  │ 3. João Costa  ██        5   │ │ 🔴 WA desconectado│ ║
║  └──────────────────────────────┘ │ ⚠️ FB token 3d    │ ║
║                                   │ 💸 1 inadimplente │ ║
║                                   └───────────────────┘ ║
╚══════════════════════════════════════════════════════════╝
```

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/db.js` | Modificar | Adicionar migrations: `financeiro`, `pagamentos`, colunas de canais em `publicacoes` |
| `backend/routes/dashboard.js` | Criar | KPIs, gráficos, alertas |
| `backend/routes/financeiro.js` | Criar | CRUD financeiro + exportação CSV |
| `backend/server.js` | Modificar | Registrar novas rotas |
| `frontend/admin/index.html` | Modificar | Fix modal, tabs de nível superior, Dashboard tab, Financeiro tab |

---

## Task 1 — Fix: modal de configurações mal posicionado

**Arquivos:** `frontend/admin/index.html`

O modal `#configOverlay` usa a classe `.drawer` que no design-system.css posiciona elementos na base da tela (estilo bottom-sheet mobile). Para o modal de configurações, que é pequeno e deve aparecer centralizado, basta sobrescrever o alinhamento do overlay.

- [ ] **1.1** Localizar o `<div class="overlay" id="configOverlay">` no HTML

- [ ] **1.2** Adicionar estilo inline `align-items:center` ao overlay do config:

```html
<div class="overlay" id="configOverlay"
     style="align-items:center"
     onclick="if(event.target===this)fecharConfig()">
```

- [ ] **1.3** Testar abrindo `⚙️` no painel — modal deve aparecer no centro da tela

- [ ] **1.4** Commit:
```bash
git add frontend/admin/index.html
git commit -m "fix: modal configuracoes centralizado na tela"
```

---

## Task 2 — DB: novas tabelas + coluna de canais em publicações

**Arquivos:** `backend/db.js`

### Schema novo

```sql
-- Registro financeiro 1:1 com cliente
CREATE TABLE IF NOT EXISTS financeiro (
  id              SERIAL PRIMARY KEY,
  cliente_id      INTEGER UNIQUE NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  plano           TEXT NOT NULL DEFAULT 'basico',     -- basico | profissional | premium
  valor           DECIMAL(10,2) NOT NULL DEFAULT 0,
  vencimento_dia  INTEGER NOT NULL DEFAULT 10,        -- dia do mês (1-28)
  status          TEXT NOT NULL DEFAULT 'trial',      -- trial | ativo | inadimplente | cancelado | suspenso
  forma_pagamento TEXT,                               -- pix | boleto | cartao | transferencia
  observacoes     TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Histórico de pagamentos
CREATE TABLE IF NOT EXISTS pagamentos (
  id              SERIAL PRIMARY KEY,
  cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  valor           DECIMAL(10,2) NOT NULL,
  data_pagamento  DATE NOT NULL DEFAULT CURRENT_DATE,
  referencia      TEXT,   -- ex: "Jun/2026"
  status          TEXT NOT NULL DEFAULT 'pago',  -- pago | estornado
  observacoes     TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Canais publicados por publicação
ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_wp  BOOLEAN DEFAULT true;
ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_wa  BOOLEAN DEFAULT false;
ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_fb  BOOLEAN DEFAULT false;
ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_ig  BOOLEAN DEFAULT false;
```

- [ ] **2.1** Abrir `backend/db.js` e localizar o bloco de `ALTER TABLE` no final de `migrate()`

- [ ] **2.2** Adicionar ao final de `migrate()`, após os ALTERs existentes:

```js
// Tabela financeira
await query(`
  CREATE TABLE IF NOT EXISTS financeiro (
    id              SERIAL PRIMARY KEY,
    cliente_id      INTEGER UNIQUE NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    plano           TEXT NOT NULL DEFAULT 'basico',
    valor           DECIMAL(10,2) NOT NULL DEFAULT 0,
    vencimento_dia  INTEGER NOT NULL DEFAULT 10,
    status          TEXT NOT NULL DEFAULT 'trial',
    forma_pagamento TEXT,
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

await query(`
  CREATE TABLE IF NOT EXISTS pagamentos (
    id              SERIAL PRIMARY KEY,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    valor           DECIMAL(10,2) NOT NULL,
    data_pagamento  DATE NOT NULL DEFAULT CURRENT_DATE,
    referencia      TEXT,
    status          TEXT NOT NULL DEFAULT 'pago',
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

// Registra em quais canais cada publicação foi distribuída
await query(`ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_wp BOOLEAN DEFAULT true`);
await query(`ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_wa BOOLEAN DEFAULT false`);
await query(`ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_fb BOOLEAN DEFAULT false`);
await query(`ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS canal_ig BOOLEAN DEFAULT false`);
```

- [ ] **2.3** Verificar que `migrate()` é idempotente (todos os comandos usam `IF NOT EXISTS` / `IF NOT EXISTS`) ✅

- [ ] **2.4** Commit:
```bash
git add backend/db.js
git commit -m "feat: tabelas financeiro e pagamentos + colunas de canais em publicacoes"
```

---

## Task 3 — Registrar canais no bot ao publicar

**Arquivos:** `backend/bot.js`

O INSERT em `publicacoes` atualmente não registra quais canais foram usados. Precisamos passar os canais para o INSERT.

- [ ] **3.1** Localizar em `publicarEmTodosOsCanais` o INSERT final:

```js
await query(
  `INSERT INTO publicacoes (cliente_id, titulo, wp_post_url, status) VALUES ($1, $2, $3, 'publicado')`,
  [cliente.id, materia.titulo, post.link]
);
```

- [ ] **3.2** Substituir por:

```js
await query(
  `INSERT INTO publicacoes (cliente_id, titulo, wp_post_url, status, canal_wp, canal_wa, canal_fb, canal_ig)
   VALUES ($1, $2, $3, 'publicado', true, $4, $5, $6)`,
  [cliente.id, materia.titulo, post.link,
   canais.wa && publicados.includes('📱 WhatsApp'),
   canais.fb && publicados.includes('📘 Facebook'),
   canais.ig && publicados.includes('📸 Instagram')]
);
```

- [ ] **3.3** Commit:
```bash
git add backend/bot.js
git commit -m "feat: registrar canais usados em cada publicacao"
```

---

## Task 4 — Backend: routes/dashboard.js

**Arquivo:** `backend/routes/dashboard.js` (criar)

Três endpoints, todos admin-only:

### `GET /api/dashboard/kpis`
Retorna:
```json
{
  "bot_online": true,
  "candidatos_ativos": 3,
  "publicacoes_hoje": 2,
  "publicacoes_semana": 11,
  "publicacoes_mes": 47,
  "total_assessores": 5,
  "mrr": 2100.00,
  "inadimplentes": 1
}
```

### `GET /api/dashboard/graficos`
Retorna:
```json
{
  "por_dia": [
    { "data": "2026-05-01", "total": 3 },
    ...
  ],
  "por_canal": {
    "wp": 120, "wa": 89, "fb": 44, "ig": 38
  },
  "ranking": [
    { "nome": "Nicolau Jr", "total": 23 },
    ...
  ]
}
```

### `GET /api/dashboard/alertas`
Retorna:
```json
[
  { "tipo": "wa_desconectado", "nivel": "erro", "candidato": "Nicolau Jr", "cliente_id": 1 },
  { "tipo": "fb_token_ausente", "nivel": "aviso", "candidato": "Maria Silva", "cliente_id": 2 },
  { "tipo": "inadimplente",    "nivel": "aviso", "candidato": "João Costa",  "cliente_id": 3 },
  { "tipo": "sem_publicacoes", "nivel": "info",  "candidato": "Pedro Lima",  "cliente_id": 4 }
]
```

- [ ] **4.1** Criar `backend/routes/dashboard.js`:

```js
'use strict';

const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('./auth');
const { botsAtivos } = require('../bot'); // exportar botsAtivos em bot.js (ver 4.0)

const router = express.Router();
router.use(authMiddleware);

// KPIs
router.get('/kpis', async (req, res) => {
  try {
    const [ativos, pubHoje, pubSemana, pubMes, assessores, fin] = await Promise.all([
      query(`SELECT COUNT(*) FROM clientes WHERE ativo = true`),
      query(`SELECT COUNT(*) FROM publicacoes WHERE status='publicado' AND criado_em >= CURRENT_DATE`),
      query(`SELECT COUNT(*) FROM publicacoes WHERE status='publicado' AND criado_em >= NOW() - INTERVAL '7 days'`),
      query(`SELECT COUNT(*) FROM publicacoes WHERE status='publicado' AND criado_em >= date_trunc('month', NOW())`),
      query(`SELECT COUNT(*) FROM assessores WHERE ativo = true`),
      query(`SELECT COALESCE(SUM(valor),0) AS mrr, COUNT(*) FILTER (WHERE status='inadimplente') AS inadimplentes FROM financeiro`),
    ]);

    res.json({
      bot_online:          !!require('../bot').botsAtivos?.get('_bot'),
      candidatos_ativos:   parseInt(ativos.rows[0].count),
      publicacoes_hoje:    parseInt(pubHoje.rows[0].count),
      publicacoes_semana:  parseInt(pubSemana.rows[0].count),
      publicacoes_mes:     parseInt(pubMes.rows[0].count),
      total_assessores:    parseInt(assessores.rows[0].count),
      mrr:                 parseFloat(fin.rows[0].mrr),
      inadimplentes:       parseInt(fin.rows[0].inadimplentes),
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Gráficos
router.get('/graficos', async (req, res) => {
  try {
    const [porDia, porCanal, ranking] = await Promise.all([
      query(`
        SELECT DATE(criado_em) AS data, COUNT(*) AS total
        FROM publicacoes WHERE status='publicado' AND criado_em >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(criado_em) ORDER BY data
      `),
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN canal_wp THEN 1 END), 0) AS wp,
          COALESCE(SUM(CASE WHEN canal_wa THEN 1 END), 0) AS wa,
          COALESCE(SUM(CASE WHEN canal_fb THEN 1 END), 0) AS fb,
          COALESCE(SUM(CASE WHEN canal_ig THEN 1 END), 0) AS ig
        FROM publicacoes WHERE status='publicado'
      `),
      query(`
        SELECT c.nome, COUNT(p.id) AS total
        FROM clientes c
        LEFT JOIN publicacoes p ON p.cliente_id = c.id AND p.status='publicado'
          AND p.criado_em >= NOW() - INTERVAL '30 days'
        WHERE c.ativo = true
        GROUP BY c.id, c.nome ORDER BY total DESC LIMIT 10
      `),
    ]);

    res.json({
      por_dia:  porDia.rows.map(r => ({ data: r.data, total: parseInt(r.total) })),
      por_canal: { wp: parseInt(porCanal.rows[0].wp), wa: parseInt(porCanal.rows[0].wa),
                   fb: parseInt(porCanal.rows[0].fb), ig: parseInt(porCanal.rows[0].ig) },
      ranking:  ranking.rows.map(r => ({ nome: r.nome, total: parseInt(r.total) })),
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Alertas
router.get('/alertas', async (req, res) => {
  try {
    const alertas = [];

    // WhatsApp desconectado
    const { rows: waDesc } = await query(
      `SELECT id, nome FROM clientes WHERE ativo=true AND whatsapp_status != 'conectado'`
    );
    waDesc.forEach(c => alertas.push({
      tipo: 'wa_desconectado', nivel: 'erro',
      candidato: c.nome, cliente_id: c.id,
      mensagem: 'WhatsApp desconectado'
    }));

    // Facebook sem token
    const { rows: semFb } = await query(
      `SELECT id, nome FROM clientes WHERE ativo=true AND (fb_access_token IS NULL OR fb_access_token = '')`
    );
    semFb.forEach(c => alertas.push({
      tipo: 'fb_token_ausente', nivel: 'aviso',
      candidato: c.nome, cliente_id: c.id,
      mensagem: 'Token do Facebook não configurado'
    }));

    // Inadimplentes
    const { rows: inadimp } = await query(
      `SELECT c.id, c.nome FROM clientes c
       JOIN financeiro f ON f.cliente_id = c.id
       WHERE c.ativo=true AND f.status='inadimplente'`
    );
    inadimp.forEach(c => alertas.push({
      tipo: 'inadimplente', nivel: 'aviso',
      candidato: c.nome, cliente_id: c.id,
      mensagem: 'Pagamento em atraso'
    }));

    // Sem publicações nos últimos 7 dias
    const { rows: inativos } = await query(
      `SELECT c.id, c.nome FROM clientes c
       WHERE c.ativo=true
         AND NOT EXISTS (
           SELECT 1 FROM publicacoes p
           WHERE p.cliente_id=c.id AND p.criado_em >= NOW() - INTERVAL '7 days'
         )`
    );
    inativos.forEach(c => alertas.push({
      tipo: 'sem_publicacoes', nivel: 'info',
      candidato: c.nome, cliente_id: c.id,
      mensagem: 'Sem publicações nos últimos 7 dias'
    }));

    res.json(alertas);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
```

- [ ] **4.2** Em `backend/bot.js`, exportar `botsAtivos` para o endpoint de KPI conseguir verificar status do bot:

Localizar a linha:
```js
module.exports = { iniciarBots, iniciarBot, pararBot, reiniciarBot, verificarRelatorioSemanal };
```
Substituir por:
```js
module.exports = { botsAtivos, iniciarBots, iniciarBot, pararBot, reiniciarBot, verificarRelatorioSemanal };
```

- [ ] **4.3** Registrar a rota em `backend/server.js`:

Após `const meRoutes = require('./routes/me');`, adicionar:
```js
const dashboardRoutes = require('./routes/dashboard');
```

Após `app.use('/api/me', meRoutes);`, adicionar:
```js
app.use('/api/dashboard', dashboardRoutes);
```

- [ ] **4.4** Commit:
```bash
git add backend/routes/dashboard.js backend/bot.js backend/server.js
git commit -m "feat: endpoints /api/dashboard (kpis, graficos, alertas)"
```

---

## Task 5 — Backend: routes/financeiro.js

**Arquivo:** `backend/routes/financeiro.js` (criar)

Endpoints:
- `GET /api/financeiro` — lista todos os candidatos com dados financeiros
- `GET /api/financeiro/:clienteId` — detalhe + histórico de pagamentos
- `POST /api/financeiro/:clienteId` — criar/atualizar registro financeiro (upsert)
- `POST /api/financeiro/:clienteId/pagamentos` — registrar novo pagamento
- `GET /api/financeiro/export/csv` — exportar CSV

- [ ] **5.1** Criar `backend/routes/financeiro.js`:

```js
'use strict';

const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('./auth');

const router = express.Router();
router.use(authMiddleware);

// Lista todos candidatos com situação financeira
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.nome, c.slug, c.ativo,
        f.plano, f.valor, f.vencimento_dia, f.status AS status_pagamento,
        f.forma_pagamento, f.observacoes,
        (SELECT MAX(data_pagamento) FROM pagamentos p WHERE p.cliente_id=c.id) AS ultimo_pagamento
      FROM clientes c
      LEFT JOIN financeiro f ON f.cliente_id = c.id
      WHERE c.ativo = true
      ORDER BY c.nome
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Detalhe + histórico de pagamentos
router.get('/:clienteId', async (req, res) => {
  try {
    const id = req.params.clienteId;
    const [fin, pags] = await Promise.all([
      query(`SELECT * FROM financeiro WHERE cliente_id=$1`, [id]),
      query(`SELECT * FROM pagamentos WHERE cliente_id=$1 ORDER BY data_pagamento DESC LIMIT 24`, [id]),
    ]);
    res.json({ financeiro: fin.rows[0] || null, pagamentos: pags.rows });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Criar ou atualizar registro financeiro (upsert)
router.post('/:clienteId', async (req, res) => {
  try {
    const { plano, valor, vencimento_dia, status, forma_pagamento, observacoes } = req.body;
    const id = req.params.clienteId;
    await query(`
      INSERT INTO financeiro (cliente_id, plano, valor, vencimento_dia, status, forma_pagamento, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (cliente_id) DO UPDATE SET
        plano=$2, valor=$3, vencimento_dia=$4, status=$5,
        forma_pagamento=$6, observacoes=$7
    `, [id, plano || 'basico', valor || 0, vencimento_dia || 10,
        status || 'trial', forma_pagamento || null, observacoes || null]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Registrar pagamento
router.post('/:clienteId/pagamentos', async (req, res) => {
  try {
    const { valor, data_pagamento, referencia, observacoes } = req.body;
    if (!valor) return res.status(400).json({ erro: 'valor obrigatório' });
    const id = req.params.clienteId;
    await query(
      `INSERT INTO pagamentos (cliente_id, valor, data_pagamento, referencia, observacoes)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, valor, data_pagamento || new Date().toISOString().slice(0,10), referencia || null, observacoes || null]
    );
    // Se estava inadimplente, marcar como ativo
    await query(
      `UPDATE financeiro SET status='ativo' WHERE cliente_id=$1 AND status='inadimplente'`,
      [id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Exportar CSV
router.get('/export/csv', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.nome, c.slug, c.wp_url,
        COALESCE(f.plano,'—') AS plano,
        COALESCE(f.valor::text,'0') AS valor,
        COALESCE(f.vencimento_dia::text,'—') AS vencimento_dia,
        COALESCE(f.status,'sem_registro') AS status_pagamento,
        COALESCE(f.forma_pagamento,'—') AS forma_pagamento,
        (SELECT MAX(data_pagamento)::text FROM pagamentos p WHERE p.cliente_id=c.id) AS ultimo_pagamento,
        (SELECT COUNT(*) FROM publicacoes p WHERE p.cliente_id=c.id AND p.status='publicado') AS total_publicacoes
      FROM clientes c LEFT JOIN financeiro f ON f.cliente_id=c.id
      WHERE c.ativo=true ORDER BY c.nome
    `);

    const cols = ['nome','slug','wp_url','plano','valor','vencimento_dia',
                  'status_pagamento','forma_pagamento','ultimo_pagamento','total_publicacoes'];
    const csv = [
      cols.join(';'),
      ...rows.map(r => cols.map(c => `"${(r[c] ?? '').toString().replace(/"/g,'""')}"`).join(';'))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="candidatos.csv"');
    res.send('﻿' + csv); // BOM para Excel abrir com acentos corretos
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
```

- [ ] **5.2** Registrar em `backend/server.js`:

Após `const dashboardRoutes = require('./routes/dashboard');`:
```js
const financeiroRoutes = require('./routes/financeiro');
```
Após `app.use('/api/dashboard', dashboardRoutes);`:
```js
app.use('/api/financeiro', financeiroRoutes);
```

- [ ] **5.3** Commit:
```bash
git add backend/routes/financeiro.js backend/server.js
git commit -m "feat: endpoints /api/financeiro (CRUD planos, pagamentos, CSV export)"
```

---

## Task 6 — Frontend: estrutura de abas de nível superior

**Arquivo:** `frontend/admin/index.html`

Adicionar um tab-bar principal abaixo do header para navegar entre Dashboard, Candidatos e Financeiro.

- [ ] **6.1** Localizar a tag `<main>` e substituir seu conteúdo inicial pelo sistema de abas:

```html
<main>
  <!-- Abas de nível superior -->
  <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-6);border-bottom:1px solid var(--c-border);padding-bottom:0">
    <button class="tab-top-btn active" id="ttab-dashboard"  onclick="trocarTabTop('dashboard')">📊 Dashboard</button>
    <button class="tab-top-btn"        id="ttab-candidatos" onclick="trocarTabTop('candidatos')">👥 Candidatos</button>
    <button class="tab-top-btn"        id="ttab-financeiro" onclick="trocarTabTop('financeiro')">💰 Financeiro</button>
  </div>

  <div id="ttab-pane-dashboard">  <!-- conteúdo do Dashboard — Task 7 --> </div>
  <div id="ttab-pane-candidatos" style="display:none"> <!-- conteúdo atual (tabela de candidatos) --> </div>
  <div id="ttab-pane-financeiro"  style="display:none"> <!-- conteúdo financeiro — Task 8 --> </div>
</main>
```

- [ ] **6.2** Mover o HTML atual da tabela de candidatos (tudo que está dentro de `<main>`) para dentro de `#ttab-pane-candidatos`

- [ ] **6.3** Adicionar CSS para `.tab-top-btn`:

```css
.tab-top-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--c-text-faint);
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  margin-bottom: -1px;
  transition: color .15s, border-color .15s;
}
.tab-top-btn:hover { color: var(--c-text); }
.tab-top-btn.active { color: var(--c-primary); border-bottom-color: var(--c-primary); }
```

- [ ] **6.4** Adicionar JS de controle das abas:

```js
function trocarTabTop(nome) {
  ['dashboard','candidatos','financeiro'].forEach(t => {
    document.getElementById(`ttab-${t}`).classList.toggle('active', t === nome);
    document.getElementById(`ttab-pane-${t}`).style.display = t === nome ? '' : 'none';
  });
  if (nome === 'dashboard')  carregarDashboard();
  if (nome === 'financeiro') carregarFinanceiro();
}
```

- [ ] **6.5** Em `mostrarApp()`, adicionar `carregarDashboard()` após `carregarClientes()`:

```js
function mostrarApp() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  carregarBotToken();
  carregarDashboard(); // carrega tab inicial
  carregarClientes();
  setInterval(carregarClientes, 30000);
  setInterval(carregarDashboard, 60000); // atualiza dashboard a cada 1min
}
```

- [ ] **6.6** Commit:
```bash
git add frontend/admin/index.html
git commit -m "feat: estrutura de abas de nivel superior (Dashboard / Candidatos / Financeiro)"
```

---

## Task 7 — Frontend: Dashboard tab (KPIs + gráficos + alertas)

**Arquivo:** `frontend/admin/index.html`

### Dependência: Chart.js

- [ ] **7.1** Adicionar no `<head>`:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

### HTML do painel Dashboard

- [ ] **7.2** Preencher `#ttab-pane-dashboard` com:

```html
<div id="ttab-pane-dashboard">
  <!-- KPI cards -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--sp-4);margin-bottom:var(--sp-6)" id="kpiGrid">
    <div class="card-kpi" id="kpi-bot">
      <div class="kpi-icon">🤖</div>
      <div class="kpi-valor" id="kv-bot">—</div>
      <div class="kpi-label">Status do Bot</div>
    </div>
    <div class="card-kpi" id="kpi-candidatos">
      <div class="kpi-icon">👥</div>
      <div class="kpi-valor" id="kv-candidatos">—</div>
      <div class="kpi-label">Candidatos ativos</div>
    </div>
    <div class="card-kpi">
      <div class="kpi-icon">📰</div>
      <div class="kpi-valor" id="kv-pubmes">—</div>
      <div class="kpi-label">Publicações este mês</div>
    </div>
    <div class="card-kpi">
      <div class="kpi-icon">📅</div>
      <div class="kpi-valor" id="kv-pubhoje">—</div>
      <div class="kpi-label">Publicações hoje</div>
    </div>
    <div class="card-kpi">
      <div class="kpi-icon">💰</div>
      <div class="kpi-valor" id="kv-mrr">—</div>
      <div class="kpi-label">MRR</div>
    </div>
    <div class="card-kpi" id="kpi-inadimp">
      <div class="kpi-icon">⚠️</div>
      <div class="kpi-valor" id="kv-inadimp">—</div>
      <div class="kpi-label">Inadimplentes</div>
    </div>
  </div>

  <!-- Gráficos -->
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--sp-4);margin-bottom:var(--sp-6)">
    <div class="card" style="padding:var(--sp-4)">
      <div style="font-weight:600;margin-bottom:var(--sp-3);font-size:var(--text-sm)">📈 Publicações — últimos 30 dias</div>
      <canvas id="chartLinha" height="100"></canvas>
    </div>
    <div class="card" style="padding:var(--sp-4)">
      <div style="font-weight:600;margin-bottom:var(--sp-3);font-size:var(--text-sm)">📡 Distribuição por canal</div>
      <canvas id="chartCanal" height="200"></canvas>
    </div>
  </div>

  <!-- Ranking + Alertas -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4)">
    <div class="card" style="padding:var(--sp-4)">
      <div style="font-weight:600;margin-bottom:var(--sp-3);font-size:var(--text-sm)">🏆 Ranking — publicações (30 dias)</div>
      <canvas id="chartRanking" height="160"></canvas>
    </div>
    <div class="card" style="padding:var(--sp-4)">
      <div style="font-weight:600;margin-bottom:var(--sp-3);font-size:var(--text-sm)">🚨 Alertas operacionais</div>
      <div id="listaAlertas" style="font-size:var(--text-sm)">Carregando…</div>
    </div>
  </div>
</div>
```

- [ ] **7.3** Adicionar CSS para os cards KPI:

```css
.card-kpi {
  background: var(--c-bg-card);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.kpi-icon  { font-size: 20px; }
.kpi-valor { font-size: var(--text-2xl); font-weight: 700; line-height: 1.1; }
.kpi-label { font-size: var(--text-xs); color: var(--c-text-faint); }
.card-kpi.alerta-erro  { border-color: #ef4444; background: rgba(239,68,68,.08); }
.card-kpi.alerta-aviso { border-color: #f97316; background: rgba(249,115,22,.08); }
```

- [ ] **7.4** Adicionar JS para `carregarDashboard()`:

```js
let chartLinha   = null;
let chartCanal   = null;
let chartRanking = null;

async function carregarDashboard() {
  try {
    const [kpis, graficos, alertas] = await Promise.all([
      api('/dashboard/kpis'),
      api('/dashboard/graficos'),
      api('/dashboard/alertas'),
    ]);

    // — KPIs —
    document.getElementById('kv-bot').textContent       = kpis.bot_online ? '🟢 Online' : '🔴 Offline';
    document.getElementById('kv-candidatos').textContent = kpis.candidatos_ativos;
    document.getElementById('kv-pubmes').textContent     = kpis.publicacoes_mes;
    document.getElementById('kv-pubhoje').textContent    = kpis.publicacoes_hoje;
    document.getElementById('kv-mrr').textContent        = 'R$ ' + Number(kpis.mrr).toLocaleString('pt-BR',{minimumFractionDigits:2});
    document.getElementById('kv-inadimp').textContent    = kpis.inadimplentes;
    document.getElementById('kpi-inadimp').className     = 'card-kpi' + (kpis.inadimplentes > 0 ? ' alerta-aviso' : '');
    document.getElementById('kpi-bot').className         = 'card-kpi' + (!kpis.bot_online ? ' alerta-erro' : '');

    // — Gráfico de linha (publicações/dia) —
    const labels = graficos.por_dia.map(d => new Date(d.data).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}));
    const data   = graficos.por_dia.map(d => d.total);
    if (chartLinha) chartLinha.destroy();
    chartLinha = new Chart(document.getElementById('chartLinha'), {
      type: 'line',
      data: {
        labels,
        datasets: [{ label: 'Publicações', data, borderColor: '#2563eb',
                     backgroundColor: 'rgba(37,99,235,.1)', fill: true,
                     tension: 0.4, pointRadius: 3 }]
      },
      options: { plugins: { legend: { display: false } }, scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }}
    });

    // — Gráfico donut (canais) —
    const c = graficos.por_canal;
    if (chartCanal) chartCanal.destroy();
    chartCanal = new Chart(document.getElementById('chartCanal'), {
      type: 'doughnut',
      data: {
        labels: ['WordPress','WhatsApp','Facebook','Instagram'],
        datasets: [{ data: [c.wp, c.wa, c.fb, c.ig],
                     backgroundColor: ['#6366f1','#22c55e','#3b82f6','#ec4899'],
                     borderWidth: 0 }]
      },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, cutout: '65%' }
    });

    // — Gráfico barras (ranking) —
    if (chartRanking) chartRanking.destroy();
    chartRanking = new Chart(document.getElementById('chartRanking'), {
      type: 'bar',
      data: {
        labels: graficos.ranking.map(r => r.nome.split(' ').slice(0,2).join(' ')),
        datasets: [{ data: graficos.ranking.map(r => r.total),
                     backgroundColor: '#2563eb', borderRadius: 4 }]
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } },
                 scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    // — Alertas —
    const nivelIcon = { erro: '🔴', aviso: '⚠️', info: 'ℹ️' };
    const html = alertas.length
      ? alertas.map(a =>
          `<div style="padding:var(--sp-2) 0;border-bottom:1px solid var(--c-border);display:flex;gap:8px;align-items:flex-start">
             <span>${nivelIcon[a.nivel] || '•'}</span>
             <div>
               <div style="font-weight:500">${esc(a.candidato)}</div>
               <div style="color:var(--c-text-faint);font-size:var(--text-xs)">${esc(a.mensagem)}</div>
             </div>
           </div>`
        ).join('')
      : '<div style="color:var(--c-text-faint);padding:var(--sp-4) 0">✅ Nenhum alerta ativo</div>';
    document.getElementById('listaAlertas').innerHTML = html;

  } catch(err) { console.error('Dashboard:', err); }
}
```

- [ ] **7.5** Commit:
```bash
git add frontend/admin/index.html
git commit -m "feat: dashboard tab com KPIs, graficos Chart.js e alertas operacionais"
```

---

## Task 8 — Frontend: Financeiro tab

**Arquivo:** `frontend/admin/index.html`

### HTML

- [ ] **8.1** Preencher `#ttab-pane-financeiro`:

```html
<div id="ttab-pane-financeiro" style="display:none">
  <!-- Sumário MRR -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:var(--sp-4);margin-bottom:var(--sp-5)" id="finSumario">
    <div class="card-kpi"><div class="kpi-icon">💰</div><div class="kpi-valor" id="fin-mrr">—</div><div class="kpi-label">MRR</div></div>
    <div class="card-kpi"><div class="kpi-icon">✅</div><div class="kpi-valor" id="fin-ativos">—</div><div class="kpi-label">Contratos ativos</div></div>
    <div class="card-kpi alerta-aviso" id="fin-card-inadimp"><div class="kpi-icon">⚠️</div><div class="kpi-valor" id="fin-inadimp">—</div><div class="kpi-label">Inadimplentes</div></div>
    <div class="card-kpi"><div class="kpi-icon">🧪</div><div class="kpi-valor" id="fin-trial">—</div><div class="kpi-label">Em trial</div></div>
  </div>

  <div style="display:flex;justify-content:flex-end;margin-bottom:var(--sp-3);gap:var(--sp-2)">
    <a href="/api/financeiro/export/csv" class="btn btn-ghost btn-sm" id="btnExportCsv">⬇️ Exportar CSV</a>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Candidato</th><th>Plano</th><th>Valor/mês</th>
        <th>Venc. dia</th><th>Status</th><th>Último pag.</th><th></th>
      </tr></thead>
      <tbody id="finTabela"><tr><td colspan="7" style="text-align:center;color:var(--c-text-faint)">Carregando…</td></tr></tbody>
    </table>
  </div>
</div>
```

- [ ] **8.2** Adicionar modal de edição financeira (antes de `</body>`):

```html
<!-- MODAL: FINANCEIRO -->
<div class="overlay" id="finOverlay" style="align-items:center" onclick="if(event.target===this)fecharFin()">
  <div class="drawer" style="max-width:480px;height:auto;max-height:85vh">
    <div class="drawer-head">
      <span id="finTitulo">Configuração financeira</span>
      <button class="btn btn-ghost btn-sm" onclick="fecharFin()">✕ Fechar</button>
    </div>
    <div style="padding:var(--sp-5);overflow-y:auto">
      <input type="hidden" id="finClienteId">
      <div class="grid2">
        <div>
          <label>Plano</label>
          <select id="finPlano">
            <option value="trial">Trial (gratuito)</option>
            <option value="basico">Básico</option>
            <option value="profissional">Profissional</option>
            <option value="premium">Premium</option>
          </select>
        </div>
        <div>
          <label>Valor mensal (R$)</label>
          <input type="number" id="finValor" min="0" step="0.01" placeholder="0.00">
        </div>
      </div>
      <div class="grid2">
        <div>
          <label>Dia de vencimento</label>
          <input type="number" id="finVencDia" min="1" max="28" placeholder="10">
        </div>
        <div>
          <label>Forma de pagamento</label>
          <select id="finForma">
            <option value="">— Selecione —</option>
            <option value="pix">PIX</option>
            <option value="boleto">Boleto</option>
            <option value="cartao">Cartão</option>
            <option value="transferencia">Transferência</option>
          </select>
        </div>
      </div>
      <label>Status</label>
      <select id="finStatus">
        <option value="trial">Trial</option>
        <option value="ativo">Ativo</option>
        <option value="inadimplente">Inadimplente</option>
        <option value="suspenso">Suspenso</option>
        <option value="cancelado">Cancelado</option>
      </select>
      <label style="margin-top:var(--sp-3)">Observações</label>
      <textarea id="finObs" rows="2" placeholder="Notas internas…"></textarea>

      <div class="section-title" style="margin-top:var(--sp-4)">Registrar pagamento</div>
      <div class="grid2">
        <div>
          <label>Valor pago (R$)</label>
          <input type="number" id="pagValor" min="0" step="0.01" placeholder="0.00">
        </div>
        <div>
          <label>Referência</label>
          <input type="text" id="pagRef" placeholder="Jun/2026">
        </div>
      </div>
      <div style="display:flex;gap:var(--sp-3);justify-content:space-between;margin-top:var(--sp-4)">
        <button class="btn btn-ghost btn-sm" onclick="registrarPagamento()">💸 Registrar pagamento</button>
        <div style="display:flex;gap:var(--sp-2)">
          <button class="btn btn-ghost" onclick="fecharFin()">Cancelar</button>
          <button class="btn btn-primary" onclick="salvarFin()">Salvar</button>
        </div>
      </div>

      <div class="section-title" style="margin-top:var(--sp-4)">Histórico</div>
      <div id="finHistorico" style="font-size:var(--text-xs);color:var(--c-text-faint)">—</div>
    </div>
  </div>
</div>
```

- [ ] **8.3** Adicionar JS:

```js
// ─── FINANCEIRO ───────────────────────────────────────────
const PLANO_LABEL = { trial:'Trial', basico:'Básico', profissional:'Profissional', premium:'Premium' };
const STATUS_BADGE = {
  ativo: '<span class="badge ativo">Ativo</span>',
  trial: '<span class="badge" style="background:#6366f1">Trial</span>',
  inadimplente: '<span class="badge inativo">Inadimplente</span>',
  suspenso: '<span class="badge" style="background:#64748b">Suspenso</span>',
  cancelado: '<span class="badge inativo">Cancelado</span>',
};

async function carregarFinanceiro() {
  try {
    const rows = await api('/financeiro');
    const mrr   = rows.reduce((s,r) => s + (r.status_pagamento==='ativo' ? parseFloat(r.valor||0) : 0), 0);
    const ativos = rows.filter(r => r.status_pagamento==='ativo').length;
    const inadimp= rows.filter(r => r.status_pagamento==='inadimplente').length;
    const trial  = rows.filter(r => !r.status_pagamento || r.status_pagamento==='trial').length;

    document.getElementById('fin-mrr').textContent    = 'R$ '+mrr.toLocaleString('pt-BR',{minimumFractionDigits:2});
    document.getElementById('fin-ativos').textContent = ativos;
    document.getElementById('fin-inadimp').textContent= inadimp;
    document.getElementById('fin-trial').textContent  = trial;
    document.getElementById('fin-card-inadimp').className = 'card-kpi' + (inadimp>0?' alerta-aviso':'');

    // Atualiza link de export com token
    document.getElementById('btnExportCsv').href = `/api/financeiro/export/csv?token=${TOKEN}`;

    const tbody = document.getElementById('finTabela');
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${esc(r.nome)}</strong></td>
        <td>${esc(PLANO_LABEL[r.plano] || r.plano || '—')}</td>
        <td>${r.valor ? 'R$ '+Number(r.valor).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'}</td>
        <td>${r.vencimento_dia ? 'Dia '+r.vencimento_dia : '—'}</td>
        <td>${STATUS_BADGE[r.status_pagamento] || '<span class="badge">Sem registro</span>'}</td>
        <td>${r.ultimo_pagamento ? new Date(r.ultimo_pagamento).toLocaleDateString('pt-BR') : '—'}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="abrirFin(${r.id})">⚙️</button></td>
      </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--c-text-faint)">Nenhum candidato</td></tr>';
  } catch(err) { toast('Erro ao carregar financeiro: '+err.message, true); }
}

async function abrirFin(clienteId) {
  document.getElementById('finClienteId').value = clienteId;
  try {
    const { financeiro, pagamentos } = await api(`/financeiro/${clienteId}`);
    if (financeiro) {
      document.getElementById('finPlano').value    = financeiro.plano    || 'trial';
      document.getElementById('finValor').value    = financeiro.valor    || '';
      document.getElementById('finVencDia').value  = financeiro.vencimento_dia || '';
      document.getElementById('finForma').value    = financeiro.forma_pagamento || '';
      document.getElementById('finStatus').value   = financeiro.status   || 'trial';
      document.getElementById('finObs').value      = financeiro.observacoes || '';
    } else {
      ['finPlano','finValor','finVencDia','finForma','finStatus','finObs'].forEach(id => {
        document.getElementById(id).value = id==='finPlano'?'trial':id==='finStatus'?'trial':'';
      });
    }
    document.getElementById('pagValor').value = '';
    document.getElementById('pagRef').value   = '';

    const hist = pagamentos.length
      ? pagamentos.map(p =>
          `<div style="padding:4px 0;border-bottom:1px solid var(--c-border)">
             ${new Date(p.data_pagamento).toLocaleDateString('pt-BR')} — R$ ${Number(p.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}
             ${p.referencia?`<span style="color:var(--c-text-faint)">(${esc(p.referencia)})</span>`:''}
           </div>`
        ).join('')
      : '<div style="padding:4px 0">Nenhum pagamento registrado</div>';
    document.getElementById('finHistorico').innerHTML = hist;

    // Busca nome do candidato para o título
    const todos = await api('/clientes');
    const c = todos.find(x => x.id === clienteId);
    document.getElementById('finTitulo').textContent = `💰 ${c?.nome || 'Financeiro'}`;
  } catch(err) { toast('Erro: '+err.message, true); return; }
  document.getElementById('finOverlay').classList.add('open');
}

function fecharFin() { document.getElementById('finOverlay').classList.remove('open'); }

async function salvarFin() {
  const id = document.getElementById('finClienteId').value;
  try {
    await api(`/financeiro/${id}`, { method:'POST', body:{
      plano:           document.getElementById('finPlano').value,
      valor:           parseFloat(document.getElementById('finValor').value) || 0,
      vencimento_dia:  parseInt(document.getElementById('finVencDia').value) || 10,
      forma_pagamento: document.getElementById('finForma').value || null,
      status:          document.getElementById('finStatus').value,
      observacoes:     document.getElementById('finObs').value || null,
    }});
    fecharFin();
    toast('Configuração financeira salva!');
    carregarFinanceiro();
    carregarDashboard();
  } catch(err) { toast('Erro: '+err.message, true); }
}

async function registrarPagamento() {
  const id    = document.getElementById('finClienteId').value;
  const valor = parseFloat(document.getElementById('pagValor').value);
  const ref   = document.getElementById('pagRef').value.trim();
  if (!valor || valor <= 0) return toast('Informe o valor do pagamento', true);
  try {
    await api(`/financeiro/${id}/pagamentos`, { method:'POST', body:{
      valor, referencia: ref || null,
    }});
    toast('Pagamento registrado!');
    abrirFin(parseInt(id)); // recarrega histórico
    carregarFinanceiro();
    carregarDashboard();
  } catch(err) { toast('Erro: '+err.message, true); }
}
```

- [ ] **8.4** Corrigir link de exportação CSV para passar o token de auth. O endpoint usa `authMiddleware` que lê do header `Authorization`. Para download de arquivo via link `<a>`, precisamos passar o token na query string. Modificar `routes/financeiro.js` para aceitar token via query string além do header:

```js
// No início de routes/financeiro.js, antes do router.use(authMiddleware):
router.get('/export/csv', async (req, res) => {
  // Aceita token via ?token= para links de download
  const token = req.query.token || req.headers.authorization?.replace('Bearer ','');
  if (!token) return res.status(401).json({ erro: 'Não autorizado' });
  try {
    const jwt = require('jsonwebtoken');
    const settings = require('../settings.json');
    const payload = jwt.verify(token, settings.jwt_secret);
    if (!payload.admin) return res.status(403).json({ erro: 'Acesso negado' });
  } catch { return res.status(401).json({ erro: 'Token inválido' }); }

  // ... mesmo código do endpoint CSV
});
```

> **Atenção:** remover `router.use(authMiddleware)` de antes do export/csv e colocar o middleware individualmente nos outros endpoints, ou colocar o export/csv antes do `router.use(authMiddleware)`.

- [ ] **8.5** Commit:
```bash
git add frontend/admin/index.html backend/routes/financeiro.js
git commit -m "feat: aba Financeiro com tabela, modal de planos/pagamentos e export CSV"
```

---

## Task 9 — Commit de fechamento e verificação no servidor

- [ ] **9.1** Push final:
```bash
git push origin master
```

- [ ] **9.2** Aguardar deploy automático (~60s) e verificar logs:
```bash
ssh -i "ssh-key-2026-04-21.key" ubuntu@146.235.53.61 "pm2 logs plataforma-candidatos --lines 15 --nostream"
```
Esperado: `[db] Migrations OK` (novas tabelas criadas) + `[server] Plataforma Candidatos rodando na porta 3003`

- [ ] **9.3** Testar no browser:
  - `feed.scatto.site/admin` → login → aba Dashboard carrega KPIs e gráficos
  - Aba Candidatos → lista existente intacta
  - Aba Financeiro → tabela de candidatos, clicar ⚙️ → modal abre centralizado
  - Registrar pagamento para um candidato → aparece no histórico
  - `⬇️ Exportar CSV` → baixa arquivo com acentos corretos no Excel
  - `⚙️` no header → modal de configurações aparece **centralizado** (fix da Task 1)

---

## Resumo dos endpoints criados

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/dashboard/kpis` | KPIs em tempo real |
| `GET` | `/api/dashboard/graficos` | Dados para Chart.js |
| `GET` | `/api/dashboard/alertas` | Alertas operacionais |
| `GET` | `/api/financeiro` | Lista com status financeiro |
| `GET` | `/api/financeiro/:id` | Detalhe + histórico |
| `POST` | `/api/financeiro/:id` | Upsert plano |
| `POST` | `/api/financeiro/:id/pagamentos` | Registrar pagamento |
| `GET` | `/api/financeiro/export/csv` | Download CSV (token via query) |
