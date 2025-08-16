// scripts/rdf-to-plan.mjs
// Build a dialog plan from instances.ttl + shapes.ttl (+ optional answers.ttl)
// Usage:
//   node scripts/rdf-to-plan.mjs \
//     --instances out/instances.ttl \
//     --shapes out/shapes.ttl \
//     --answers out/answers.ttl \
//     --form-id form1 \
//     --out out/plan.json

import fs from "node:fs";
import path from "node:path";
import { Parser, Store } from "n3";
import comunica from "@comunica/query-sparql";
const { QueryEngine } = comunica;

// ---- tiny arg parser
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instances") out.instances = argv[++i];
    else if (a === "--shapes") out.shapes = argv[++i];
    else if (a === "--answers") out.answers = argv[++i];
    else if (a === "--form-id") out.formId = argv[++i];
    else if (a === "--out") out.out = argv[++i];
  }
  return out;
}
const argv = parseArgs(process.argv);
if (!argv.instances || !argv.shapes || !argv.formId) {
  console.error("Missing required args. Need --instances, --shapes, --form-id");
  process.exit(1);
}

function readTTL(filePath, baseIRI = "http://example.org/form#") {
  const ttl = fs.readFileSync(path.resolve(filePath), "utf8");
  const parser = new Parser({ baseIRI });
  return parser.parse(ttl); // -> quads
}

async function main() {
  // Load all data into a single RDFJS store (avoids any HTTP/file dereference)
  const store = new Store();
  store.addQuads(readTTL(argv.instances));
  store.addQuads(readTTL(argv.shapes));
  if (argv.answers && fs.existsSync(argv.answers)) {
    store.addQuads(readTTL(argv.answers));
  }

  const engine = new QueryEngine();

  const query = `
    PREFIX :   <http://example.org/form#>
    PREFIX sh: <http://www.w3.org/ns/shacl#>
    SELECT ?path ?name (EXISTS { :${argv.formId} ?path ?v } AS ?hasValue)
    WHERE {
      :FormShape sh:property ?ps .
      ?ps sh:path ?path .
      OPTIONAL { ?ps sh:name ?name }
      OPTIONAL { ?ps sh:minCount ?min }
      BIND(COALESCE(?min, 0) AS ?m)
      FILTER(?m >= 1)
    }
  `;

  const result = await engine.queryBindings(query, {
    sources: [{ type: "rdfjs", value: store }], // ← was "rdfjsSource"
    lenient: true, // optional, avoids hard fails on minor datatype quirks
  });
  const rows = await result.toArray();

  const required = rows.map(b => ({
    path: b.get("path")?.value || "",
    name: b.get("name")?.value || "",
    hasValue: b.get("hasValue")?.value === "true",
  }));

  const missing = required.filter(r => !r.hasValue);
  const done = missing.length === 0;

  const plan = {
    form: argv.formId,
    status: done ? "complete" : "incomplete",
    next: done ? null : {
      path: missing[0].path,
      label: missing[0].name || missing[0].path.split("#").pop(),
    },
    requiredTotal: required.length,
    missingCount: missing.length,
    missing: missing.map(m => ({
      path: m.path,
      label: m.name || m.path.split("#").pop(),
    })),
  };

  const outPath = path.resolve(argv.out || "out/plan.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath} (${plan.status}; missing ${plan.missingCount}/${plan.requiredTotal})`);
}

main().catch(err => {
  console.error(err?.stack || err);
  process.exit(1);
});
