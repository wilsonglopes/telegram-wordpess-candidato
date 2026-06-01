'use strict';

const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('./auth');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Export CSV — antes do authMiddleware para aceitar token via query string (links de download)
router.get('/export/csv', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ erro: 'Não autorizado' });
  try {
    const settings = require('../settings.json');
    const payload = jwt.verify(token, settings.jwt_secret);
    if (!payload.admin) return res.status(403).json({ erro: 'Acesso negado' });
  } catch { return res.status(401).json({ erro: 'Token inválido' }); }

  try {
    const { rows } = await query(`
      SELECT c.nome, c.slug, c.wp_url,
        COALESCE(f.plano,'—')                AS plano,
        COALESCE(f.valor::text,'0')          AS valor,
        COALESCE(f.vencimento_dia::text,'—') AS vencimento_dia,
        COALESCE(f.status,'sem_registro')    AS status_pagamento,
        COALESCE(f.forma_pagamento,'—')      AS forma_pagamento,
        (SELECT MAX(data_pagamento)::text FROM pagamentos p WHERE p.cliente_id=c.id) AS ultimo_pagamento,
        (SELECT COUNT(*) FROM publicacoes p WHERE p.cliente_id=c.id AND p.status='publicado')::text AS total_publicacoes
      FROM clientes c LEFT JOIN financeiro f ON f.cliente_id=c.id
      WHERE c.ativo=true ORDER BY c.nome
    `);

    const cols = ['nome','slug','wp_url','plano','valor','vencimento_dia',
                  'status_pagamento','forma_pagamento','ultimo_pagamento','total_publicacoes'];
    const csv = [
      cols.join(';'),
      ...rows.map(r => cols.map(c => `"${(r[c] ?? '').toString().replace(/"/g, '""')}"`).join(';')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="candidatos.csv"');
    res.send('﻿' + csv); // BOM para Excel abrir com acentos corretos
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Demais rotas requerem authMiddleware
router.use(authMiddleware);

// Lista todos candidatos com situação financeira
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.nome, c.slug, c.ativo,
        f.plano, f.valor, f.vencimento_dia,
        f.status         AS status_pagamento,
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
      [id, valor,
       data_pagamento || new Date().toISOString().slice(0, 10),
       referencia || null,
       observacoes || null]
    );
    // Se estava inadimplente, reativar automaticamente
    await query(
      `UPDATE financeiro SET status='ativo' WHERE cliente_id=$1 AND status='inadimplente'`,
      [id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
