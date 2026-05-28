# Plano de Implementação — Plataforma Candidatos

> Última atualização: 2026-05-28
> Status do servidor: ✅ Online — `candidatos.xmnews.com.br` (aguardando DNS + SSL)

---

## Estado atual (o que já funciona)

| Componente | Status |
|---|---|
| Backend Express + rotas API | ✅ Funcionando |
| Bot Telegram multi-tenant | ✅ Funcionando |
| Geração de matéria via DeepSeek | ✅ Funcionando |
| Publicação no WordPress | ✅ Funcionando |
| Envio para grupos WhatsApp | ✅ Funcionando |
| Painel admin (login + CRUD candidatos) | ✅ Funcionando |
| Página QR code para cliente | ✅ Funcionando |
| Evolution API v2.3.7 | ✅ Online porta 8080 |
| PostgreSQL banco `candidatos` | ✅ Online |
| PM2 `plataforma-candidatos` | ✅ Online porta 3003 |
| Nginx configurado | ✅ Pronto |
| SSL | ⏳ Aguarda DNS |

---

## FASE 1 — Ativação (ação imediata)

### 1.1 DNS + SSL (você faz)
- Criar registro A: `candidatos.xmnews.com.br → 146.235.53.61`
- Após propagar (5-30 min): `sudo certbot --nginx -d candidatos.xmnews.com.br --non-interactive --agree-tos -m wilsonglopes@gmail.com`

### 1.2 Corrigir deploy.sh no GitHub (eu faço)
O `deploy.sh` local já foi corrigido (`main` → `master`). Precisa commitar e fazer push para o GitHub sync com o servidor.

### 1.3 Primeiro candidato de teste
- Abrir `https://candidatos.xmnews.com.br/admin`
- Login com a senha configurada
- Cadastrar 1 candidato de teste com:
  - WordPress real ou de staging
  - Bot Telegram real (BotFather)
  - Instância WA criada automaticamente na Evolution API

---

## FASE 2 — Painel Admin completo (UI)

O painel atual faz CRUD de candidatos mas **não tem telas** para gerenciar assessores, grupos de WhatsApp e ver publicações. Tudo isso existe na API mas sem interface visual.

### 2.1 Tela de assessores
- Dentro do painel, ao abrir um candidato: listar assessores cadastrados
- Botão "Adicionar assessor" → campo Telegram User ID + nome
- Botão remover assessor
- **API já pronta:** `GET/POST/DELETE /api/clientes/:id/assessores`

### 2.2 Tela de grupos WhatsApp
- Após WhatsApp conectado: botão "Buscar grupos"
- Lista os grupos disponíveis na instância do candidato
- Checkbox para ativar/desativar cada grupo
- **API já pronta:** `GET /api/whatsapp/grupos/:clienteId`

### 2.3 Histórico de publicações
- Tab "Publicações" no detalhe do candidato
- Lista as últimas 50 matérias com título, data, link WP
- **API já pronta:** `GET /api/clientes/:id/publicacoes`

### 2.4 Indicador de status WhatsApp
- Badge colorido na lista de candidatos (verde/vermelho/laranja)
- Polling a cada 30s para atualizar status
- **API já pronta:** campo `whatsapp_status` no `GET /api/clientes`

---

## FASE 3 — Bot Telegram melhorias

### 3.1 Transcrição de áudio (Whisper)
O `bot.js` tem um `// TODO: Whisper` — mensagens de voz ainda não são processadas.

- Integrar OpenAI Whisper API
- Baixar o arquivo de áudio do Telegram
- Transcrever → usar como `texto` para a IA gerar a matéria
- **Impacto:** assessores podem "falar" a notícia em vez de digitar

### 3.2 Comando `/status` no bot
- Assessor digita `/status` → bot responde com:
  - WhatsApp: conectado/desconectado
  - Últimas 3 publicações com links

### 3.3 Comando `/grupos` no bot
- Assessor digita `/grupos` → bot lista os grupos ativos da campanha

### 3.4 Hot-reload de bots
Atualmente, ao atualizar um cliente (novo token Telegram, por ex.), o servidor precisa reiniciar para pegar a mudança. Implementar:
- No `PATCH /api/clientes/:id`: se token mudou, parar bot antigo e iniciar novo
- Zero downtime para outros candidatos

---

## FASE 4 — Operações e confiabilidade

### 4.1 Deploy automático via GitHub Actions
- Criar `.github/workflows/deploy.yml`
- Trigger: push para `master`
- Action: SSH → `cd /home/ubuntu/candidatos && bash deploy.sh`
- **Benefício:** `git push` deploya automaticamente

### 4.2 Monitoramento de WhatsApp
- Cron job a cada 5 min: verificar status de todas as instâncias ativas
- Se `status !== 'open'`: marcar `whatsapp_status = 'desconectado'` no banco
- Opcional: notificar o admin por Telegram

### 4.3 Tratamento de falha no WordPress
- Atualmente: se WP falha, a matéria é perdida
- Melhorar: salvar em `publicacoes` com `status = 'erro_wp'` e o conteúdo gerado
- Admin pode retentar via painel

### 4.4 Log rotation
- Configurar PM2 para rotacionar logs (`pm2 install pm2-logrotate`)
- Evita disco cheio ao longo do tempo

---

## FASE 5 — Funcionalidades premium (SaaS)

### 5.1 Página de onboarding do candidato
- URL única por candidato com tutorial visual
- Passo 1: Escanear QR do WhatsApp
- Passo 2: Instruções para adicionar o bot Telegram
- Passo 3: Confirmação "Tudo pronto!"

### 5.2 Prompt personalizado por candidato
O campo `ai_prompt` já existe no banco mas não há UI para editá-lo.
- Adicionar textarea no formulário de edição do candidato
- Placeholder com o prompt padrão
- Permitir personalizar tom, partido, palavras-chave da campanha

### 5.3 Agendamento de publicações
- Assessor envia com prefixo `[AGENDAR 15:30]` texto da matéria
- Bot confirma agendamento
- Cron publica no horário

### 5.4 Relatório semanal
- Toda segunda-feira: bot envia resumo para cada candidato
- Total de matérias publicadas, grupos alcançados

---

## Ordem sugerida de execução

| Prioridade | Fase | Descrição | Esforço |
|---|---|---|---|
| 🔴 Imediato | 1.1 | DNS + SSL | 5 min (seu lado) |
| 🔴 Imediato | 1.2 | Corrigir deploy.sh no GitHub | 2 min |
| 🔴 Imediato | 1.3 | Testar com candidato real | 30 min |
| 🟡 Curto prazo | 2.1-2.4 | Painel admin completo | 1-2 dias |
| 🟡 Curto prazo | 3.1 | Suporte a áudio (Whisper) | 2h |
| 🟡 Curto prazo | 4.1 | Deploy automático | 1h |
| 🟢 Médio prazo | 3.2-3.4 | Comandos e hot-reload do bot | 1 dia |
| 🟢 Médio prazo | 4.2-4.4 | Monitoramento e confiabilidade | 1 dia |
| 🔵 Futuro | 5.x | Funcionalidades premium SaaS | 3-5 dias |
