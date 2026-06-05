#!/bin/bash
set -e

APP_DIR="/home/ubuntu/candidatos"
PM2_NAME="plataforma-candidatos"

echo "=== Deploy Plataforma Candidatos ==="

cd $APP_DIR
# Blindagem: força o código EXATO do master, descartando qualquer alteração local
# no servidor (ex: package-lock.json mexido pelo npm install). Evita o `git pull`
# abortar por sujeira e deixar o servidor rodando versão antiga.
# Seguro: o servidor só consome o repo; settings.json/cards/videos sao gitignored
# e nao sao tocados por reset --hard.
git fetch origin master
git reset --hard origin/master

cd backend
npm install --omit=dev

# Cria settings.json se não existir
if [ ! -f settings.json ]; then
  cp settings.json.example settings.json
  echo "⚠️  ATENÇÃO: settings.json criado do exemplo — configure antes de usar!"
fi

pm2 restart $PM2_NAME 2>/dev/null || pm2 start server.js --name $PM2_NAME
pm2 save

# Instala log rotation (idempotente)
pm2 install pm2-logrotate 2>/dev/null || true
pm2 set pm2-logrotate:max_size 10M 2>/dev/null || true
pm2 set pm2-logrotate:retain 7    2>/dev/null || true

echo "=== Deploy concluído ==="
pm2 show $PM2_NAME | grep -E "status|uptime"
