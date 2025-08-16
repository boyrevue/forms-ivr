#!/usr/bin/env bash
set -euo pipefail
set -x

# 0) Paths
HTML=./data/dialog_3.html
IR=./ir.json
OUT=./out
INST=$OUT/instances.ttl
SHAPES=$OUT/shapes.ttl
PLAN=$OUT/slot-plan.json

# 1) Extract → IR (from local HTML)
pnpm run extract-ir -- --file "$HTML" --out "$IR"

# 2) IR → RDF (instances.ttl + shapes.ttl)
pnpm run ir:to-rdf -- --in "$IR" --out "$OUT" --form-id form1

# 3) Quick sanity on produced TTLs
wc -c "$INST" "$SHAPES"
nl -ba "$INST" | sed -n '1,12p'
nl -ba "$SHAPES" | sed -n '1,12p'

# Validate Turtle syntax with n3 parser (ESM-friendly one-liner)
node -e "import('n3').then(({Parser})=>{const fs=require('fs');new Parser().parse(fs.readFileSync('$INST','utf8'));new Parser().parse(fs.readFileSync('$SHAPES','utf8'));console.log('TTL OK')}).catch(e=>{console.error(e);process.exit(1)})"

# 4) Build slot plan (RDF → plan)
node ./scripts/rdf-to-plan.mjs \
  --instances "$INST" \
  --shapes "$SHAPES" \
  --form-id form1 \
  --out "$PLAN"

# 5) Ask what's next (JSON)
pnpm run plan:next -- --instances "$INST" --plan "$PLAN"

# 6) Turn next into a question (we removed Comunica dependency earlier)
pnpm run plan:question -- --plan "$PLAN"

# 7) (Optional) Drive the agent
curl -s http://localhost:3000/dialog/state | jq || true

