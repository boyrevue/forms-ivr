#!/bin/bash
set -e
cd /var/www/html/NLP

echo "⬇️ Pulling latest..."
git reset --hard
git clean -fd
git pull origin main

echo "📦 Installing deps..."
pnpm install --frozen-lockfile

echo "🏗️ Building..."
pnpm build

echo "🚀 Restarting with PM2..."
pm2 start ecosystem.config.cjs --only forms-ivr --update-env
pm2 save

