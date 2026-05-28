'use strict';

const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v19.0';

function montarCaption({ chapeu, titulo, resumo, postUrl }) {
  let txt = '';
  if (chapeu)  txt += `${chapeu.toUpperCase()}\n\n`;
  txt += `${titulo}\n`;
  if (resumo)  txt += `\n${resumo}\n`;
  txt += `\n🔗 ${postUrl}`;
  return txt;
}

// ── FACEBOOK ──────────────────────────────────────────────────────────────────

async function postarFacebook({ fb_page_id, fb_access_token, chapeu, titulo, resumo, postUrl, imagemUrl }) {
  if (!fb_page_id || !fb_access_token) return null;

  const caption = montarCaption({ chapeu, titulo, resumo, postUrl });

  try {
    const params = {
      caption,
      access_token: fb_access_token,
      published: true,
    };

    if (imagemUrl) {
      // Post com foto
      params.url = imagemUrl;
      const r = await axios.post(`${GRAPH}/${fb_page_id}/photos`, params, { timeout: 30000 });
      console.log(`[social] Facebook postado: ${r.data?.id}`);
      return r.data;
    } else {
      // Post só texto
      const r = await axios.post(`${GRAPH}/${fb_page_id}/feed`, {
        message:      caption,
        access_token: fb_access_token,
      }, { timeout: 30000 });
      console.log(`[social] Facebook feed postado: ${r.data?.id}`);
      return r.data;
    }
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[social] Facebook erro:', msg);
    throw new Error(`Facebook: ${msg}`);
  }
}

// ── INSTAGRAM ─────────────────────────────────────────────────────────────────

async function postarInstagram({ ig_user_id, fb_access_token, chapeu, titulo, resumo, postUrl, imagemUrl }) {
  if (!ig_user_id || !fb_access_token || !imagemUrl) return null;

  const caption = montarCaption({ chapeu, titulo, resumo, postUrl });

  try {
    // Passo 1: criar container de mídia
    const container = await axios.post(`${GRAPH}/${ig_user_id}/media`, {
      image_url:    imagemUrl,
      caption,
      access_token: fb_access_token,
    }, { timeout: 30000 });

    const creationId = container.data?.id;
    if (!creationId) throw new Error('Instagram não retornou creation_id');

    // Aguarda processamento da imagem pelo Instagram (até 10s)
    await new Promise(r => setTimeout(r, 4000));

    // Passo 2: publicar
    const pub = await axios.post(`${GRAPH}/${ig_user_id}/media_publish`, {
      creation_id:  creationId,
      access_token: fb_access_token,
    }, { timeout: 30000 });

    console.log(`[social] Instagram postado: ${pub.data?.id}`);
    return pub.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[social] Instagram erro:', msg);
    throw new Error(`Instagram: ${msg}`);
  }
}

// ── PONTO DE ENTRADA ──────────────────────────────────────────────────────────

async function distribuirRedes(cliente, { chapeu, titulo, resumo, postUrl, imagemUrl }) {
  const resultados = {};

  if (cliente.fb_page_id && cliente.fb_access_token) {
    try {
      resultados.facebook = await postarFacebook({
        fb_page_id:       cliente.fb_page_id,
        fb_access_token:  cliente.fb_access_token,
        chapeu, titulo, resumo, postUrl, imagemUrl,
      });
    } catch (err) {
      resultados.facebook_erro = err.message;
    }
  }

  if (cliente.ig_user_id && cliente.fb_access_token) {
    try {
      resultados.instagram = await postarInstagram({
        ig_user_id:      cliente.ig_user_id,
        fb_access_token: cliente.fb_access_token,
        chapeu, titulo, resumo, postUrl, imagemUrl,
      });
    } catch (err) {
      resultados.instagram_erro = err.message;
    }
  }

  return resultados;
}

module.exports = { distribuirRedes };
