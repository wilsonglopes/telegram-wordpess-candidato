'use strict';

const axios    = require('axios');
const { query } = require('../db');
const settings  = require('../settings.json');
const { renderTemplate } = require('../utils/template');

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
// Evolution API v2 retorna { name, connectionStatus } no nível raiz.
// (a v1 usava { instance: { instanceName, state } } — mantido como fallback)
async function statusConexao(instancia) {
  try {
    const r = await axios.get(`${BASE()}/instance/fetchInstances`, {
      headers: headers(),
      timeout: 10000,
    });
    const lista = r.data || [];
    const inst = lista.find(i =>
      i.name === instancia || i.instance?.instanceName === instancia
    );
    return inst?.connectionStatus || inst?.instance?.state || 'desconhecido';
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

// Envia para todos os grupos ativos — com imagem se disponível, texto simples se não
async function enviarGrupos({ instancia, clienteId, titulo, resumo, postUrl, imagemUrl, chapeu, slug, template }) {
  const { rows: grupos } = await query(
    `SELECT group_jid, nome FROM grupos_whatsapp WHERE cliente_id = $1 AND ativo = true`,
    [clienteId]
  );
  if (grupos.length === 0) return;

  const legenda = renderTemplate('whatsapp', template || 'padrao', {
    CHAPEU: chapeu, TITULO: titulo, RESUMO: resumo, LINK: postUrl, SLUG_CANDIDATO: slug,
  });

  for (const grupo of grupos) {
    try {
      if (imagemUrl) {
        await axios.post(`${BASE()}/message/sendMedia/${instancia}`, {
          number:    grupo.group_jid,
          mediatype: 'image',
          mimetype:  'image/jpeg',
          caption:   legenda,
          media:     imagemUrl,
        }, { headers: headers(), timeout: 30000 });
      } else {
        await axios.post(`${BASE()}/message/sendText/${instancia}`, {
          number: grupo.group_jid,
          text:   legenda,
        }, { headers: headers(), timeout: 15000 });
      }
    } catch (err) {
      console.warn(`[evolution] Falha no grupo ${grupo.nome}:`, err.message);
    }
  }
}

// Envia vídeo para todos os grupos ativos do cliente
async function enviarVideoGrupos({ instancia, clienteId, videoUrl, legenda }) {
  const { rows: grupos } = await query(
    `SELECT group_jid, nome FROM grupos_whatsapp WHERE cliente_id = $1 AND ativo = true`,
    [clienteId]
  );
  if (!grupos.length) return;

  for (const grupo of grupos) {
    try {
      await axios.post(`${BASE()}/message/sendMedia/${instancia}`, {
        number:    grupo.group_jid,
        mediatype: 'video',
        mimetype:  'video/mp4',
        caption:   legenda || '',
        media:     videoUrl,
      }, { headers: headers(), timeout: 60000 });
    } catch (err) {
      console.warn(`[evolution] Vídeo falhou no grupo ${grupo.nome}:`, err.message);
    }
  }
}

module.exports = { criarInstancia, obterQRCode, statusConexao, listarGrupos, enviarGrupos, enviarVideoGrupos };
