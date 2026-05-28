# 🗺️ Mapa do Sistema — Plataforma Candidatos

> **Leia este arquivo ANTES de qualquer alteração.**
> Última atualização: 2026-05-28 — deploy completo + FB/IG/WA com imagem

---

## 1. VISÃO GERAL

Plataforma SaaS multi-tenant para assessoria de imprensa de campanhas políticas.

**Fluxo completo:**
```
Assessor → Telegram (texto/foto/áudio)
         → Whisper (transcrição, se áudio)
         → DeepSeek/OpenAI (chapéu + título + resumo + corpo)
         → WordPress via CampanhaPress plugin
         → [paralelo] WhatsApp grupos (imagem + link)
                      Facebook Page (foto + caption)
                      Instagram Business (foto + caption)
```

**Produto:** cada candidato contratado recebe:
- Um bot Telegram exclusivo para a equipe de assessoria
- Publicação automática no WordPress com chapéu editorial
- Distribuição nos grupos de WhatsApp (com imagem)
- Post automático no Facebook e Instagram da campanha

---

## 2. ARQUIVOS CRÍTICOS

| Arquivo | Responsabilidade |
|---|---|
| `backend/server.js` | Ponto de entrada — Express, rotas, startup |
| `backend/bot.js` | Gerenciador de bots Telegram (um por cliente) |
| `backend/db.js` | PostgreSQL — pool de conexão + migrations |
| `backend/connectors/ai.js` | Geração de matéria via DeepSeek ou OpenAI |
| `backend/connectors/wordpress.js` | Plugin (cpub/v1) ou App Password (fallback) |
| `backend/connectors/evolution.js` | Evolution API — QR code, status, sendMedia |
| `backend/connectors/social.js` | Facebook Graph API + Instagram Business API |
| `backend/routes/auth.js` | Login admin + middleware JWT |
| `backend/routes/clientes.js` | CRUD candidatos + hot-reload bot + PATCH grupos |
| `backend/routes/whatsapp.js` | QR code público + listar grupos |
| `frontend/admin/index.html` | Painel admin completo com design system |
| `frontend/design-system.css` | Tokens CSS compartilhados |
| `frontend/index.html` | Landing page da plataforma |
| `portal-publisher/campanhapress.php` | Plugin WP deste sistema (cpub/v1) |
| `frontend/conectar/index.html` | Página QR code para o cliente escanear |
| `backend/settings.json` | **NÃO está no git** — configurações runtime |
| `backend/settings.json.example` | Modelo de configuração — este sim no git |

---

## 3. BANCO DE DADOS — 4 TABELAS

```sql
clientes              -- um registro por candidato contratado
grupos_whatsapp       -- grupos onde distribuir (N por cliente)
assessores            -- usuários Telegram autorizados (N por cliente)
publicacoes           -- histórico de matérias publicadas
```

### Coluna crítica: `token_qr`
- UUID gerado automaticamente no INSERT
- Identifica o cliente na URL pública de conexão WA
- **Nunca expor nas listagens admin** — é a chave de acesso do cliente

---

## 4. INFRAESTRUTURA NO SERVIDOR

| Item | Valor |
|---|---|
| Servidor | `ubuntu@146.235.53.61` |
| Chave SSH | `/c/Users/Wilson/.ssh/artesapro.key` |
| Diretório | `/home/ubuntu/candidatos/` |
| PM2 | `plataforma-candidatos` |
| Porta | **3003** |
| Domínio | `candidatos.xmnews.com.br` |
| Deploy | `cd /home/ubuntu/candidatos && bash deploy.sh` |

### Dependências externas no servidor

| Serviço | Porta | Status |
|---|---|---|
| Evolution API | 8080 (interno) | ⚠️ Ainda não instalado |
| Redis | — | ❌ Não usado pelo código (remover das pendências) |
| PostgreSQL | 5432 (localhost) | ✅ Já existe |

---

## 5. EVOLUTION API — CONCEITOS

A Evolution API usa o conceito de **instâncias** — cada candidato tem a sua:

| Operação | Endpoint |
|---|---|
| Criar instância | `POST /instance/create` |
| Obter QR code | `GET /instance/connect/{nome}` |
| Status da conexão | `GET /instance/fetchInstances` |
| Listar grupos | `GET /group/fetchAllGroups/{nome}` |
| Enviar mensagem | `POST /message/sendText/{nome}` |

O nome da instância de cada candidato é `candidato-{slug}` (definido em `routes/clientes.js`).

---

## 6. FLUXO DE CONEXÃO DO CLIENTE

```
Admin cria cliente no painel
        ↓
Sistema cria instância na Evolution API
        ↓
Admin copia URL: /conectar/{token_qr}
        ↓
Admin envia URL para o cliente (WhatsApp/e-mail)
        ↓
Cliente abre a URL no celular
        ↓
Página exibe QR code (polling a cada 5s)
        ↓
Cliente: WhatsApp → Aparelhos conectados → Escaneia
        ↓
Página atualiza: "✅ WhatsApp conectado!"
        ↓
whatsapp_status = 'conectado' no banco
```

---

## 7. FLUXO DO BOT TELEGRAM

```
bot.js inicia → carrega todos clientes ativos com telegram_bot_token
        ↓
Para cada cliente: inicia TelegramBot com polling
        ↓
Assessor envia mensagem:
  1. Verifica se telegram_user_id está na tabela assessores
  2. Extrai: texto, foto (URL Telegram), ou áudio (TODO: Whisper)
  3. Envia para IA com ai_prompt do cliente
  4. IA retorna { titulo, corpo }
  5. Publica no WordPress (REST API)
  6. Envia para grupos_whatsapp ativos via Evolution API
  7. Registra em publicacoes
  8. Confirma para o assessor: "✅ Publicado! [link]"
```

---

## 8. CONFIGURAÇÃO — settings.json

```json
{
  "jwt_secret": "string aleatória longa",
  "admin_password": "senha do painel admin",
  "evolution_api_url": "http://localhost:8080",
  "evolution_api_key": "chave da Evolution API",
  "openai_api_key": "",
  "deepseek_api_key": "",
  "ai_provider": "deepseek",
  "db_connection_string": "postgresql://user:pass@localhost:5432/candidatos",
  "port": 3003,
  "base_url": "https://candidatos.xmnews.com.br"
}
```

**`settings.json` está no `.gitignore`** — o deploy.sh cria do `.example` se não existir.

---

## 9. NGINX — configuração necessária

```nginx
server {
    server_name candidatos.xmnews.com.br;

    location /api/ {
        proxy_pass http://localhost:3003;
        proxy_set_header Host $host;
    }

    location /conectar/ {
        proxy_pass http://localhost:3003;
    }

    location /admin {
        proxy_pass http://localhost:3003;
    }

    location / {
        proxy_pass http://localhost:3003;
    }
}
```

---

## 10. PAINEL ADMIN — o que cada tela faz

| Tela | URL | Acesso |
|---|---|---|
| Login | `/admin` | Senha única (settings.admin_password) |
| Lista candidatos | `/admin` (após login) | Admin |
| Novo/editar candidato | Modal no próprio admin | Admin |
| Conexão WhatsApp | `/conectar/:token` | Público (token na URL) |

---

## 11. ✅ CHECKLIST PRÉ-ALTERAÇÃO

- [ ] A mudança afeta o bot? → verificar `bot.js` + `connectors/`
- [ ] A mudança afeta múltiplos clientes? → garantir isolamento por `cliente_id`
- [ ] Mexendo no banco? → sempre `IF NOT EXISTS` nas migrations
- [ ] Nova rota pública (sem auth)? → verificar que não expõe dados de outros clientes
- [ ] Mudança no payload do WordPress? → testar com WP Application Password

---

## 12. ✅ CHECKLIST PRÉ-DEPLOY

- [ ] `git push origin master` feito?
- [ ] `settings.json` configurado no servidor?
- [ ] Redis instalado e rodando?
- [ ] Evolution API instalada e rodando?
- [ ] Banco `candidatos` criado no PostgreSQL?
- [ ] nginx configurado para `candidatos.xmnews.com.br`?
- [ ] SSL via Certbot?
- [ ] **Usuário autorizou o deploy explicitamente?**

---

## 13. ⚠️ PENDÊNCIAS DE IMPLANTAÇÃO

| # | O que falta | Onde fazer |
|---|---|---|
| 1 | Instalar Evolution API | SSH → clone + npm install + PM2 (porta 8080) |
| 2 | Criar banco PostgreSQL `candidatos` | SSH → `createdb candidatos` |
| 3 | Configurar nginx + SSL | SSH → sites-available (não alterar configs existentes) |
| 4 | Configurar `settings.json` no servidor | SSH → editar após clone |
| 5 | Primeiro deploy | `bash deploy.sh` após autorização |

> ⚠️ Redis **não é necessário** — o código não o utiliza. A dependência foi removida da lista.

---

## 14. 🔗 REPOSITÓRIO

GitHub: `https://github.com/wilsonglopes/telegram-wordpess-candidato`
