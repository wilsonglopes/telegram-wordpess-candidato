'use strict';

const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('./auth');
const { criarInstancia } = require('../connectors/evolution');
const { iniciarBot } = require('../bot');

const router = express.Router();
router.use(authMiddleware);

// Lista todos os clientes
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`SELECT id, nome, slug, wp_url, whatsapp_status, ativo, criado_em FROM clientes ORDER BY criado_em DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Busca um cliente
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM clientes WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Não encontrado' });
    const cliente = { ...rows[0] };
    delete cliente.wp_senha; // nunca expõe senha
    res.json(cliente);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Cria novo cliente
router.post('/', async (req, res) => {
  try {
    const { nome, slug, wp_url, wp_usuario, wp_senha, telegram_bot_token, ai_prompt } = req.body;
    if (!nome || !slug || !wp_url || !wp_usuario || !wp_senha) {
      return res.status(400).json({ erro: 'Campos obrigatórios: nome, slug, wp_url, wp_usuario, wp_senha' });
    }

    const instancia = `candidato-${slug}`;

    const { rows } = await query(
      `INSERT INTO clientes (nome, slug, wp_url, wp_usuario, wp_senha, evolution_instancia, telegram_bot_token, ai_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [nome, slug, wp_url, wp_usuario, wp_senha, instancia, telegram_bot_token || null, ai_prompt || null]
    );

    // Cria instância na Evolution API
    try {
      await criarInstancia(instancia);
    } catch (err) {
      console.warn('[clientes] Evolution API não disponível ainda:', err.message);
    }

    // Inicia bot Telegram se token fornecido
    if (telegram_bot_token) {
      try { iniciarBot(rows[0]); } catch {}
    }

    res.status(201).json({ id: rows[0].id, token_qr: rows[0].token_qr });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Atualiza cliente
router.patch('/:id', async (req, res) => {
  try {
    const campos = ['nome', 'wp_url', 'wp_usuario', 'wp_senha', 'telegram_bot_token', 'ai_prompt', 'ativo'];
    const updates = [];
    const values  = [];
    let i = 1;
    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        updates.push(`${campo} = $${i++}`);
        values.push(req.body[campo]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ erro: 'Nada para atualizar' });
    values.push(req.params.id);
    await query(`UPDATE clientes SET ${updates.join(', ')} WHERE id = $${i}`, values);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Grupos do cliente
router.get('/:id/grupos', async (req, res) => {
  const { rows } = await query(`SELECT * FROM grupos_whatsapp WHERE cliente_id = $1`, [req.params.id]);
  res.json(rows);
});

router.post('/:id/grupos', async (req, res) => {
  const { group_jid, nome } = req.body;
  await query(`INSERT INTO grupos_whatsapp (cliente_id, group_jid, nome) VALUES ($1, $2, $3)`, [req.params.id, group_jid, nome]);
  res.status(201).json({ ok: true });
});

router.delete('/:id/grupos/:gid', async (req, res) => {
  await query(`DELETE FROM grupos_whatsapp WHERE id = $1 AND cliente_id = $2`, [req.params.gid, req.params.id]);
  res.json({ ok: true });
});

// Assessores do cliente
router.get('/:id/assessores', async (req, res) => {
  const { rows } = await query(`SELECT * FROM assessores WHERE cliente_id = $1`, [req.params.id]);
  res.json(rows);
});

router.post('/:id/assessores', async (req, res) => {
  const { telegram_user_id, nome } = req.body;
  await query(`INSERT INTO assessores (cliente_id, telegram_user_id, nome) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [req.params.id, telegram_user_id, nome]);
  res.status(201).json({ ok: true });
});

router.delete('/:id/assessores/:aid', async (req, res) => {
  await query(`DELETE FROM assessores WHERE id = $1 AND cliente_id = $2`, [req.params.aid, req.params.id]);
  res.json({ ok: true });
});

// Publicações do cliente
router.get('/:id/publicacoes', async (req, res) => {
  const { rows } = await query(`SELECT * FROM publicacoes WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 50`, [req.params.id]);
  res.json(rows);
});

module.exports = router;
