'use strict';

const express = require('express');
const { query } = require('../db');
const { obterQRCode, statusConexao, listarGrupos, desconectarInstancia } = require('../connectors/evolution');

const router = express.Router();

// Rota pública — usada pela página /conectar/:token
router.get('/qr/:token', async (req, res) => {
  try {
    const { rows } = await query(`SELECT id, nome, evolution_instancia, whatsapp_status FROM clientes WHERE token_qr = $1 AND ativo = true`, [req.params.token]);
    if (!rows[0]) return res.status(404).json({ erro: 'Link inválido' });

    const cliente = rows[0];
    const status  = await statusConexao(cliente.evolution_instancia);

    if (status === 'open') {
      await query(`UPDATE clientes SET whatsapp_status = 'conectado' WHERE id = $1`, [cliente.id]);
      return res.json({ status: 'conectado', nome: cliente.nome });
    }

    const qr = await obterQRCode(cliente.evolution_instancia);
    res.json({ status: 'pendente', qr, nome: cliente.nome });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Rota autenticada — desconecta WhatsApp da instância
const { authMiddleware } = require('./auth');

router.delete('/desconectar/:clienteId', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT evolution_instancia FROM clientes WHERE id = $1 AND ativo = true`,
      [req.params.clienteId]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });

    await desconectarInstancia(rows[0].evolution_instancia);
    await query(`UPDATE clientes SET whatsapp_status = 'pendente' WHERE id = $1`, [req.params.clienteId]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Rota autenticada — lista grupos disponíveis para cadastrar
router.get('/grupos/:clienteId', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(`SELECT evolution_instancia FROM clientes WHERE id = $1`, [req.params.clienteId]);
    if (!rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const grupos = await listarGrupos(rows[0].evolution_instancia);
    res.json(grupos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
