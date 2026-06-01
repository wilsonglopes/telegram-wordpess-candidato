'use strict';

const axios = require('axios');
const { renderTemplate } = require('../utils/template');

const GRAPH = 'https://graph.facebook.com/v19.0';

function vars(chapeu, titulo, resumo, postUrl, slug) {
  return { CHAPEU: chapeu, TITULO: titulo, RESUMO: resumo, LINK: postUrl, SLUG_CANDIDATO: slug };
}

// ── FACEBOOK ──────────────────────────────────────────────────────────────────

async function postarFacebook({ fb_page_id, fb_access_token, chapeu, titulo, resumo, postUrl, imagemUrl, slug, template = 'padrao' }) {
  if (!fb_page_id || !fb_access_token) return null;

  const caption = renderTemplate('facebook', template, vars(chapeu, titulo, resumo, postUrl, slug));

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
    const msg = traduzErroMeta(err);
    console.error('[social] Facebook erro:', msg);
    throw new Error(msg);
  }
}

// Traduz erros comuns da Graph API para mensagens acionáveis
function traduzErroMeta(err) {
  const e = err.response?.data?.error || {};
  const raw = e.message || err.message || 'erro desconhecido';
  if (/publish_actions|pages_manage_posts|permission/i.test(raw)) {
    return 'Token sem permissão para publicar. Gere um Page Access Token com pages_manage_posts e instagram_content_publish no Graph API Explorer.';
  }
  if (/expired|session has been invalidated|access token/i.test(raw)) {
    return 'Token expirado ou inválido. Gere um novo Page Access Token de longa duração.';
  }
  if (e.code === 190) {
    return 'Token inválido (code 190). Verifique o Page Access Token nas configurações de Redes Sociais.';
  }
  return raw;
}

// ── INSTAGRAM ─────────────────────────────────────────────────────────────────

async function postarInstagram({ ig_user_id, fb_access_token, chapeu, titulo, resumo, postUrl, imagemUrl, slug, template = 'padrao' }) {
  if (!ig_user_id || !fb_access_token || !imagemUrl) return null;

  const caption = renderTemplate('instagram', template, vars(chapeu, titulo, resumo, postUrl, slug));

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
    const msg = traduzErroMeta(err);
    console.error('[social] Instagram erro:', msg);
    throw new Error(msg);
  }
}

// ── FACEBOOK VÍDEO ────────────────────────────────────────────────────────────

async function publicarVideoFacebook({ fb_page_id, fb_access_token, videoUrl, legenda }) {
  if (!fb_page_id || !fb_access_token || !videoUrl) return null;
  try {
    const r = await axios.post(`${GRAPH}/${fb_page_id}/videos`, {
      file_url:     videoUrl,
      description:  legenda || '',
      access_token: fb_access_token,
    }, { timeout: 120000 }); // timeout maior — Facebook processa o vídeo antes de responder
    console.log(`[social] Facebook vídeo postado: ${r.data?.id}`);
    return r.data;
  } catch (err) {
    const msg = traduzErroMeta(err);
    console.error('[social] Facebook vídeo erro:', msg);
    throw new Error(msg);
  }
}

// ── INSTAGRAM VÍDEO (REELS) ───────────────────────────────────────────────────

async function publicarVideoInstagram({ ig_user_id, fb_access_token, videoUrl, legenda }) {
  if (!ig_user_id || !fb_access_token || !videoUrl) return null;
  try {
    // Passo 1: criar container de Reels
    const container = await axios.post(`${GRAPH}/${ig_user_id}/media`, {
      media_type:   'REELS',
      video_url:    videoUrl,
      caption:      legenda || '',
      access_token: fb_access_token,
    }, { timeout: 30000 });

    const creationId = container.data?.id;
    if (!creationId) throw new Error('Instagram não retornou creation_id para o vídeo');

    // Passo 2: aguardar processamento (poll a cada 5s, máx 90s)
    let statusCode = '';
    for (let i = 0; i < 18 && statusCode !== 'FINISHED'; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const check = await axios.get(`${GRAPH}/${creationId}`, {
        params: { fields: 'status_code', access_token: fb_access_token },
        timeout: 15000,
      });
      statusCode = check.data?.status_code || '';
      if (statusCode === 'ERROR') throw new Error('Instagram retornou erro ao processar o vídeo');
    }

    if (statusCode !== 'FINISHED') {
      throw new Error('Instagram demorou para processar o vídeo. Tente novamente em alguns minutos.');
    }

    // Passo 3: publicar
    const pub = await axios.post(`${GRAPH}/${ig_user_id}/media_publish`, {
      creation_id:  creationId,
      access_token: fb_access_token,
    }, { timeout: 30000 });

    console.log(`[social] Instagram Reels postado: ${pub.data?.id}`);
    return pub.data;
  } catch (err) {
    const msg = traduzErroMeta(err);
    console.error('[social] Instagram vídeo erro:', msg);
    throw new Error(msg);
  }
}

// ── PONTO DE ENTRADA ──────────────────────────────────────────────────────────

async function distribuirRedes(cliente, { chapeu, titulo, resumo, postUrl, imagemUrl }) {
  const resultados = {};
  const slug     = cliente.slug || '';
  const template = cliente.social_template || 'padrao';

  if (cliente.fb_page_id && cliente.fb_access_token) {
    try {
      resultados.facebook = await postarFacebook({
        fb_page_id:      cliente.fb_page_id,
        fb_access_token: cliente.fb_access_token,
        chapeu, titulo, resumo, postUrl, imagemUrl, slug, template,
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
        chapeu, titulo, resumo, postUrl, imagemUrl, slug, template,
      });
    } catch (err) {
      resultados.instagram_erro = err.message;
    }
  }

  return resultados;
}

module.exports = { distribuirRedes, publicarVideoFacebook, publicarVideoInstagram };
