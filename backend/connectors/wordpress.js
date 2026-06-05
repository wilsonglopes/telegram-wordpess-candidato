'use strict';

const axios    = require('axios');
const FormData = require('form-data');

// Monta URL REST de forma robusta usando ?rest_route=, que funciona mesmo quando o
// site está com permalinks "Simples" (plain). Sites assim retornam 404 em /wp-json/...
// — o formato ?rest_route= sempre responde, com ou sem permalinks bonitos.
function restUrl(wp_url, route) {
  return `${wp_url.replace(/\/$/, '')}/?rest_route=${route}`;
}

/**
 * Publica via Portal Publisher plugin (modo principal).
 * Envia chapéu, resumo, corpo, imagem — o plugin trata tudo no WP.
 */
async function publicarComPlugin({ wp_url, wp_plugin_key, chapeu, titulo, resumo, corpo, imagemUrl, slug, post_format }) {
  const payload = {
    title:       titulo,
    chapeu:      chapeu      || '',
    summary:     resumo      || '',
    body:        corpo,
    slug:        slug        || '',
    image_url:   imagemUrl   || '',
    post_format: post_format || 'editorial',
  };

  const r = await axios.post(restUrl(wp_url, '/cpub/v1/publish'), payload, {
    headers: {
      'Content-Type':        'application/json',
      'X-CampanhaPress-Key': wp_plugin_key,
    },
    timeout: 90000,
  });

  const url = r.data?.post_url;
  if (!url) throw new Error('Plugin não retornou URL do post');
  return {
    id:        r.data.post_id,
    link:      url,
    imagemUrl: r.data.featured_image_url || null,
  };
}

/**
 * Publica via WP REST padrão (fallback — sem chapéu).
 */
async function publicarComAppPassword({ wp_url, wp_usuario, wp_senha, titulo, corpo, imagemUrl }) {
  const auth    = Buffer.from(`${wp_usuario}:${wp_senha}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}` };

  let featured_media;
  let wpImageUrl = null; // URL pública no WP — usar no FB/IG em vez da URL do Telegram

  if (imagemUrl) {
    try {
      const imgResp = await axios.get(imagemUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const form = new FormData();
      form.append('file', Buffer.from(imgResp.data), { filename: 'imagem.jpg', contentType: 'image/jpeg' });
      const upload = await axios.post(restUrl(wp_url, '/wp/v2/media'), form, {
        headers: { ...headers, ...form.getHeaders() },
        timeout: 60000,
      });
      featured_media = upload.data.id;
      wpImageUrl = upload.data.source_url || upload.data.link || null;
    } catch (err) {
      console.warn('[wp] Upload de imagem falhou:', err.message);
    }
  }

  const r = await axios.post(restUrl(wp_url, '/wp/v2/posts'), {
    title:   titulo,
    content: corpo,
    status:  'publish',
    ...(featured_media && { featured_media }),
  }, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  if (!r.data?.link) throw new Error('WordPress não retornou URL do post');
  return { id: r.data.id, link: r.data.link, imagemUrl: wpImageUrl };
}

/**
 * Ponto de entrada: usa plugin se disponível, senão Application Password.
 */
async function publicarWP(params) {
  if (params.wp_plugin_key) {
    return publicarComPlugin(params);
  }
  return publicarComAppPassword(params);
}

module.exports = { publicarWP };
