'use strict';

const express = require('express');
const { query }              = require('../db');
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

// ── DADOS PRÓPRIOS ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM clientes WHERE id = $1`, [req.clienteId]);
    if (!rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const c = { ...rows[0] };
    delete c.wp_senha;
    delete c.token_qr;
    delete c.evolution_instancia;
    delete c.user_password_hash;
    res.json(c);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

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
