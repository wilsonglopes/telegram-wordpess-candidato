'use strict';

const { Pool } = require('pg');
const settings = require('./settings.json');

const pool = new Pool({ connectionString: settings.db_connection_string });

async function query(sql, params) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id          SERIAL PRIMARY KEY,
      nome        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,
      wp_url      TEXT NOT NULL,
      wp_usuario  TEXT NOT NULL,
      wp_senha    TEXT NOT NULL,
      evolution_instancia   TEXT UNIQUE,
      telegram_bot_token    TEXT,
      ai_prompt   TEXT,
      token_qr    TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
      whatsapp_status TEXT NOT NULL DEFAULT 'pendente',
      ativo       BOOLEAN NOT NULL DEFAULT true,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS grupos_whatsapp (
      id          SERIAL PRIMARY KEY,
      cliente_id  INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      group_jid   TEXT NOT NULL,
      nome        TEXT NOT NULL,
      ativo       BOOLEAN NOT NULL DEFAULT true
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS assessores (
      id              SERIAL PRIMARY KEY,
      cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      telegram_user_id BIGINT NOT NULL,
      nome            TEXT,
      ativo           BOOLEAN NOT NULL DEFAULT true,
      UNIQUE(cliente_id, telegram_user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS publicacoes (
      id              SERIAL PRIMARY KEY,
      cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      titulo          TEXT,
      wp_post_url     TEXT,
      status          TEXT NOT NULL DEFAULT 'publicado',
      criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS wp_plugin_key     TEXT`);
  await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fb_page_id        TEXT`);
  await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fb_access_token   TEXT`);
  await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ig_user_id        TEXT`);
  await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS wp_post_format    TEXT NOT NULL DEFAULT 'editorial'`);
  await query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS social_template   TEXT NOT NULL DEFAULT 'padrao'`);

  // Torna wp_usuario e wp_senha nullable (plugin não precisa deles)
  await query(`ALTER TABLE clientes ALTER COLUMN wp_usuario DROP NOT NULL`);
  await query(`ALTER TABLE clientes ALTER COLUMN wp_senha   DROP NOT NULL`);

  console.log('[db] Migrations OK');
}

module.exports = { query, migrate };
