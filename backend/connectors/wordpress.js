'use strict';

const axios    = require('axios');
const FormData = require('form-data');

async function publicarWP({ wp_url, wp_usuario, wp_senha, titulo, corpo, imagemUrl }) {
  const base = wp_url.replace(/\/$/, '');
  const auth = Buffer.from(`${wp_usuario}:${wp_senha}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}` };

  let featured_media = undefined;

  // Faz upload da imagem se existir
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

  const payload = {
    title:   titulo,
    content: corpo,
    status:  'publish',
    ...(featured_media && { featured_media }),
  };

  const r = await axios.post(`${base}/wp-json/wp/v2/posts`, payload, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  if (!r.data?.link) throw new Error('WordPress não retornou URL do post');
  return { id: r.data.id, link: r.data.link };
}

module.exports = { publicarWP };
