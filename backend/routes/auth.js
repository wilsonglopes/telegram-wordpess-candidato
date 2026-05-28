'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const settings = require('../settings.json');

const router = express.Router();

// Hash da senha admin gerado no startup (ou usar bcrypt.hashSync direto no settings)
const SENHA_HASH = bcrypt.hashSync(settings.admin_password, 10);

router.post('/login', (req, res) => {
  const { senha } = req.body;
  if (!senha || !bcrypt.compareSync(senha, SENHA_HASH)) {
    return res.status(401).json({ erro: 'Senha inválida' });
  }
  const token = jwt.sign({ admin: true }, settings.jwt_secret, { expiresIn: '7d' });
  res.json({ token });
});

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

module.exports = router;
module.exports.authMiddleware = authMiddleware;
