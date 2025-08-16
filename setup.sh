#!/usr/bin/env bash
set -euo pipefail

log() { printf "\n\033[1;32m➤ %s\033[0m\n" "$*"; }
die() { printf "\n\033[1;31m✖ %s\033[0m\n\n" "$*"; exit 1; }

# Node >= 18
command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 18+ first."
node -e 'const [maj]=process.versions.node.split("."); if(+maj<18){process.exit(1)}' || die "Need Node >= 18"

log "Cleaning install"
rm -rf node_modules package-lock.json
npm cache clean --force >/dev/null 2>&1 || true

log "Installing dependencies"
npm install --save-exact playwright@1.54.2 express@^5.1.0 minimist@^1.2.8

log "Installing Playwright browsers (chromium)"
npx --yes playwright install chromium

log "Verifying Playwright import"
node -e 'import("playwright").then(()=>console.log("Playwright OK")).catch(e=>{console.error(e);process.exit(1)})'

log "Done ✅  Try:  npm run extract-ir"

