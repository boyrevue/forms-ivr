# 1) Extract a target url form to IR
# x_pnpm run extract-ir -- --url https://moneysupermarket.com --out ./ir.json

# 1) Extract a local HTML file to IR
pnpm run extract-ir -- --file ./data/dialog_3.html --out ./ir.json


# 2) Convert IR → RDF (instances.ttl + shapes.ttl into ./out)
pnpm run ir:to-rdf

# 3) (Optional) Seed sample answers → answers.ttl
pnpm run rdf:answers:sample

# 4) Validate SHACL parity (instances + answers)
pnpm run rdf:validate

# 5) Build a slot plan from RDF
pnpm run plan:build

# 6) Ask “what’s next?” from the plan (json)
pnpm run plan:next

# 7) Turn that into a user prompt
pnpm run plan:question

# 8) Serve the agent API (Node-RED can POST here)
pnpm run agent:serve

