// scripts/plan-to-question.mjs
// Usage:
//   node scripts/plan-to-question.mjs \
//     --plan ./out/slot-plan.json \
//     --instances ./out/instances.ttl \
//     --shapes ./out/shapes.ttl \
//     --field next|<fieldId>
//
// Output (JSON):
// {
//   "status": "incomplete",
//   "form": "form1",
//   "next": { "id": "<fieldId>", "question": "<text>", "options": [ {value,label}... ] }
// }
// or { "status": "complete", ... } if plan says so.

import { promises as fs } from "node:fs";
import { Parser, Store, DataFactory } from "n3";
const { namedNode, literal } = DataFactory;

// ------------- arg parsing -------------
const argPairs = process.argv.slice(2)
  .map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null)
  .filter(Boolean);
const args = Object.fromEntries(argPairs);

if (!args.plan) {
  console.error("Usage: node scripts/plan-to-question.mjs --plan ./out/slot-plan.json [--instances ./out/instances.ttl --shapes ./out/shapes.ttl] [--field next|<fieldId>]");
  process.exit(1);
}

// ------------- small utils -------------
async function readJSON(p) {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function readTTL(p) {
  if (!p) return null;
  let raw = await fs.readFile(p, "utf8").catch(() => "");
  raw = raw.replace(/^\uFEFF/, "");
  if (!raw.endsWith("\n")) raw += "\n";
  if (!raw.trim()) return new Store();
  const store = new Store();
  store.addQuads(new Parser().parse(raw));
  return store;
}

function lastFragment(iriOrName = "") {
  const s = String(iriOrName);
  const h = s.lastIndexOf("#");
  if (h >= 0) return s.slice(h + 1);
  const slash = s.lastIndexOf("/");
  return slash >= 0 ? s.slice(slash + 1) : s;
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (k && !seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
}

// ------------- RDF helpers -------------
const NS = {
  ex: "http://example.org/form#",
  sh: "http://www.w3.org/ns/shacl#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
};

function nn(pref, local) { return namedNode((NS[pref] || pref) + local); }

function getLiteral(store, s, p) {
  const q = store.getQuads(s, p, null, null);
  const lit = q.find(qd => qd.object.termType === "Literal")?.object;
  return lit ? lit.value : null;
}

// Parse an RDF list starting at head node
function readList(store, head) {
  const items = [];
  let cur = head;
  const RDF_FIRST = nn("rdf", "first");
  const RDF_REST = nn("rdf", "rest");
  const RDF_NIL = nn("rdf", "nil");

  const guard = new Set();
  while (cur && cur.termType === "NamedNode" && cur.value !== RDF_NIL.value) {
    if (guard.has(cur.value)) break;
    guard.add(cur.value);

    const firstQ = store.getQuads(cur, RDF_FIRST, null, null)[0];
    if (firstQ) {
      const obj = firstQ.object;
      if (obj.termType === "Literal") items.push(obj.value);
      else if (obj.termType === "NamedNode") items.push(obj.value);
    }

    const restQ = store.getQuads(cur, RDF_REST, null, null)[0];
    if (!restQ) break;
    cur = restQ.object;
    if (cur.termType === "Literal") break; // malformed
  }
  return items;
}

// From SHACL: find PropertyShape for :fieldId
function findShapeForField(shapes, fieldId) {
  if (!shapes) return null;
  const PATH = nn("sh", "path");
  const propShapes = shapes.getQuads(null, PATH, nn("ex", fieldId), null).map(q => q.subject);
  return propShapes[0] ?? null;
}

function questionFromShapes(shapes, fieldId) {
  const shape = findShapeForField(shapes, fieldId);
  if (!shape) return null;
  const name = getLiteral(shapes, shape, nn("sh", "name"));
  return name || null;
}

function enumFromShapes(shapes, instances, fieldId) {
  if (!shapes) return [];
  const shape = findShapeForField(shapes, fieldId);
  if (!shape) return [];
  const inQ = shapes.getQuads(shape, nn("sh", "in"), null, null)[0];
  if (!inQ) return [];

  // Read values from RDF list
  const values = readList(shapes, inQ.object)
    .map(v => (typeof v === "string" ? v : String(v)))
    .filter(v => v !== "");

  if (!values.length) return [];

  // Try to enrich labels from instances.ttl options (match on :value)
  const valueToLabel = new Map();
  if (instances) {
    const VALUE = nn("ex", "value");
    const RDFS_LABEL = nn("rdfs", "label");
    // Find all options nodes via ?field :hasOption ?o ; ?o :value ?v ; rdfs:label ?l
    const HAS_OPTION = nn("ex", "hasOption");
    const fieldNode = nn("ex", fieldId);
    for (const oq of instances.getQuads(fieldNode, HAS_OPTION, null, null)) {
      const optNode = oq.object;
      const v = getLiteral(instances, optNode, VALUE);
      const l = getLiteral(instances, optNode, RDFS_LABEL);
      if (v) valueToLabel.set(v, l || v);
    }
  }

  const opts = values.map(v => ({
    value: v,
    label: valueToLabel.get(v) || v
  }));
  return uniqBy(opts, o => `${o.value}||${o.label}`);
}

function questionFromInstances(instances, fieldId) {
  if (!instances) return null;
  const q = getLiteral(instances, nn("ex", fieldId), nn("ex", "question"));
  return q || null;
}

function optionsFromInstances(instances, fieldId) {
  if (!instances) return [];
  const HAS_OPTION = nn("ex", "hasOption");
  const VALUE = nn("ex", "value");
  const RDFS_LABEL = nn("rdfs", "label");
  const fieldNode = nn("ex", fieldId);
  const opts = [];

  for (const oq of instances.getQuads(fieldNode, HAS_OPTION, null, null)) {
    const optNode = oq.object;
    const v = getLiteral(instances, optNode, VALUE) || "";
    const l = getLiteral(instances, optNode, RDFS_LABEL) || v;
    if (!l || v === "") continue;
    opts.push({ value: v, label: l });
  }
  return uniqBy(opts, o => `${o.value}||${o.label}`);
}

// ------------- main -------------
const plan = await readJSON(args.plan);

if (plan.status === "complete") {
  console.log(JSON.stringify({
    status: "complete",
    form: plan.form,
    requiredTotal: plan.requiredTotal
  }, null, 2));
  process.exit(0);
}

// Determine target field id
let fieldId = null;
if ((args.field || "next") === "next") {
  const target = plan.next ?? (Array.isArray(plan.missing) ? plan.missing[0] : null);
  if (!target) {
    console.log(JSON.stringify({ status: "unknown", form: plan.form }, null, 2));
    process.exit(0);
  }
  fieldId = target.id || lastFragment(target.path);
} else {
  fieldId = args.field;
}
if (!fieldId) {
  console.log(JSON.stringify({ status: "unknown", form: plan.form }, null, 2));
  process.exit(0);
}

// Load RDF (optional but recommended)
const instances = args.instances ? await readTTL(args.instances) : null;
const shapes = args.shapes ? await readTTL(args.shapes) : null;

// Question preference: SHACL sh:name → instances :question → fallback
const qFromShapes = questionFromShapes(shapes, fieldId);
const qFromInstances = questionFromInstances(instances, fieldId);
const question = qFromShapes || qFromInstances || fieldId;

// Options preference: SHACL sh:in (+labels via instances) → instances :hasOption
let options = enumFromShapes(shapes, instances, fieldId);
if (!options.length) options = optionsFromInstances(instances, fieldId);

options = options
  .filter(o => o && o.label && o.value !== "")
  .map(o => ({ value: String(o.value), label: String(o.label) }));

console.log(JSON.stringify({
  status: "incomplete",
  form: plan.form || null,
  next: {
    id: fieldId,
    question,
    options
  }
}, null, 2));

