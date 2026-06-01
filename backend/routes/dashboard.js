'use strict';

const express = require('express');
const { query } = require('../db');
const { authMiddleware } = require('./auth');
const bot = require('../bot');

const router = express.Router();
router.use(authMiddleware);

// KPIs em tempo real
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
      bot_online:         !!(bot.botsAtivos && bot.botsAtivos.get('_bot')),
      candidatos_ativos:  parseInt(ativos.rows[0].count),
      publicacoes_hoje:   parseInt(pubHoje.rows[0].count),
      publicacoes_semana: parseInt(pubSemana.rows[0].count),
      publicacoes_mes:    parseInt(pubMes.rows[0].count),
      total_assessores:   parseInt(assessores.rows[0].count),
      mrr:                parseFloat(fin.rows[0].mrr),
      inadimplentes:      parseInt(fin.rows[0].inadimplentes),
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Dados para gráficos
router.get('/graficos', async (req, res) => {
  try {
    const [porDia, porCanal, ranking] = await Promise.all([
      query(`
        SELECT DATE(criado_em) AS data, COUNT(*) AS total
        FROM publicacoes
        WHERE status='publicado' AND criado_em >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(criado_em) ORDER BY data
      `),
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN canal_wp  THEN 1 END), 0) AS wp,
          COALESCE(SUM(CASE WHEN canal_wa  THEN 1 END), 0) AS wa,
          COALESCE(SUM(CASE WHEN canal_fb  THEN 1 END), 0) AS fb,
          COALESCE(SUM(CASE WHEN canal_ig  THEN 1 END), 0) AS ig,
          COUNT(*) AS total
        FROM publicacoes WHERE status='publicado'
      `),
      query(`
        SELECT c.nome, COUNT(p.id) AS total
        FROM clientes c
        LEFT JOIN publicacoes p ON p.cliente_id = c.id
          AND p.status='publicado'
          AND p.criado_em >= NOW() - INTERVAL '30 days'
        WHERE c.ativo = true
        GROUP BY c.id, c.nome ORDER BY total DESC LIMIT 10
      `),
    ]);

    res.json({
      por_dia:   porDia.rows.map(r => ({ data: r.data, total: parseInt(r.total) })),
      por_canal: {
        wp:    parseInt(porCanal.rows[0].wp),
        wa:    parseInt(porCanal.rows[0].wa),
        fb:    parseInt(porCanal.rows[0].fb),
        ig:    parseInt(porCanal.rows[0].ig),
        total: parseInt(porCanal.rows[0].total),
      },
      ranking: ranking.rows.map(r => ({ nome: r.nome, total: parseInt(r.total) })),
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Alertas operacionais
router.get('/alertas', async (req, res) => {
  try {
    const alertas = [];

    const [waDesc, semFb, inadimp, inativos] = await Promise.all([
      query(`SELECT id, nome FROM clientes WHERE ativo=true AND whatsapp_status != 'conectado'`),
      query(`SELECT id, nome FROM clientes WHERE ativo=true AND (fb_access_token IS NULL OR fb_access_token = '')`),
      query(`
        SELECT c.id, c.nome FROM clientes c
        JOIN financeiro f ON f.cliente_id = c.id
        WHERE c.ativo=true AND f.status='inadimplente'
      `),
      query(`
        SELECT c.id, c.nome FROM clientes c
        WHERE c.ativo=true AND NOT EXISTS (
          SELECT 1 FROM publicacoes p
          WHERE p.cliente_id=c.id AND p.criado_em >= NOW() - INTERVAL '7 days'
        )
      `),
    ]);

    waDesc.rows.forEach(c => alertas.push({
      tipo: 'wa_desconectado', nivel: 'erro',
      candidato: c.nome, cliente_id: c.id, mensagem: 'WhatsApp desconectado',
    }));
    semFb.rows.forEach(c => alertas.push({
      tipo: 'fb_token_ausente', nivel: 'aviso',
      candidato: c.nome, cliente_id: c.id, mensagem: 'Token do Facebook não configurado',
    }));
    inadimp.rows.forEach(c => alertas.push({
      tipo: 'inadimplente', nivel: 'aviso',
      candidato: c.nome, cliente_id: c.id, mensagem: 'Pagamento em atraso',
    }));
    inativos.rows.forEach(c => alertas.push({
      tipo: 'sem_publicacoes', nivel: 'info',
      candidato: c.nome, cliente_id: c.id, mensagem: 'Sem publicações nos últimos 7 dias',
    }));

    res.json(alertas);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
