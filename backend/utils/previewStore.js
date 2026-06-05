'use strict';

// Armazenamento EFÊMERO de prévias de matéria, em memória.
// Cada prévia ganha um token aleatório e expira em 30 min. Não usa banco —
// prévia é descartável; se o processo reiniciar, o link velho simplesmente expira.

const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000; // 30 minutos
const store  = new Map();      // token -> { dados, expira }

function criar(dados) {
  const token = crypto.randomBytes(12).toString('hex');
  store.set(token, { dados, expira: Date.now() + TTL_MS });
  return token;
}

function obter(token) {
  const item = store.get(token);
  if (!item) return null;
  if (Date.now() > item.expira) { store.delete(token); return null; }
  return item.dados;
}

// Limpeza periódica de prévias expiradas (não segura o processo vivo)
setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of store) if (agora > v.expira) store.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { criar, obter };
