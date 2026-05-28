# Receita de Integração — Telegram + WordPress + Facebook + Instagram + WhatsApp

> Documento técnico com tudo que foi testado e funciona neste projeto.
> Use como referência para implementar o mesmo padrão em outro sistema.

---

## PROBLEMA 1 — Imagem duplicada no artigo WordPress

### O que acontece
O post aparece com a imagem **duas vezes**: uma como imagem destacada (featured image, exibida pelo tema no topo) e outra dentro do corpo do artigo.

### Por que acontece
O plugin envia a imagem para o WordPress de duas formas ao mesmo tempo:
1. Como **imagem destacada** via `set_post_thumbnail()` — o tema exibe automaticamente
2. Como **`<figure>` dentro do `post_content`** — quando o `post_format` é `editorial`

Se o tema do candidato exibe a imagem destacada acima do conteúdo, a imagem aparece duas vezes.

### A solução — dois casos

**Caso A: O tema exibe a featured image automaticamente (maioria dos temas)**

Use `post_format: 'standard'` na chamada à API do plugin. No modo `standard`, o plugin coloca a imagem só como featured, sem embutir no corpo:

```javascript
// No conector WordPress do seu bot, envie:
{
  title:       "Título da matéria",
  body:        "<p>Corpo HTML...</p>",
  summary:     "Resumo/lead",
  image_url:   "https://...",
  post_format: "standard"   // ← ESTA LINHA RESOLVE O PROBLEMA
}
```

**Caso B: O tema NÃO exibe featured image e você quer a imagem no corpo**

Use `post_format: 'editorial'` (padrão). A imagem vai aparecer dentro do corpo como `<figure class="cpub-figura">`. O tema não mostrará duplicate porque não tem suporte a featured image automática.

### Como verificar qual caso é o seu
Abra qualquer post do WordPress do candidato. Se a imagem destacada aparece duas vezes, é o Caso A. Use `post_format: 'standard'`.

---

## PROBLEMA 2 — Facebook e Instagram não publicam pelo bot Telegram

### As 3 causas mais comuns (em ordem de frequência)

---

### Causa A — Token errado (mais comum)

O Facebook tem **dois tokens diferentes** que muitas pessoas confundem:

| Token | O que é | Serve para |
|---|---|---|
| **User Access Token** | Token do usuário da conta | Administrar — NÃO serve para postar |
| **Page Access Token** | Token da Página específica | Postar em nome da Página — é este que você precisa |

**Como obter o Page Access Token correto:**

1. Acesse: `https://developers.facebook.com/tools/explorer`
2. Selecione seu App no topo
3. Em "User or Page", selecione a **Página** do candidato (não "Me")
4. Clique em **Generate Access Token**
5. Esse é o Page Access Token — use este no sistema

Ou via API (mais confiável para tokens de longa duração):
```
GET https://graph.facebook.com/v19.0/{PAGE_ID}?fields=access_token&access_token={USER_TOKEN}
```

---

### Causa B — Permissões insuficientes no App

O App do Facebook precisa das seguintes permissões ativadas:

| Permissão | Para que serve |
|---|---|
| `pages_manage_posts` | Criar posts na Página |
| `pages_read_engagement` | Ler dados da Página |
| `instagram_basic` | Acessar conta Instagram |
| `instagram_content_publish` | Publicar no Instagram |
| `public_profile` | Básico |

**Como verificar:**
1. `https://developers.facebook.com/apps/{SEU_APP_ID}/permissions/`
2. Todas as permissões acima devem estar com status **Aprovado** (não apenas "Solicitado")

---

### Causa C — Instagram: IDs trocados

Para o Instagram, o sistema precisa de dois IDs diferentes que costumam ser confundidos:

| Campo | O que é | Como obter |
|---|---|---|
| `fb_page_id` | ID numérico da Página do Facebook | Configurações da Página → "ID da Página" |
| `ig_user_id` | ID da conta Instagram Business | Diferente do Page ID — ver abaixo |

**Como obter o Instagram Business Account ID correto:**
```
GET https://graph.facebook.com/v19.0/{FB_PAGE_ID}?fields=instagram_business_account&access_token={PAGE_TOKEN}
```
Resposta: `{ "instagram_business_account": { "id": "123456789" } }`

O `id` dentro de `instagram_business_account` é o `ig_user_id` que o sistema precisa.

---

## IMPLEMENTAÇÃO — Como o bot funciona neste projeto

### Fluxo do bot (conversacional, não instantâneo)

O bot NÃO publica automaticamente quando recebe uma mensagem. O fluxo é:

```
1. Assessor envia textos/fotos/áudios → acumulam no rascunho da sessão
   - Áudio: Whisper (OpenAI) transcreve automaticamente
   - Foto: salva a URL da imagem
   - Texto: acumula na lista de textos

2. Assessor digita /gerar
   → IA (DeepSeek) recebe todos os textos acumulados
   → Gera: chapéu + título + resumo + corpo HTML

3. Bot exibe PRÉVIA com botões inline:
   [✅ WhatsApp] [✅ Facebook] [✅ Instagram]
   [🚀 Publicar agora] [🗑️ Cancelar]

4. Assessor ativa/desativa canais e clica 🚀 Publicar

5. Sistema publica nos canais marcados e confirma:
   "✅ Publicado em 3 canal(is)!"
```

**Por que esse fluxo?** Publicação automática sem confirmação é perigoso. O assessor pode enviar uma foto teste, um rascunho de texto, ou errar o contexto. A prévia evita publicações acidentais.

---

### Estrutura de sessão por assessor

Cada assessor tem uma sessão independente (não mistura com outras pessoas):

```javascript
sessoes.set(`${clienteId}:${telegramUserId}`, {
  textos:    [],          // textos acumulados
  imagemUrl: null,        // última foto
  stage:     'collecting',// 'collecting' | 'confirming'
  materia:   null,        // { chapeu, titulo, resumo, corpo }
  canais:    { wa: true, fb: true, ig: true },
  msgId:     null,        // id da prévia (para editar botões)
});
```

A sessão é limpa após publicar ou ao chamar `/limpar`.

---

### Comandos do bot

| Comando | O que faz |
|---|---|
| `/start` ou `/ajuda` | Exibe instruções de uso |
| `/gerar` | Processa o rascunho com IA e exibe prévia |
| `/rascunho` | Mostra o que foi acumulado |
| `/limpar` | Descarta o rascunho atual |
| `/status` | Status do WhatsApp + últimas publicações |
| `/grupos` | Lista grupos de WhatsApp ativos |

---

## IMPLEMENTAÇÃO — Facebook Graph API

### Endpoint para post com foto

```javascript
const GRAPH = 'https://graph.facebook.com/v19.0';

// Post com foto (o mais comum)
await axios.post(`${GRAPH}/${fb_page_id}/photos`, {
  url:          imagemUrl,      // URL HTTPS pública da imagem
  caption:      textoCaption,   // texto do post
  access_token: pageAccessToken,
  published:    true,
}, { timeout: 30000 });

// Post só texto (sem imagem)
await axios.post(`${GRAPH}/${fb_page_id}/feed`, {
  message:      textoCaption,
  access_token: pageAccessToken,
}, { timeout: 30000 });
```

**Atenção:** a `imagemUrl` precisa ser uma URL HTTPS acessível publicamente pela Meta. URL de `localhost`, IP privado ou Telegram (`api.telegram.org/file/...`) NÃO funcionam — a Meta não consegue baixar.

---

## IMPLEMENTAÇÃO — Instagram Business API

### O Instagram tem fluxo ASSÍNCRONO de duas etapas

```javascript
// Passo 1: criar container (Instagram processa a imagem)
const container = await axios.post(`${GRAPH}/${ig_user_id}/media`, {
  image_url:    imagemUrl,    // URL HTTPS pública
  caption:      textoCaption,
  access_token: pageAccessToken,
}, { timeout: 30000 });

const creationId = container.data?.id;

// OBRIGATÓRIO: aguardar o Instagram processar (3-10 segundos)
// Sem isso: erro code 9007 "Media ID is not available"
await new Promise(r => setTimeout(r, 4000));

// Passo 2: publicar o container
await axios.post(`${GRAPH}/${ig_user_id}/media_publish`, {
  creation_id:  creationId,
  access_token: pageAccessToken,
}, { timeout: 30000 });
```

**O erro mais comum:** chamar `media_publish` imediatamente após criar o container, sem aguardar. O Instagram retorna `code 9007: Media ID is not available`. A espera de 4 segundos resolve na maioria dos casos. Para maior confiabilidade, use polling do `status_code` até `FINISHED`.

---

## IMPLEMENTAÇÃO — Plugin WordPress (CampanhaPress)

### Payload enviado ao plugin

```javascript
// POST /wp-json/cpub/v1/publish
// Header: X-CampanhaPress-Key: {chave_do_plugin}
{
  title:        "Título da matéria",
  chapeu:       "POLÍTICA",          // exibido acima do título
  summary:      "Lead/resumo...",    // parágrafo em itálico antes do corpo
  body:         "<p>Corpo HTML</p>", // conteúdo principal
  slug:         "titulo-da-materia",
  image_url:    "https://...",       // imagem destacada
  post_format:  "editorial",         // "editorial" (imagem no corpo) ou "standard" (só featured)
  category_ids: [5, 12],            // array de IDs de categoria
  tags:         ["política", "saúde"]
}
```

### O que o plugin retorna

```json
{
  "success": true,
  "post_id": 1234,
  "post_url": "https://siteducandidato.com.br/titulo-da-materia/",
  "featured_image_url": "https://..."
}
```

A URL do post retornada é usada para montar o link no WhatsApp, Facebook e Instagram.

---

## CONFIGURAÇÃO NECESSÁRIA POR CANDIDATO

| Campo | O que é | Onde obter |
|---|---|---|
| `wp_url` | URL do WordPress | O próprio site |
| `wp_plugin_key` | Chave do plugin CampanhaPress | WP Admin → CampanhaPress |
| `telegram_bot_token` | Token do bot | @BotFather no Telegram |
| `fb_page_id` | ID numérico da Página FB | Configurações da Página |
| `fb_access_token` | Page Access Token | Graph API Explorer (selecionar a Página) |
| `ig_user_id` | ID do IG Business Account | `GET /{fb_page_id}?fields=instagram_business_account` |
| `evolution_instancia` | Nome da instância no Evolution API | Definido no cadastro |

---

## CHECKLIST DE DIAGNÓSTICO — "Por que não está publicando?"

```
[ ] 1. O Page Access Token é da PÁGINA, não do usuário?
       → Teste: GET /me/accounts com o token — deve listar a Página

[ ] 2. O token tem as permissões: pages_manage_posts, instagram_content_publish?
       → Teste: GET /me/permissions com o token

[ ] 3. O ig_user_id é o Business Account ID, não o Page ID?
       → Teste: GET /{fb_page_id}?fields=instagram_business_account

[ ] 4. A URL da imagem é HTTPS e acessível publicamente?
       → Teste: abrir a URL em aba anônima do navegador

[ ] 5. O bot está esperando 4+ segundos entre criar container e media_publish?
       → Verificar o código: há um await setTimeout antes do media_publish?

[ ] 6. O WordPress está retornando 200/201 na publicação?
       → Verificar os logs do bot para erros do WP antes de tentar FB/IG

[ ] 7. A imagem do post WP é a URL do servidor, não do Telegram?
       → O bot deve usar a URL retornada pelo WP após o upload, não a URL do Telegram
```

---

## LIÇÃO APRENDIDA — A imagem usada no FB/IG deve ser a do WordPress

Erro comum: usar a URL da imagem que veio do Telegram direto no Facebook/Instagram.

```javascript
// ERRADO — URL do Telegram não é acessível pela Meta
const imagemUrl = `https://api.telegram.org/file/bot${token}/${file_path}`;
postarFacebook({ imagemUrl }); // falha silenciosa ou erro

// CORRETO — URL retornada pelo WordPress após o upload
const post = await publicarWP({ imagemUrl: imagemDoTelegram, ... });
const imagemPublica = post.featured_image_url; // URL no CDN do WP, pública
postarFacebook({ imagemUrl: imagemPublica }); // funciona
```

O WordPress baixa a imagem do Telegram, faz upload para sua própria mídia e retorna uma URL pública no próprio servidor. Essa URL é que deve ser usada no Facebook e Instagram.
