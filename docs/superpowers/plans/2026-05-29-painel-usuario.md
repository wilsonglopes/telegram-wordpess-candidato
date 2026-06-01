# Painel do Usuário — Plataforma Candidatos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um painel self-service para que cada candidato (cliente) configure WordPress, Facebook, Instagram, WhatsApp e aparência por conta própria, com tutoriais passo a passo embutidos — sem depender do administrador para operações de rotina.

**Architecture:** Adiciona autenticação por cliente (email + senha, JWT separado do admin) com middleware próprio. Cria rotas `/api/me/*` que espelham as rotas admin mas isoladas ao `cliente_id` extraído do token. O frontend é um único HTML (`frontend/painel/index.html`) no mesmo padrão do painel admin existente, com 5 abas e tutoriais colapsáveis em cada seção.

**Tech Stack:** Node.js + Express, PostgreSQL, bcryptjs, jsonwebtoken, HTML/CSS/JS vanilla, design-system.css existente.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/db.js` | Modificar | Migrations: adicionar `user_email` e `user_password_hash` à tabela `clientes` |
| `backend/routes/auth.js` | Modificar | Adicionar `POST /user/login` + exportar `authUserMiddleware` |
| `backend/routes/me.js` | **Criar** | Todas as rotas `/api/me/*` isoladas por `cliente_id` |
| `backend/server.js` | Modificar | Registrar `/api/me`, servir `/painel*` |
| `frontend/painel/index.html` | **Criar** | Painel do usuário: login + 5 abas + tutoriais |
| `frontend/admin/index.html` | Modificar | Adicionar campos "Acesso do usuário" (email + senha) no drawer de edição |

---

## Regras de isolamento (críticas)

- `authUserMiddleware` extrai `req.clienteId` do JWT com `role: 'user'`
- Toda query em `me.js` filtra por `cliente_id = req.clienteId` — NUNCA por parâmetro da URL
- Campos que o usuário **não pode alterar**: `slug`, `nome`, `telegram_bot_token`, `token_qr`, `evolution_instancia`, `ativo`
- Campos que o usuário **pode alterar**: `wp_url`, `wp_plugin_key`, `wp_usuario`, `wp_senha`, `fb_page_id`, `fb_access_token`, `ig_user_id`, `logo_url`, `brand_color`, `gerar_card`
- Campos que o usuário **não pode alterar** (admin-only): `wp_post_format`, `slug`, `nome`, `telegram_bot_token`, `token_qr`, `evolution_instancia`, `ativo`
- Campos nunca expostos ao usuário: `wp_senha` (write-only — campo deletado antes de retornar), `token_qr`, `evolution_instancia`, `user_password_hash`

---

## Task 1: Migration — credenciais de acesso do usuário

**Files:**
- Modify: `backend/db.js`

- [ ] **Step 1: Adicionar as duas colunas na função `migrate()`**

No final do bloco de `ALTER TABLE` existente em `backend/db.js`, adicionar:

```js
await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS user_email         TEXT UNIQUE`);
await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS user_password_hash TEXT`);
```

- [ ] **Step 2: Testar a migration**

```bash
# No servidor OU localmente com o banco configurado:
node -e "require('./backend/db').migrate().then(() => { console.log('OK'); process.exit(0); })"
```
Esperado: `[db] Migrations OK` sem erros.

- [ ] **Step 3: Commit**

```bash
git add backend/db.js
git commit -m "feat: migration — user_email e user_password_hash em clientes"
```

---

## Task 2: Auth de usuário — endpoint de login + middleware

**Files:**
- Modify: `backend/routes/auth.js`

- [ ] **Step 1: Corrigir `authMiddleware` admin para rejeitar tokens de usuário (CRÍTICO)**

O `authMiddleware` atual não verifica `role`, então um token `role: 'user'` passaria nas rotas admin. Localizar a função `authMiddleware` existente e substituí-la:

```js
// ANTES (existente — vulnerável):
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    jwt.verify(token, settings.jwt_secret);
    next();
  } catch {
    res.status(401).json({ erro: 'Não autorizado' });
  }
}

// DEPOIS (corrigido — rejeita tokens de usuário):
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, settings.jwt_secret);
    if (!payload.admin) throw new Error('não é token admin');
    next();
  } catch {
    res.status(401).json({ erro: 'Não autorizado' });
  }
}
```

- [ ] **Step 2: Adicionar o endpoint `POST /user/login` e `authUserMiddleware`**

Adicionar após a função `authMiddleware` corrigida e ANTES do `module.exports` existente:

```js
// Login do cliente (usuário da plataforma)
router.post('/user/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'email e senha obrigatórios' });

  const { query } = require('../db');
  try {
    const { rows } = await query(
      `SELECT id, nome, user_password_hash FROM clientes WHERE user_email = $1 AND ativo = true`,
      [email.toLowerCase().trim()]
    );
    const cliente = rows[0];
    if (!cliente || !cliente.user_password_hash) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
    }
    if (!bcrypt.compareSync(senha, cliente.user_password_hash)) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
    }
    const token = jwt.sign(
      { clienteId: cliente.id, role: 'user' },
      settings.jwt_secret,
      { expiresIn: '30d' }
    );
    res.json({ token, nome: cliente.nome });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

function authUserMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, settings.jwt_secret);
    if (payload.role !== 'user') throw new Error('role inválida');
    req.clienteId = payload.clienteId;
    next();
  } catch {
    res.status(401).json({ erro: 'Não autorizado' });
  }
}
```

**SUBSTITUIR** o bloco `module.exports` existente (não adicionar um novo) pelo seguinte:

```js
module.exports = router;
module.exports.authMiddleware     = authMiddleware;
module.exports.authUserMiddleware = authUserMiddleware;
```

- [ ] **Step 3: Testar manualmente (após criar um usuário via admin no Task 6)**

```bash
curl -s -X POST http://localhost:3003/api/auth/user/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"teste@candidato.com","senha":"senha123"}' | python3 -m json.tool
```
Esperado: `{ "token": "...", "nome": "..." }` ou `{ "erro": "E-mail ou senha inválidos" }` se ainda não cadastrado.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/auth.js
git commit -m "feat: auth — login e middleware para usuarios; fix authMiddleware admin rejeita role:user"
```

---

## Task 3: Rotas /api/me

**Files:**
- Create: `backend/routes/me.js`

- [ ] **Step 1: Criar o arquivo `backend/routes/me.js`**

```js
'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { query }             = require('../db');
const { authUserMiddleware } = require('./auth');
const { obterQRCode, statusConexao, listarGrupos } = require('../connectors/evolution');

const router = express.Router();
router.use(authUserMiddleware);

// Campos que o usuário pode atualizar (wp_post_format é admin-only)
const CAMPOS_PERMITIDOS = [
  'wp_url', 'wp_plugin_key', 'wp_usuario', 'wp_senha',
  'fb_page_id', 'fb_access_token', 'ig_user_id',
  'logo_url', 'brand_color', 'gerar_card',
];

// GET /api/me — dados próprios
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM clientes WHERE id = $1`, [req.clienteId]);
    if (!rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const c = { ...rows[0] };
    // Remove campos sensíveis/internos
    delete c.wp_senha;
    delete c.token_qr;
    delete c.evolution_instancia;
    delete c.user_password_hash;
    res.json(c);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/me — atualiza campos permitidos
router.patch('/', async (req, res) => {
  try {
    const updates = [];
    const values  = [];
    let i = 1;
    for (const campo of CAMPOS_PERMITIDOS) {
      if (req.body[campo] !== undefined) {
        updates.push(`${campo} = $${i++}`);
        values.push(req.body[campo]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ erro: 'Nada para atualizar' });
    values.push(req.clienteId);
    await query(`UPDATE clientes SET ${updates.join(', ')} WHERE id = $${i}`, values);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── GRUPOS WHATSAPP ────────────────────────────────────────────────────────────

router.get('/grupos', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM grupos_whatsapp WHERE cliente_id = $1 ORDER BY nome`,
      [req.clienteId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/grupos', async (req, res) => {
  const { group_jid, nome } = req.body;
  if (!group_jid || !nome) return res.status(400).json({ erro: 'group_jid e nome obrigatórios' });
  try {
    await query(
      `INSERT INTO grupos_whatsapp (cliente_id, group_jid, nome) VALUES ($1, $2, $3)`,
      [req.clienteId, group_jid, nome]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.patch('/grupos/:gid', async (req, res) => {
  const { ativo } = req.body;
  try {
    const result = await query(
      `UPDATE grupos_whatsapp SET ativo = $1 WHERE id = $2 AND cliente_id = $3`,
      [ativo, req.params.gid, req.clienteId]
    );
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Grupo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/grupos/:gid', async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM grupos_whatsapp WHERE id = $1 AND cliente_id = $2`,
      [req.params.gid, req.clienteId]
    );
    if (result.rowCount === 0) return res.status(404).json({ erro: 'Grupo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── WHATSAPP — STATUS E QR ─────────────────────────────────────────────────────

router.get('/whatsapp/status', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT evolution_instancia, whatsapp_status FROM clientes WHERE id = $1`,
      [req.clienteId]
    );
    if (!rows[0]?.evolution_instancia) return res.json({ status: 'não configurado' });
    const status = await statusConexao(rows[0].evolution_instancia);
    const label = status === 'open' ? 'conectado' : status === 'connecting' ? 'pendente' : 'desconectado';
    if (status === 'open') {
      await query(`UPDATE clientes SET whatsapp_status = 'conectado' WHERE id = $1`, [req.clienteId]);
    }
    res.json({ status: label });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/whatsapp/qr', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT evolution_instancia FROM clientes WHERE id = $1`,
      [req.clienteId]
    );
    if (!rows[0]?.evolution_instancia) return res.status(404).json({ erro: 'Instância não configurada' });
    const qr = await obterQRCode(rows[0].evolution_instancia);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Lista grupos disponíveis na instância WA (para o usuário selecionar quais ativar)
router.get('/whatsapp/grupos-disponiveis', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT evolution_instancia FROM clientes WHERE id = $1`,
      [req.clienteId]
    );
    if (!rows[0]?.evolution_instancia) return res.json([]);
    const grupos = await listarGrupos(rows[0].evolution_instancia);
    res.json(grupos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── PUBLICAÇÕES ────────────────────────────────────────────────────────────────

router.get('/publicacoes', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT titulo, wp_post_url, status, criado_em FROM publicacoes WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 20`,
      [req.clienteId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verificar que o arquivo não tem erro de sintaxe**

```bash
node -e "require('./backend/routes/me')"
```
Esperado: sem erro (saída vazia).

- [ ] **Step 3: Commit**

```bash
git add backend/routes/me.js
git commit -m "feat: rotas /api/me — configuracao e grupos isolados por cliente"
```

---

## Task 4: Registrar rotas no server.js + servir frontend

**Files:**
- Modify: `backend/server.js`

- [ ] **Step 1: Adicionar import e rotas em `backend/server.js`**

Após a linha `const whatsappRoutes = require('./routes/whatsapp');`, adicionar:

```js
const meRoutes = require('./routes/me');
```

Após a linha `app.use('/api/whatsapp',  whatsappRoutes);`, adicionar:

```js
app.use('/api/me', meRoutes);
```

Após a linha que serve `/admin*`, adicionar:

```js
// Serve painel do usuário (SPA — cobre sub-rotas como /painel/qualquer-coisa)
// Nota: express.static já serve /painel/index.html direto, mas esta rota cobre
// caminhos como /painel/configuracoes que não existem como arquivos físicos.
app.get('/painel*', (_, res) => res.sendFile(path.join(__dirname, '../frontend/painel/index.html')));
```

- [ ] **Step 2: Verificar que o servidor sobe sem erro**

```bash
node backend/server.js
```
Esperado: `[server] Plataforma Candidatos rodando na porta 3003`.

- [ ] **Step 3: Commit**

```bash
git add backend/server.js
git commit -m "feat: registra /api/me e serve /painel no servidor"
```

---

## Task 5: Frontend — painel do usuário

**Files:**
- Create: `frontend/painel/index.html`

> Este é o maior arquivo do plano. O HTML segue o padrão exato do `admin/index.html`:
> login card → app com header + main + drawer. Design system via `/design-system.css`.

- [ ] **Step 1: Criar `frontend/painel/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meu Painel — Plataforma Candidatos</title>
  <link rel="stylesheet" href="/design-system.css">
  <style>
    body { background: var(--c-bg); min-height: 100vh; }

    /* ── LOGIN ── */
    .login-wrap {
      display:flex; align-items:center; justify-content:center;
      min-height:100vh; padding:var(--sp-6);
      background: radial-gradient(ellipse 60% 50% at 50% 0%, rgba(37,99,235,.15) 0%, transparent 70%);
    }
    .login-box {
      background:var(--c-bg-card); border-radius:var(--r-xl);
      padding:var(--sp-10); width:100%; max-width:380px;
      border:1px solid rgba(255,255,255,.06); box-shadow:var(--shadow-lg);
    }
    .login-logo { display:flex; align-items:center; gap:10px; margin-bottom:var(--sp-8); }
    .login-logo .icon {
      width:40px; height:40px; background:var(--c-primary); border-radius:var(--r-md);
      display:flex; align-items:center; justify-content:center;
      font-size:20px; box-shadow:0 2px 12px rgba(37,99,235,.5);
    }
    .login-logo h1 { font-size:var(--text-base); font-weight:700; }
    .login-logo p  { font-size:var(--text-xs); color:var(--c-text-faint); }

    /* ── APP ── */
    .app { display:none; }
    header {
      background:var(--c-bg-card); padding:0 clamp(var(--sp-5),3vw,var(--sp-8));
      display:flex; align-items:center; justify-content:space-between;
      height:60px; border-bottom:1px solid var(--c-border);
      position:sticky; top:0; z-index:50; backdrop-filter:blur(8px);
    }
    .header-logo { display:flex; align-items:center; gap:10px; font-weight:700; font-size:var(--text-sm); }
    .header-logo .icon {
      width:30px; height:30px; background:var(--c-primary);
      border-radius:var(--r-sm); display:flex; align-items:center;
      justify-content:center; font-size:16px;
    }
    .header-actions { display:flex; gap:var(--sp-3); align-items:center; }
    main { padding:var(--sp-8) clamp(var(--sp-5),3vw,var(--sp-8)); max-width:900px; margin:0 auto; }

    /* ── TABS ── */
    .tabs { display:flex; gap:var(--sp-1); margin-bottom:var(--sp-6); border-bottom:1px solid var(--c-border); }
    .tab-btn {
      padding:var(--sp-3) var(--sp-4); font-size:var(--text-sm); color:var(--c-text-muted);
      background:none; border:none; border-bottom:2px solid transparent;
      cursor:pointer; transition:var(--t); margin-bottom:-1px;
    }
    .tab-btn.active { color:var(--c-primary); border-bottom-color:var(--c-primary); font-weight:600; }
    .tab-pane { display:none; }
    .tab-pane.active { display:block; }

    /* ── STATUS CARDS ── */
    .status-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:var(--sp-4); margin-bottom:var(--sp-6); }
    .status-card {
      background:var(--c-bg-card); border-radius:var(--r-lg); padding:var(--sp-5);
      border:1px solid var(--c-border);
    }
    .status-card .label { font-size:var(--text-xs); color:var(--c-text-faint); margin-bottom:var(--sp-2); }
    .status-card .value { font-size:var(--text-sm); font-weight:600; display:flex; align-items:center; gap:6px; }
    .dot { width:8px; height:8px; border-radius:50%; }
    .dot-ok     { background:var(--c-success); }
    .dot-warn   { background:var(--c-warning); }
    .dot-err    { background:var(--c-danger); }
    .dot-off    { background:var(--c-text-faint); }

    /* ── TUTORIAL ── */
    .tutorial {
      background:rgba(37,99,235,.07); border:1px solid rgba(37,99,235,.2);
      border-radius:var(--r-lg); margin-top:var(--sp-5);
    }
    .tutorial summary {
      padding:var(--sp-4) var(--sp-5); cursor:pointer; font-size:var(--text-sm);
      font-weight:600; color:var(--c-primary); list-style:none; display:flex;
      align-items:center; gap:var(--sp-2); user-select:none;
    }
    .tutorial summary::before { content:'📖'; }
    .tutorial[open] summary::before { content:'📗'; }
    .tutorial-body { padding:0 var(--sp-5) var(--sp-5); }
    .tutorial-steps { list-style:none; counter-reset:step; margin-top:var(--sp-3); }
    .tutorial-steps li {
      counter-increment:step; display:flex; gap:var(--sp-3);
      align-items:flex-start; padding:var(--sp-3) 0;
      border-bottom:1px solid rgba(255,255,255,.05);
    }
    .tutorial-steps li:last-child { border-bottom:none; }
    .tutorial-steps li::before {
      content:counter(step); min-width:24px; height:24px;
      background:var(--c-primary); color:#fff; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size:var(--text-xs); font-weight:700; flex-shrink:0; margin-top:1px;
    }
    .tutorial-steps li p { font-size:var(--text-sm); color:var(--c-text-muted); line-height:1.5; }
    .tutorial-steps li strong { color:var(--c-text); }
    .tutorial-steps li code {
      background:var(--c-bg); padding:1px 6px; border-radius:4px;
      font-family:monospace; font-size:.82em; color:var(--c-primary-light);
    }
    .tutorial-note {
      background:rgba(217,119,6,.1); border:1px solid rgba(217,119,6,.3);
      border-radius:var(--r-md); padding:var(--sp-3) var(--sp-4);
      font-size:var(--text-sm); color:var(--c-warning); margin-top:var(--sp-3);
    }

    /* ── SECÇÃO ── */
    .section { margin-bottom:var(--sp-6); }
    .section-title { font-size:var(--text-sm); font-weight:700; color:var(--c-text-faint); text-transform:uppercase; letter-spacing:.06em; margin-bottom:var(--sp-4); }

    /* ── FORM ── */
    .form-row { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-4); }
    @media (max-width:600px) { .form-row { grid-template-columns:1fr; } }
    .form-group { display:flex; flex-direction:column; gap:var(--sp-2); margin-bottom:var(--sp-4); }
    .form-group label { font-size:var(--text-xs); font-weight:600; color:var(--c-text-muted); text-transform:uppercase; letter-spacing:.06em; }
    .form-group .hint { font-size:var(--text-xs); color:var(--c-text-faint); margin-top:2px; }
    .form-group .hint a { color:var(--c-primary); text-decoration:none; }

    /* ── QR SECTION ── */
    .qr-wrap { text-align:center; padding:var(--sp-6); }
    .qr-wrap img { width:220px; height:220px; border-radius:var(--r-md); border:4px solid var(--c-primary); margin:0 auto var(--sp-4); display:block; }
    .qr-status { display:inline-flex; align-items:center; gap:8px; padding:var(--sp-2) var(--sp-4); border-radius:var(--r-full); font-size:var(--text-sm); font-weight:600; margin-bottom:var(--sp-4); }
    .qr-status.conectado  { background:var(--c-success-bg); color:#86efac; }
    .qr-status.pendente   { background:var(--c-warning-bg); color:#fde68a; }
    .qr-status.desconectado { background:var(--c-danger-bg); color:#fca5a5; }

    /* ── GRUPOS TABLE ── */
    .grupos-list { display:flex; flex-direction:column; gap:var(--sp-2); margin-top:var(--sp-4); }
    .grupo-item {
      display:flex; align-items:center; justify-content:space-between;
      background:var(--c-bg-card); border:1px solid var(--c-border);
      border-radius:var(--r-md); padding:var(--sp-3) var(--sp-4);
    }
    .grupo-item .grupo-nome { font-size:var(--text-sm); font-weight:500; }
    .grupo-item .grupo-actions { display:flex; gap:var(--sp-2); align-items:center; }
    .toggle-btn {
      width:44px; height:24px; border-radius:var(--r-full); border:none; cursor:pointer;
      position:relative; transition:var(--t); flex-shrink:0;
    }
    .toggle-btn.on  { background:var(--c-success); }
    .toggle-btn.off { background:var(--c-bg-surface); }
    .toggle-btn::after {
      content:''; position:absolute; top:3px; width:18px; height:18px;
      background:#fff; border-radius:50%; transition:var(--t);
    }
    .toggle-btn.on::after  { left:23px; }
    .toggle-btn.off::after { left:3px; }

    /* ── COLOR PREVIEW ── */
    .color-preview { display:flex; gap:var(--sp-3); align-items:center; margin-top:var(--sp-2); }
    .color-swatch { width:36px; height:36px; border-radius:var(--r-md); border:2px solid var(--c-border); }

    /* ── PUBLICAÇÕES ── */
    .pub-list { display:flex; flex-direction:column; gap:var(--sp-2); }
    .pub-item {
      background:var(--c-bg-card); border:1px solid var(--c-border);
      border-radius:var(--r-md); padding:var(--sp-3) var(--sp-4);
      display:flex; align-items:center; justify-content:space-between;
    }
    .pub-titulo { font-size:var(--text-sm); font-weight:500; }
    .pub-meta   { font-size:var(--text-xs); color:var(--c-text-faint); }
    .pub-link   { font-size:var(--text-xs); color:var(--c-primary); text-decoration:none; }

    /* ── SPINNER ── */
    .spinner { border:3px solid var(--c-border); border-top-color:var(--c-primary); border-radius:50%; width:32px; height:32px; animation:spin .8s linear infinite; margin:var(--sp-4) auto; }
    @keyframes spin { to { transform:rotate(360deg); } }

    /* ── SAVE BAR ── */
    .save-bar {
      position:sticky; bottom:0; background:var(--c-bg-card);
      border-top:1px solid var(--c-border); padding:var(--sp-4) var(--sp-6);
      display:flex; align-items:center; justify-content:flex-end; gap:var(--sp-3);
      margin:-var(--sp-8); /* compensate main padding */
    }
    .save-feedback { font-size:var(--text-sm); color:var(--c-success); display:none; }
  </style>
</head>
<body>

<!-- ════ LOGIN ════════════════════════════════════════════════════ -->
<div class="login-wrap" id="loginWrap">
  <div class="login-box">
    <div class="login-logo">
      <div class="icon">🗳️</div>
      <div>
        <h1>Plataforma Candidatos</h1>
        <p>Acesso do usuário</p>
      </div>
    </div>
    <div class="form-group">
      <label>E-mail</label>
      <input id="loginEmail" class="input" type="email" placeholder="seu@email.com" autofocus>
    </div>
    <div class="form-group">
      <label>Senha</label>
      <input id="loginSenha" class="input" type="password" placeholder="••••••••">
    </div>
    <div id="loginErro" style="display:none;margin-bottom:var(--sp-4)" class="alert alert-danger"></div>
    <button class="btn btn-primary" style="width:100%" onclick="fazerLogin()">Entrar</button>
  </div>
</div>

<!-- ════ APP ══════════════════════════════════════════════════════ -->
<div class="app" id="app">
  <header>
    <div class="header-logo">
      <div class="icon">🗳️</div>
      <span id="nomeHeader">Meu Painel</span>
    </div>
    <div class="header-actions">
      <button class="btn btn-ghost btn-sm" onclick="sair()">Sair</button>
    </div>
  </header>

  <main>
    <!-- ── ABAS ── -->
    <div class="tabs">
      <button class="tab-btn active" onclick="aba('visao-geral', this)">Visão Geral</button>
      <button class="tab-btn"       onclick="aba('wordpress',   this)">WordPress</button>
      <button class="tab-btn"       onclick="aba('social',      this)">Facebook & Instagram</button>
      <button class="tab-btn"       onclick="aba('whatsapp',    this)">WhatsApp</button>
      <button class="tab-btn"       onclick="aba('aparencia',   this)">Aparência</button>
    </div>

    <!-- ══════ ABA: VISÃO GERAL ══════ -->
    <div class="tab-pane active" id="pane-visao-geral">
      <div class="status-grid" id="statusGrid">
        <div class="spinner"></div>
      </div>
      <div class="section">
        <div class="section-title">Últimas publicações</div>
        <div class="pub-list" id="pubList">
          <div class="spinner"></div>
        </div>
      </div>
    </div>

    <!-- ══════ ABA: WORDPRESS ══════ -->
    <div class="tab-pane" id="pane-wordpress">
      <div class="section">
        <div class="section-title">Configuração do WordPress</div>
        <div class="form-group">
          <label>URL do site WordPress</label>
          <input id="wpUrl" class="input" type="url" placeholder="https://suacampanha.com.br">
          <span class="hint">Endereço completo do seu site, sem barra no final.</span>
        </div>
        <div class="form-group">
          <label>Chave do Plugin CampanhaPress</label>
          <input id="wpPluginKey" class="input" type="text" placeholder="cpub_xxxxxxxxxxxx">
          <span class="hint">Gerada no menu <strong>CampanhaPress &rarr; Configurações</strong> no painel WordPress.</span>
        </div>
        <div id="wpPluginKeyAviso" style="display:none" class="form-group">
          <p class="hint" style="color:var(--c-warning)">⚠️ Sem chave do plugin, o sistema usará usuário + senha (Application Password).</p>
        </div>
        <div id="wpFallbackFields" style="display:none">
          <div class="form-row">
            <div class="form-group">
              <label>Usuário WordPress</label>
              <input id="wpUsuario" class="input" type="text" placeholder="admin">
            </div>
            <div class="form-group">
              <label>Application Password</label>
              <input id="wpSenha" class="input" type="password" placeholder="xxxx xxxx xxxx xxxx">
              <span class="hint">Não é sua senha normal. Gerado em WordPress &rarr; Perfil &rarr; Application Passwords.</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tutorial WordPress -->
      <details class="tutorial">
        <summary>Como instalar o plugin CampanhaPress</summary>
        <div class="tutorial-body">
          <p style="font-size:var(--text-sm);color:var(--c-text-muted);margin-bottom:var(--sp-2)">
            O plugin CampanhaPress conecta o seu WordPress à plataforma. Siga os passos abaixo:
          </p>
          <ol class="tutorial-steps">
            <li><p>Acesse o painel do seu WordPress em <strong>Plugins &rarr; Adicionar novo &rarr; Enviar plugin</strong>.</p></li>
            <li><p>Solicite ao administrador da plataforma o arquivo <strong>campanhapress.zip</strong> e faça o upload.</p></li>
            <li><p>Clique em <strong>Instalar agora</strong> e depois em <strong>Ativar plugin</strong>.</p></li>
            <li><p>No menu lateral do WordPress, clique em <strong>CampanhaPress</strong>.</p></li>
            <li><p>Copie a <strong>Chave de API</strong> exibida na tela (começa com <code>cpub_</code>).</p></li>
            <li><p>Cole a chave no campo <strong>"Chave do Plugin CampanhaPress"</strong> acima e clique em Salvar.</p></li>
          </ol>
          <div class="tutorial-note">
            ⚠️ A chave de API não deve ser compartilhada. Se suspeitar de uso indevido, regenere a chave no painel WordPress.
          </div>
        </div>
      </details>

      <div style="display:flex;justify-content:flex-end;margin-top:var(--sp-6);gap:var(--sp-3);align-items:center">
        <span class="save-feedback" id="wpFeedback">✅ Salvo!</span>
        <button class="btn btn-primary" onclick="salvarWordPress()">Salvar WordPress</button>
      </div>
    </div>

    <!-- ══════ ABA: FACEBOOK & INSTAGRAM ══════ -->
    <div class="tab-pane" id="pane-social">
      <div class="section">
        <div class="section-title">Facebook</div>
        <div class="form-row">
          <div class="form-group">
            <label>ID da Página Facebook</label>
            <input id="fbPageId" class="input" type="text" placeholder="123456789012345">
            <span class="hint">Encontrado em Configurações da Página &rarr; Sobre &rarr; ID da Página.</span>
          </div>
          <div class="form-group">
            <label>Token de Acesso da Página</label>
            <input id="fbToken" class="input" type="text" placeholder="EAABsbCS...">
            <span class="hint">Page Access Token (não User Token). Veja o tutorial abaixo.</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Instagram</div>
        <div class="form-group" style="max-width:400px">
          <label>ID do Usuário Instagram Business</label>
          <input id="igUserId" class="input" type="text" placeholder="17841400000000000">
          <span class="hint">Diferente do ID da Página. Veja o tutorial abaixo para encontrá-lo.</span>
        </div>
      </div>

      <!-- Tutorial Facebook -->
      <details class="tutorial">
        <summary>Como obter o Token do Facebook e ID do Instagram</summary>
        <div class="tutorial-body">
          <p style="font-size:var(--text-sm);color:var(--c-text-muted);margin-bottom:var(--sp-3)">
            Você precisará de uma conta de desenvolvedor Facebook. O processo leva cerca de 10 minutos.
          </p>

          <p style="font-size:var(--text-xs);font-weight:700;color:var(--c-text-faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:var(--sp-2)">Parte 1 — Preparação</p>
          <ol class="tutorial-steps">
            <li><p>Acesse <strong>developers.facebook.com</strong> e faça login com sua conta pessoal do Facebook.</p></li>
            <li><p>Clique em <strong>Meus Apps &rarr; Criar App</strong>. Escolha o tipo <strong>"Outro"</strong> e depois <strong>"Business"</strong>. Dê um nome qualquer.</p></li>
            <li><p>No app criado, vá em <strong>Adicionar Produtos</strong> e adicione <strong>Instagram Graph API</strong> e <strong>Facebook Login</strong>.</p></li>
          </ol>

          <p style="font-size:var(--text-xs);font-weight:700;color:var(--c-text-faint);text-transform:uppercase;letter-spacing:.06em;margin:var(--sp-4) 0 var(--sp-2)">Parte 2 — Gerar o Page Access Token</p>
          <ol class="tutorial-steps">
            <li><p>Acesse o <strong>Graph API Explorer</strong>: <code>developers.facebook.com/tools/explorer</code></p></li>
            <li><p>Selecione seu App no dropdown à direita. Em <strong>Permissões</strong>, adicione: <code>pages_manage_posts</code>, <code>pages_read_engagement</code>, <code>pages_show_list</code>, <code>instagram_basic</code>, <code>instagram_content_publish</code>.</p></li>
            <li><p>Clique em <strong>Gerar token de acesso</strong> e autorize.</p></li>
            <li><p><strong>Importante:</strong> No dropdown "Usuário ou Página", troque de <em>Token do usuário</em> para o nome da sua <strong>Página</strong>. O token no campo muda — esse é o Page Token.</p></li>
            <li><p>Confirme: faça um <code>GET /me?fields=name,id</code>. O resultado deve mostrar o nome da <strong>página</strong>, não o seu nome pessoal.</p></li>
            <li><p>Copie o token e cole no campo <strong>"Token de Acesso da Página"</strong> acima.</p></li>
          </ol>

          <p style="font-size:var(--text-xs);font-weight:700;color:var(--c-text-faint);text-transform:uppercase;letter-spacing:.06em;margin:var(--sp-4) 0 var(--sp-2)">Parte 3 — ID do Instagram Business</p>
          <ol class="tutorial-steps">
            <li><p>Ainda no Graph API Explorer, com o token gerado, faça: <code>GET /me/accounts</code>.</p></li>
            <li><p>Na resposta, encontre sua página e copie o <code>id</code> da página.</p></li>
            <li><p>Agora faça: <code>GET /{id-da-pagina}?fields=instagram_business_account</code>.</p></li>
            <li><p>O campo <code>instagram_business_account.id</code> é o seu <strong>ID do Instagram Business</strong>. Copie e cole no campo acima.</p></li>
          </ol>

          <div class="tutorial-note">
            ⚠️ O token gerado no Explorer dura apenas 1-2 horas. Para uso permanente, o administrador da plataforma precisará configurar um token de longa duração.
          </div>
        </div>
      </details>

      <div style="display:flex;justify-content:flex-end;margin-top:var(--sp-6);gap:var(--sp-3);align-items:center">
        <span class="save-feedback" id="socialFeedback">✅ Salvo!</span>
        <button class="btn btn-primary" onclick="salvarSocial()">Salvar Facebook & Instagram</button>
      </div>
    </div>

    <!-- ══════ ABA: WHATSAPP ══════ -->
    <div class="tab-pane" id="pane-whatsapp">
      <div class="section">
        <div class="section-title">Conexão WhatsApp</div>
        <div class="qr-wrap" id="qrWrap">
          <div class="spinner"></div>
        </div>
        <div style="display:flex;gap:var(--sp-3);justify-content:center;margin-bottom:var(--sp-6)">
          <button class="btn btn-secondary" onclick="carregarQR()">🔄 Gerar novo QR</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Grupos de distribuição</div>
        <p style="font-size:var(--text-sm);color:var(--c-text-muted);margin-bottom:var(--sp-4)">
          Ative os grupos para os quais as matérias serão enviadas automaticamente. O número do WhatsApp precisa estar dentro do grupo para ele aparecer aqui.
        </p>
        <button class="btn btn-secondary btn-sm" onclick="sincronizarGrupos()" style="margin-bottom:var(--sp-4)">🔄 Sincronizar grupos</button>
        <div class="grupos-list" id="gruposList">
          <div class="spinner"></div>
        </div>
      </div>

      <!-- Tutorial WhatsApp -->
      <details class="tutorial" style="margin-top:var(--sp-4)">
        <summary>Como conectar o WhatsApp</summary>
        <div class="tutorial-body">
          <ol class="tutorial-steps">
            <li><p>O QR code acima expira em cerca de <strong>40 segundos</strong>. Se expirar, clique em "Gerar novo QR".</p></li>
            <li><p>No celular da campanha, abra o <strong>WhatsApp</strong> e toque nos <strong>três pontos (⋮)</strong>.</p></li>
            <li><p>Selecione <strong>Aparelhos conectados &rarr; Conectar um aparelho</strong>.</p></li>
            <li><p>Aponte a câmera para o QR code. O status mudará para <strong>Conectado ✅</strong> automaticamente.</p></li>
            <li><p>Após conectar, clique em <strong>Sincronizar grupos</strong> para que os grupos do WhatsApp apareçam na lista.</p></li>
            <li><p>Ative os grupos que devem receber as matérias clicando no toggle ao lado de cada um.</p></li>
          </ol>
          <div class="tutorial-note">
            ⚠️ O número conectado <strong>precisa estar dentro</strong> dos grupos desejados. Grupos dos quais o número não participa não aparecerão na lista.
          </div>
        </div>
      </details>
    </div>

    <!-- ══════ ABA: APARÊNCIA ══════ -->
    <div class="tab-pane" id="pane-aparencia">
      <div class="section">
        <div class="section-title">Identidade Visual</div>
        <p style="font-size:var(--text-sm);color:var(--c-text-muted);margin-bottom:var(--sp-5)">
          Esses dados são usados no card social 1080×1080 que acompanha as matérias no WhatsApp, Facebook e Instagram.
        </p>
        <div class="form-row">
          <div class="form-group">
            <label>URL do Logo</label>
            <input id="logoUrl" class="input" type="url" placeholder="https://suacampanha.com.br/logo.png"
              oninput="previewLogo(this.value)">
            <span class="hint">Link público de uma imagem PNG ou JPG do logo (recomendado: fundo transparente).</span>
          </div>
          <div class="form-group">
            <label>Cor da Campanha</label>
            <div style="display:flex;gap:var(--sp-3);align-items:center">
              <input id="brandColor" class="input" type="color" value="#f97316"
                oninput="previewColor(this.value)" style="width:60px;height:40px;padding:2px;cursor:pointer">
              <input id="brandColorHex" class="input" type="text" value="#f97316" style="flex:1"
                oninput="syncColor(this.value)" placeholder="#f97316">
            </div>
            <span class="hint">Cor de destaque usada no gradiente e no badge do chapéu do card social.</span>
          </div>
        </div>

        <!-- Preview do logo -->
        <div id="logoPreview" style="display:none;margin-top:var(--sp-4)">
          <div class="section-title">Preview do logo</div>
          <img id="logoPreviewImg" src="" alt="preview logo"
            style="max-height:80px;max-width:200px;border-radius:var(--r-md);background:var(--c-bg-surface);padding:var(--sp-3)">
        </div>

        <div class="form-group" style="margin-top:var(--sp-4)">
          <label style="display:flex;align-items:center;gap:var(--sp-2);cursor:pointer;text-transform:none;font-size:var(--text-sm);font-weight:500">
            <input type="checkbox" id="gerarCard" style="width:16px;height:16px">
            Gerar card social automático nas publicações
          </label>
          <span class="hint" style="margin-top:var(--sp-1)">
            Quando ativo, cada matéria publicada gera automaticamente um card 1080×1080 para WhatsApp, Facebook e Instagram.
          </span>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:var(--sp-6);gap:var(--sp-3);align-items:center">
        <span class="save-feedback" id="aparenciaFeedback">✅ Salvo!</span>
        <button class="btn btn-primary" onclick="salvarAparencia()">Salvar Aparência</button>
      </div>
    </div>
  </main>
</div>

<script>
/* ══════════════════════════════════════════════════════════
   PLATAFORMA CANDIDATOS — PAINEL DO USUÁRIO
══════════════════════════════════════════════════════════ */

let token = localStorage.getItem('user_token');
let cliente = null;

// ── AUTH ────────────────────────────────────────────────

async function fazerLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value;
  const erroEl = document.getElementById('loginErro');
  erroEl.style.display = 'none';

  try {
    const r = await fetch('/api/auth/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await r.json();
    if (!r.ok) {
      erroEl.textContent = data.erro || 'Erro ao fazer login';
      erroEl.style.display = 'block';
      return;
    }
    localStorage.setItem('user_token', data.token);
    token = data.token;
    iniciarApp(data.nome);
  } catch {
    erroEl.textContent = 'Erro de conexão. Tente novamente.';
    erroEl.style.display = 'block';
  }
}

function sair() {
  localStorage.removeItem('user_token');
  location.reload();
}

document.getElementById('loginSenha').addEventListener('keydown', e => {
  if (e.key === 'Enter') fazerLogin();
});

// ── INICIALIZAÇÃO ───────────────────────────────────────

async function iniciarApp(nome) {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  if (nome) document.getElementById('nomeHeader').textContent = nome;

  await carregarDados();
  carregarVisaoGeral();
  carregarQR();
  carregarGrupos();
}

async function carregarDados() {
  const r = await api('GET', '/api/me');
  if (!r) return;
  cliente = r;

  document.getElementById('nomeHeader').textContent = r.nome || 'Meu Painel';

  // WordPress
  document.getElementById('wpUrl').value       = r.wp_url       || '';
  document.getElementById('wpPluginKey').value = r.wp_plugin_key || '';
  document.getElementById('wpUsuario').value   = r.wp_usuario    || '';
  toggleWpFallback(r.wp_plugin_key);

  // Social
  document.getElementById('fbPageId').value = r.fb_page_id       || '';
  document.getElementById('fbToken').value  = r.fb_access_token  || '';
  document.getElementById('igUserId').value = r.ig_user_id       || '';

  // Aparência
  document.getElementById('logoUrl').value   = r.logo_url     || '';
  document.getElementById('brandColor').value     = r.brand_color || '#f97316';
  document.getElementById('brandColorHex').value  = r.brand_color || '#f97316';
  document.getElementById('gerarCard').checked    = r.gerar_card !== false;
  if (r.logo_url) previewLogo(r.logo_url);
}

// ── ABAS ────────────────────────────────────────────────

function aba(id, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('pane-' + id).classList.add('active');
  btn.classList.add('active');
}

// ── VISÃO GERAL ─────────────────────────────────────────

async function carregarVisaoGeral() {
  const grid = document.getElementById('statusGrid');
  if (!cliente) { grid.innerHTML = '<div class="spinner"></div>'; return; }

  const statusWA = await api('GET', '/api/me/whatsapp/status').catch(() => ({ status: 'erro' }));

  const canais = [
    {
      label: 'WordPress',
      ok: !!(cliente.wp_plugin_key || (cliente.wp_usuario)),
      valor: cliente.wp_url ? new URL(cliente.wp_url).hostname : 'Não configurado',
    },
    {
      label: 'WhatsApp',
      ok: statusWA?.status === 'conectado',
      warn: statusWA?.status === 'pendente',
      valor: statusWA?.status || 'Verificando…',
    },
    {
      label: 'Facebook',
      ok: !!(cliente.fb_page_id && cliente.fb_access_token),
      valor: cliente.fb_page_id ? `ID: ${cliente.fb_page_id}` : 'Não configurado',
    },
    {
      label: 'Instagram',
      ok: !!(cliente.ig_user_id),
      valor: cliente.ig_user_id ? `ID: ${cliente.ig_user_id}` : 'Não configurado',
    },
  ];

  grid.innerHTML = canais.map(c => {
    const dot = c.ok ? 'dot-ok' : c.warn ? 'dot-warn' : 'dot-err';
    const label = c.ok ? 'Configurado' : c.warn ? 'Pendente' : 'Não configurado';
    return `
      <div class="status-card">
        <div class="label">${c.label}</div>
        <div class="value">
          <span class="dot ${dot}"></span>
          ${c.valor}
        </div>
        <div style="font-size:var(--text-xs);color:var(--c-text-faint);margin-top:4px">${label}</div>
      </div>`;
  }).join('');

  // Publicações
  const pubs = await api('GET', '/api/me/publicacoes') || [];
  const pubList = document.getElementById('pubList');
  if (!pubs.length) {
    pubList.innerHTML = '<p style="color:var(--c-text-faint);font-size:var(--text-sm)">Nenhuma publicação ainda.</p>';
    return;
  }
  pubList.innerHTML = pubs.map(p => `
    <div class="pub-item">
      <div>
        <div class="pub-titulo">${p.titulo || 'Sem título'}</div>
        <div class="pub-meta">${new Date(p.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</div>
      </div>
      ${p.wp_post_url ? `<a class="pub-link" href="${p.wp_post_url}" target="_blank">Ver post ↗</a>` : ''}
    </div>`).join('');
}

// ── WORDPRESS ───────────────────────────────────────────

function toggleWpFallback(key) {
  const show = !key;
  document.getElementById('wpFallbackFields').style.display     = show ? 'block' : 'none';
  document.getElementById('wpPluginKeyAviso').style.display     = show ? 'block' : 'none';
}

document.getElementById('wpPluginKey').addEventListener('input', e => toggleWpFallback(e.target.value));

async function salvarWordPress() {
  const body = {
    wp_url:        document.getElementById('wpUrl').value.trim(),
    wp_plugin_key: document.getElementById('wpPluginKey').value.trim() || null,
    wp_usuario:    document.getElementById('wpUsuario').value.trim() || null,
    wp_senha:      document.getElementById('wpSenha').value || null,
  };
  const ok = await api('PATCH', '/api/me', body);
  if (ok) feedback('wpFeedback');
}

// ── FACEBOOK & INSTAGRAM ────────────────────────────────

async function salvarSocial() {
  const body = {
    fb_page_id:      document.getElementById('fbPageId').value.trim() || null,
    fb_access_token: document.getElementById('fbToken').value.trim() || null,
    ig_user_id:      document.getElementById('igUserId').value.trim() || null,
  };
  const ok = await api('PATCH', '/api/me', body);
  if (ok) feedback('socialFeedback');
}

// ── WHATSAPP ────────────────────────────────────────────

let qrPolling = null;

async function carregarQR() {
  clearInterval(qrPolling);
  const wrap = document.getElementById('qrWrap');
  wrap.innerHTML = '<div class="spinner"></div>';

  const statusData = await api('GET', '/api/me/whatsapp/status');
  if (!statusData) return;

  if (statusData.status === 'conectado') {
    wrap.innerHTML = `
      <div class="qr-status conectado">✅ WhatsApp Conectado</div>
      <p style="font-size:var(--text-sm);color:var(--c-text-muted)">Número ativo e pronto para enviar matérias.</p>`;
    return;
  }

  const qrData = await api('GET', '/api/me/whatsapp/qr');
  if (qrData?.qr) {
    wrap.innerHTML = `
      <div class="qr-status pendente">📱 Aguardando pareamento</div>
      <img src="${qrData.qr}" alt="QR Code WhatsApp">
      <p style="font-size:var(--text-xs);color:var(--c-text-faint)">QR expira em ~40s. Clique em "Gerar novo QR" se expirar.</p>`;
    qrPolling = setInterval(carregarQR, 8000);
  } else {
    wrap.innerHTML = `
      <div class="qr-status desconectado">⚠️ WhatsApp desconectado</div>
      <p style="font-size:var(--text-sm);color:var(--c-text-muted);margin-top:var(--sp-3)">Clique em "Gerar novo QR" para iniciar a conexão.</p>`;
  }
}

async function carregarGrupos() {
  const lista = document.getElementById('gruposList');
  const grupos = await api('GET', '/api/me/grupos') || [];

  if (!grupos.length) {
    lista.innerHTML = `<p style="color:var(--c-text-faint);font-size:var(--text-sm)">
      Nenhum grupo cadastrado. Clique em "Sincronizar grupos" após conectar o WhatsApp.
    </p>`;
    return;
  }

  lista.innerHTML = grupos.map(g => `
    <div class="grupo-item">
      <div class="grupo-nome">${g.nome}</div>
      <div class="grupo-actions">
        <span style="font-size:var(--text-xs);color:var(--c-text-faint);margin-right:var(--sp-2)">${g.ativo ? 'Ativo' : 'Inativo'}</span>
        <button class="toggle-btn ${g.ativo ? 'on' : 'off'}" onclick="toggleGrupo(${g.id}, ${!g.ativo}, this)"></button>
        <button class="btn btn-ghost btn-sm" onclick="removerGrupo(${g.id})">✕</button>
      </div>
    </div>`).join('');
}

async function toggleGrupo(id, novoAtivo, btn) {
  btn.classList.toggle('on',  novoAtivo);
  btn.classList.toggle('off', !novoAtivo);
  btn.previousElementSibling.textContent = novoAtivo ? 'Ativo' : 'Inativo';
  await api('PATCH', `/api/me/grupos/${id}`, { ativo: novoAtivo });
}

async function removerGrupo(id) {
  if (!confirm('Remover grupo?')) return;
  await api('DELETE', `/api/me/grupos/${id}`);
  carregarGrupos();
}

async function sincronizarGrupos() {
  const lista = document.getElementById('gruposList');
  lista.innerHTML = '<div class="spinner"></div>';

  const disponiveis = await api('GET', '/api/me/whatsapp/grupos-disponiveis');
  if (!disponiveis?.length) {
    lista.innerHTML = `<p style="color:var(--c-warning);font-size:var(--text-sm)">
      Nenhum grupo encontrado. Verifique se o WhatsApp está conectado e se o número está dentro dos grupos.
    </p>`;
    return;
  }

  const jaExistentes = await api('GET', '/api/me/grupos') || [];
  const jids = new Set(jaExistentes.map(g => g.group_jid));

  let adicionados = 0;
  for (const g of disponiveis) {
    if (!jids.has(g.jid)) {
      await api('POST', '/api/me/grupos', { group_jid: g.jid, nome: g.nome });
      adicionados++;
    }
  }

  await carregarGrupos();
  if (adicionados > 0) {
    alert(`${adicionados} grupo(s) adicionado(s). Ative os grupos desejados na lista.`);
  }
}

// ── APARÊNCIA ───────────────────────────────────────────

function previewLogo(url) {
  const wrap = document.getElementById('logoPreview');
  const img  = document.getElementById('logoPreviewImg');
  if (url) {
    img.src = url;
    wrap.style.display = 'block';
  } else {
    wrap.style.display = 'none';
  }
}

function previewColor(val) {
  document.getElementById('brandColorHex').value = val;
}

function syncColor(val) {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    document.getElementById('brandColor').value = val;
  }
}

async function salvarAparencia() {
  const body = {
    logo_url:    document.getElementById('logoUrl').value.trim() || null,
    brand_color: document.getElementById('brandColorHex').value.trim() || '#f97316',
    gerar_card:  document.getElementById('gerarCard').checked,
  };
  const ok = await api('PATCH', '/api/me', body);
  if (ok) feedback('aparenciaFeedback');
}

// ── UTILITÁRIOS ─────────────────────────────────────────

async function api(method, url, body) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    if (r.status === 401) { sair(); return null; }
    return await r.json();
  } catch {
    return null;
  }
}

function feedback(id) {
  const el = document.getElementById(id);
  el.style.display = 'inline';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ── BOOT ────────────────────────────────────────────────

if (token) {
  iniciarApp();
}
</script>
</body>
</html>
```

- [ ] **Step 2: Verificar que o arquivo foi criado**

```bash
ls -la frontend/painel/index.html
```

- [ ] **Step 3: Testar no browser**

Acesse `http://localhost:3003/painel` — deve aparecer a tela de login do usuário (não o painel admin).

- [ ] **Step 4: Commit**

```bash
git add frontend/painel/index.html
git commit -m "feat: painel do usuario — login + 5 abas + tutoriais"
```

---

## Task 6: Painel admin — campos de acesso do usuário

**Files:**
- Modify: `frontend/admin/index.html`

O objetivo é adicionar uma seção **"Acesso do usuário"** no drawer de edição do cliente, permitindo que o admin cadastre ou redefina e-mail e senha do usuário.

- [ ] **Step 1: Localizar onde adicionar no HTML**

No `frontend/admin/index.html`, dentro do drawer de edição (buscar por `"tab-pane"` ou pela última aba do formulário). Adicionar uma nova aba ou uma seção extra na aba "Configurações" ou equivalente.

> Obs: o drawer tem abas. Encontre o bloco `<div class="tabs">` dentro do drawer e adicione a aba "Acesso".

- [ ] **Step 2: Adicionar aba "Acesso" nas tabs do drawer**

Localizar o bloco de tabs do drawer e adicionar:

```html
<button class="tab-btn" onclick="drawerAba('acesso', this)">Acesso</button>
```

- [ ] **Step 3: Adicionar o painel da aba "Acesso"**

```html
<div class="tab-pane" id="dpane-acesso">
  <p style="font-size:var(--text-sm);color:var(--c-text-muted);margin-bottom:var(--sp-4)">
    Credenciais que o candidato usa para acessar o painel self-service em <code>/painel</code>.
  </p>
  <div class="form-group">
    <label>E-mail de acesso</label>
    <input id="dUserEmail" class="input" type="email" placeholder="candidato@email.com">
  </div>
  <div class="form-group">
    <label>Nova senha</label>
    <input id="dUserSenha" class="input" type="password" placeholder="Deixe em branco para não alterar">
    <span class="hint">Mínimo 8 caracteres. Deixe vazio para manter a senha atual.</span>
  </div>
  <div id="painelLink" style="display:none;margin-top:var(--sp-4)">
    <p style="font-size:var(--text-xs);color:var(--c-text-faint)">Link do painel do usuário:</p>
    <code id="painelLinkUrl" style="font-size:var(--text-xs);color:var(--c-primary)"></code>
  </div>
</div>
```

- [ ] **Step 4: Carregar e salvar os dados na função JS do drawer**

Na função que carrega o cliente no drawer (provavelmente `abrirDrawer(id)` ou similar), adicionar:

```js
document.getElementById('dUserEmail').value = c.user_email || '';
document.getElementById('dUserSenha').value = '';
// Mostrar link do painel se e-mail configurado
if (c.user_email) {
  document.getElementById('painelLink').style.display = 'block';
  document.getElementById('painelLinkUrl').textContent = `${location.origin}/painel`;
}
```

Na função que salva o cliente, incluir os campos novos no PATCH:

```js
// Campos de acesso do usuário
const userEmail = document.getElementById('dUserEmail').value.trim();
const userSenha = document.getElementById('dUserSenha').value;
if (userEmail) body.user_email = userEmail;
if (userSenha) body.user_senha_raw = userSenha;
```

- [ ] **Step 5: Adicionar endpoint no admin para salvar e-mail + hash de senha**

No arquivo `backend/routes/clientes.js`, verificar que o topo já importa bcryptjs (já deve ter, mas confirmar). Se não tiver:
```js
const bcrypt = require('bcryptjs');
```

No PATCH de `clientes.js`, adicionar após a lógica de hot-reload do bot:

```js
// Campos de acesso do usuário (admin)
if (req.body.user_email !== undefined) {
  updates.push(`user_email = $${i++}`);
  values.push(req.body.user_email ? req.body.user_email.toLowerCase().trim() : null);
}
if (req.body.user_senha_raw) {
  if (req.body.user_senha_raw.length < 8) {
    return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' });
  }
  const hash = bcrypt.hashSync(req.body.user_senha_raw, 10);
  updates.push(`user_password_hash = $${i++}`);
  values.push(hash);
}
```

- [ ] **Step 6: Proteger `user_password_hash` no `GET /:id` do admin**

No `GET /:id` de `clientes.js`, onde já existe `delete cliente.wp_senha`, adicionar logo abaixo:

```js
delete cliente.wp_senha;
delete cliente.user_password_hash; // nunca expõe hash de senha
```

- [ ] **Step 7: Testar o fluxo completo**

1. Admin cadastra e-mail + senha para um cliente.
2. Acessar `http://localhost:3003/painel`, fazer login com e-mail + senha.
3. Verificar que os dados do cliente correto aparecem.
4. Tentar acessar `GET /api/clientes` com o token do usuário → deve retornar 401.
5. Salvar uma configuração (ex: URL do WordPress) e confirmar no banco.

- [ ] **Step 8: Commit**

```bash
git add frontend/admin/index.html backend/routes/clientes.js
git commit -m "feat: admin — campos de acesso do usuario; protege user_password_hash na API"
```

---

## Checklist de verificação final

- [ ] Login com e-mail/senha do usuário funciona e retorna JWT com `role: 'user'`
- [ ] JWT expirado ou admin JWT em `/api/me` retorna 401
- [ ] Usuário A não consegue ver dados do usuário B (testar com dois clientes)
- [ ] Salvar WordPress atualiza `wp_url` e `wp_plugin_key` no banco
- [ ] Salvar Facebook/Instagram atualiza os campos corretos
- [ ] QR code carrega e polling para quando status = `conectado`
- [ ] Sincronizar grupos adiciona os grupos disponíveis sem duplicar
- [ ] Toggle de grupo ativa/desativa com isolamento por `cliente_id`
- [ ] Salvar Aparência persiste `logo_url`, `brand_color`, `gerar_card`
- [ ] Rota `/painel*` no server serve o HTML correto
- [ ] Rota `/admin*` continua servindo o painel admin sem alteração
- [ ] GitHub Actions faz deploy sem erro após as mudanças

---

## Considerações de segurança

- `user_senha_raw` nunca é armazenado — só o hash bcrypt (10 rounds)
- `wp_senha`, `token_qr`, `evolution_instancia` e `user_password_hash` são deletados antes de retornar na `GET /me`
- PATCH em `/api/me` só atualiza `CAMPOS_PERMITIDOS` — slug, nome, telegram_bot_token, wp_post_format nunca alteráveis pelo usuário
- `authUserMiddleware` rejeita qualquer token sem `role: 'user'` (bloqueia tokens admin em `/api/me`)
- `authMiddleware` admin verifica `payload.admin === true` (bloqueia tokens de usuário em `/api/clientes`)
- `user_password_hash` excluído do `GET /api/clientes/:id` para não vazar pelo painel admin
