// scripts/next-as-json.mjs
// Usage:
//   node scripts/next-as-json.mjs --instances out/instances.ttl --plan out/plan.json [--prefix http://example.org/form#]

import fs from "node:fs/promises";
import { Parser, Store } from "n3";
import sparql from "@comunica/query-sparql";

// -------- args ----------
const argv = Object.fromEntries(
  process.argv.slice(2)
    .map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null))
    .filter(Boolean)
);

if (!argv.instances || !argv.plan) {
  console.error("Usage: node scripts/next-as-json.mjs --instances out/instances.ttl --plan out/plan.json");
  process.exit(1);
}

const PREFIX = (argv.prefix || "http://example.org/form#").replace(/[#/]*$/, "#");
const engine = new sparql.QueryEngine();

// -------- helpers ----------
const localName = (iri) => {
  if (!iri) return "";
  const i = iri.lastIndexOf("#");
  return i >= 0 ? iri.slice(i + 1) : iri;
};

async function parseTTL(path) {
  const text = await fs.readFile(path, "utf8");
  const store = new Store();
  store.addQuads(new Parser().parse(text));
  return store;
}

async function askBindings(store, query) {
  const res = await engine.queryBindings(query, { sources: [{ type: "rdfjs", value: store }] });
  return res.toArray(); // array of RDFJS Bindings
}

// -------- main ----------
const plan = JSON.parse(await fs.readFile(argv.plan, "utf8"));

if (plan.status === "complete") {
  console.log(JSON.stringify({
    status: "complete",
    form: plan.form,
    requiredTotal: plan.requiredTotal
  }, null, 2));
  process.exit(0);
}

const nextPath = plan.next?.path || plan.missing?.[0]?.path;
if (!nextPath) {
  console.log(JSON.stringify({ status: "unknown" }, null, 2));
  process.exit(0);
}

const field = localName(nextPath);
const store = await parseTTL(argv.instances);

// question
const qRows = await askBindings(store, `
  PREFIX : <${PREFIX}>
  SELECT ?q WHERE { :${field} :question ?q }
`);
const question = qRows[0]?.get("q")?.value || field;

// options
const oRows = await askBindings(store, `
  PREFIX : <${PREFIX}>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  SELECT ?value ?label WHERE {
    :${field} :hasOption ?o .
    OPTIONAL { ?o :value ?value }
    OPTIONAL { ?o rdfs:label ?label }
  } ORDER BY ?label ?value
`);

const seen = new Set();
const options = oRows
  .map(b => ({
    value: b.get("value")?.value ?? "",
    label: b.get("label")?.value ?? b.get("value")?.value ?? ""
  }))
  .filter(o => {
    const k = `${o.value}||${o.label}`;
    if (!o.label || o.value === "" || seen.has(k)) return false; // drop placeholders/dupes
    seen.add(k);
    return true;
  });

console.log(JSON.stringify({
  status: "incomplete",
  form: plan.form,
  next: { id: field, path: nextPath, question, options }
}, null, 2));

