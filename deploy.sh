#!/bin/bash
set -e

APP_DIR="/home/ubuntu/candidatos"
PM2_NAME="plataforma-candidatos"

echo "=== Deploy Plataforma Candidatos ==="

cd $APP_DIR
git pull origin master

cd backend
npm install --omit=dev

# Cria settings.json se não existir
if [ ! -f settings.json ]; then
  cp settings.json.example settings.json
  echo "⚠️  ATENÇÃO: settings.json criado do exemplo — configure antes de usar!"
fi

pm2 restart $PM2_NAME 2>/dev/null || pm2 start server.js --name $PM2_NAME
pm2 save

echo "=== Deploy concluído ==="
pm2 show $PM2_NAME | grep -E "status|uptime"
