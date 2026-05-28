'use strict';

const axios    = require('axios');
const { query } = require('../db');
const settings  = require('../settings.json');

const BASE = () => settings.evolution_api_url.replace(/\/$/, '');
const KEY  = () => settings.evolution_api_key;

const headers = () => ({ apikey: KEY(), 'Content-Type': 'application/json' });

// Cria instância na Evolution API para um novo cliente
async function criarInstancia(nome) {
  const r = await axios.post(`${BASE()}/instance/create`, {
    instanceName:  nome,
    qrcode:        true,
    integration:   'WHATSAPP-BAILEYS',
  }, { headers: headers(), timeout: 15000 });
  return r.data;
}

// Retorna QR code base64 para exibir na página
async function obterQRCode(instancia) {
  const r = await axios.get(`${BASE()}/instance/connect/${instancia}`, {
    headers: headers(),
    timeout: 15000,
  });
  return r.data?.base64 || null;
}

// Retorna status da conexão: open / close / connecting
async function statusConexao(instancia) {
  try {
    const r = await axios.get(`${BASE()}/instance/fetchInstances`, {
      headers: headers(),
      timeout: 10000,
    });
    const inst = (r.data || []).find(i => i.instance?.instanceName === instancia);
    return inst?.instance?.state || 'desconhecido';
  } catch {
    return 'erro';
  }
}

// Lista grupos do WhatsApp conectado
async function listarGrupos(instancia) {
  const r = await axios.get(`${BASE()}/group/fetchAllGroups/${instancia}?getParticipants=false`, {
    headers: headers(),
    timeout: 15000,
  });
  return (r.data || []).map(g => ({ jid: g.id, nome: g.subject }));
}

// Envia mensagem para todos os grupos ativos do cliente
async function enviarGrupos({ instancia, clienteId, titulo, postUrl }) {
  const { rows: grupos } = await query(
    `SELECT group_jid, nome FROM grupos_whatsapp WHERE cliente_id = $1 AND ativo = true`,
    [clienteId]
  );

  if (grupos.length === 0) return;

  const mensagem = `🗞️ *${titulo}*\n\n🔗 Leia a matéria completa:\n${postUrl}`;

  for (const grupo of grupos) {
    try {
      await axios.post(`${BASE()}/message/sendText/${instancia}`, {
        number: grupo.group_jid,
        text:   mensagem,
      }, { headers: headers(), timeout: 15000 });
    } catch (err) {
      console.warn(`[evolution] Falha ao enviar para grupo ${grupo.nome}:`, err.message);
    }
  }
}

module.exports = { criarInstancia, obterQRCode, statusConexao, listarGrupos, enviarGrupos };
