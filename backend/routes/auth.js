'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { query } = require('../db');
const settings = require('../settings.json');

const router = express.Router();

// Hash da senha admin gerado no startup
const SENHA_HASH = bcrypt.hashSync(settings.admin_password, 10);

// Login do administrador
router.post('/login', (req, res) => {
  const { senha } = req.body;
  if (!senha || !bcrypt.compareSync(senha, SENHA_HASH)) {
    return res.status(401).json({ erro: 'Senha inválida' });
  }
  const token = jwt.sign({ admin: true }, settings.jwt_secret, { expiresIn: '7d' });
  res.json({ token });
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

module.exports = router;
module.exports.authMiddleware     = authMiddleware;
module.exports.authUserMiddleware = authUserMiddleware;
