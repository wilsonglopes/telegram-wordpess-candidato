'use strict';

const axios    = require('axios');
const FormData = require('form-data');

/**
 * Publica via Portal Publisher plugin (modo principal).
 * Envia chapéu, resumo, corpo, imagem — o plugin trata tudo no WP.
 */
async function publicarComPlugin({ wp_url, wp_plugin_key, chapeu, titulo, resumo, corpo, imagemUrl, slug }) {
  const base = wp_url.replace(/\/$/, '');

  const payload = {
    title:      titulo,
    chapeu:     chapeu  || '',
    summary:    resumo  || '',
    body:       corpo,
    slug:       slug    || '',
    image_url:  imagemUrl || '',
    post_format: 'editorial',
  };

  const r = await axios.post(`${base}/wp-json/xmn/v1/publish`, payload, {
    headers: {
      'Content-Type':  'application/json',
      'X-XMNews-Key':  wp_plugin_key,
    },
    timeout: 90000,
  });

  const url = r.data?.post_url;
  if (!url) throw new Error('Plugin não retornou URL do post');
  return { id: r.data.post_id, link: url };
}

/**
 * Publica via WP REST padrão (fallback — sem chapéu).
 */
async function publicarComAppPassword({ wp_url, wp_usuario, wp_senha, titulo, corpo, imagemUrl }) {
  const base    = wp_url.replace(/\/$/, '');
  const auth    = Buffer.from(`${wp_usuario}:${wp_senha}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}` };

  let featured_media;
  if (imagemUrl) {
    try {
      const imgResp = await axios.get(imagemUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const form = new FormData();
      form.append('file', Buffer.from(imgResp.data), { filename: 'imagem.jpg', contentType: 'image/jpeg' });
      const upload = await axios.post(`${base}/wp-json/wp/v2/media`, form, {
        headers: { ...headers, ...form.getHeaders() },
        timeout: 60000,
      });
      featured_media = upload.data.id;
    } catch (err) {
      console.warn('[wp] Upload de imagem falhou:', err.message);
    }
  }

  const r = await axios.post(`${base}/wp-json/wp/v2/posts`, {
    title:   titulo,
    content: corpo,
    status:  'publish',
    ...(featured_media && { featured_media }),
  }, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  if (!r.data?.link) throw new Error('WordPress não retornou URL do post');
  return { id: r.data.id, link: r.data.link };
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
