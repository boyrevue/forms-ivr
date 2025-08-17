#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "📦 Adding files..."
git add .

echo "📝 Committing..."
git commit -m "${1:-Auto update}"

echo "⬆️ Pushing..."
git push origin main

