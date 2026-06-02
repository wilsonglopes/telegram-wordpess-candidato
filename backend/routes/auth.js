'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { query } = require('../db');
const settings = require('../settings.json');

const router = express.Router();

// Hash legado (compatibilidade com settings.admin_password)
const SENHA_HASH_LEGADO = bcrypt.hashSync(settings.admin_password, 10);

// Login — aceita { email, senha } (tabela admins) OU { senha } (legado settings)
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!senha) return res.status(400).json({ erro: 'Senha obrigatória' });

  // Modo novo: email + senha → verifica tabela admins
  if (email) {
    try {
      const { rows } = await query(
        `SELECT id, nome, password_hash FROM admins WHERE email = $1 AND ativo = true`,
        [email.toLowerCase().trim()]
      );
      const admin = rows[0];
      if (!admin || !bcrypt.compareSync(senha, admin.password_hash)) {
        return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
      }
      const token = jwt.sign(
        { admin: true, adminId: admin.id, nome: admin.nome },
        settings.jwt_secret,
        { expiresIn: '7d' }
      );
      return res.json({ token, nome: admin.nome });
    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // Modo legado: só senha → verifica settings.admin_password
  if (!bcrypt.compareSync(senha, SENHA_HASH_LEGADO)) {
    return res.status(401).json({ erro: 'Senha inválida' });
  }
  const token = jwt.sign({ admin: true }, settings.jwt_secret, { expiresIn: '7d' });
  return res.json({ token });
});

// Login do cliente (usuário da plataforma)
router.post('/user/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'email e senha obrigatórios' });

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

// Middleware admin — rejeita tokens de usuário (verifica payload.admin)
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

// Middleware usuário — rejeita tokens admin (verifica role: 'user')
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

// ── CRUD de Administradores ───────────────────────────────────────────────────

// GET /api/auth/admins — lista todos os admins
router.get('/admins', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, nome, email, ativo, criado_em FROM admins ORDER BY criado_em`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/auth/admins — cria novo admin
router.post('/admins', authMiddleware, async (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha)
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  if (senha.length < 8)
    return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' });
  try {
    const hash = bcrypt.hashSync(senha, 10);
    const { rows } = await query(
      `INSERT INTO admins (nome, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, nome, email, criado_em`,
      [nome.trim(), email.toLowerCase().trim(), hash]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'E-mail já cadastrado' });
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/auth/admins/:id — atualiza nome, senha ou status
router.patch('/admins/:id', authMiddleware, async (req, res) => {
  const { nome, senha, ativo } = req.body;
  const updates = [], values = [];
  let i = 1;
  if (nome  !== undefined) { updates.push(`nome = $${i++}`);  values.push(nome); }
  if (ativo !== undefined) { updates.push(`ativo = $${i++}`); values.push(ativo); }
  if (senha) {
    if (senha.length < 8)
      return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' });
    updates.push(`password_hash = $${i++}`);
    values.push(bcrypt.hashSync(senha, 10));
  }
  if (!updates.length) return res.status(400).json({ erro: 'Nada para atualizar' });
  values.push(req.params.id);
  try {
    await query(`UPDATE admins SET ${updates.join(', ')} WHERE id = $${i}`, values);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/auth/admins/:id — remove admin (protege último admin ativo)
router.delete('/admins/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(`SELECT COUNT(*) AS c FROM admins WHERE ativo = true`);
    if (parseInt(rows[0].c) <= 1)
      return res.status(400).json({ erro: 'Não é possível remover o último administrador ativo' });
    await query(`DELETE FROM admins WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
module.exports.authMiddleware     = authMiddleware;
module.exports.authUserMiddleware = authUserMiddleware;
