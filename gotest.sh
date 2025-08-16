# clean up the bad path if it was created as a directory
rm -rf out/instances.ttl

# run extract (you already did this)
node scripts/extract-ir.mjs --file data/dialog_3.html --out out/ir.json
# or: node scripts/extract-ir.mjs --file data/dialog_form3.html --out out/ir.json

# Intercative
#node scripts/extract-ir.mjs \
#  --url "https://<the live form url>" \
#  --headed \
#  --executable "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
#  --persist ~/.ircrawler/brave-profile \
#  --pause-before-explore \
#  --human \
#  --max-actions 200 \
#  --out ir_live.json

# convert IR -> RDF (point --out to the *directory*)
node scripts/ir-to-rdf.mjs --in out/ir.json --out out --form-id form1
# outputs:
#   • out/instances.ttl
#   • out/shapes.ttl

# sanity checks
node scripts/sparql.mjs fields
node scripts/sparql.mjs options usage_type_id

