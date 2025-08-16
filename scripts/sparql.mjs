// scripts/sparql.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { QueryEngine } from '@comunica/query-sparql';
import { Parser, Store } from 'n3';

const engine = new QueryEngine();
const ttlPath = './out/instances.ttl';

if (!fs.existsSync(ttlPath)) {
  console.error(`Not found: ${ttlPath}. Make sure it’s generated first.`);
  process.exit(1);
}

const ttl = fs.readFileSync(ttlPath, 'utf8');

// Build RDFJS store and use ABSOLUTE base IRI (helps with relative IRIs)
const baseIRI = pathToFileURL(path.resolve(ttlPath)).href;
const store = new Store();
store.addQuads(new Parser({ baseIRI }).parse(ttl));

// IMPORTANT: give Comunica ONE source — the store itself
const ctxRdfjs = { sources: [ store ] };
// Fallback: absolute file URL (works on all Comunica versions)
const ctxFile = { sources: [ baseIRI ] };

async function queryBindingsSafe(query, ctxPrimary, ctxFallback) {
  try {
    return await engine.queryBindings(query, ctxPrimary);
  } catch {
    return await engine.queryBindings(query, ctxFallback);
  }
}

async function toRows(bindingsStream) {
  const rows = [];
  await new Promise((res, rej) => {
    bindingsStream.on('data', b => rows.push(b));
    bindingsStream.on('end', res);
    bindingsStream.on('error', rej);
  });
  return rows;
}

const cmd = process.argv[2];

(async () => {
  if (cmd === 'fields') {
    const q = `
      PREFIX : <http://example.org/form#>
      SELECT ?field ?type ?question WHERE {
        :form1 :hasField ?field .
        ?field a ?type ; :question ?question .
        FILTER(?type IN (:NumberField,:SelectField,:RadioField,:VariantsField,:DateField,:TextField))
      } ORDER BY ?field
    `;
    const rows = await toRows(await queryBindingsSafe(q, ctxRdfjs, ctxFile));
    for (const r of rows) {
      const f = r.get('field').value.split('#').pop();
      const t = r.get('type').value.split('#').pop();
      const qn = r.get('question').value;
      console.log(`${f}\t${t}\t${qn}`);
    }
  } else if (cmd === 'options') {
    const raw = (process.argv[3] || '').trim();
    if (!raw) {
      console.error('usage: node scripts/sparql.mjs options <fieldId>');
      process.exit(1);
    }
    // Make sure ids like "usage_type_id" map to :usage_type_id
    const id = raw.replace(/[^A-Za-z0-9_]/g, '_');

    const q = `
      PREFIX : <http://example.org/form#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?val ?label WHERE {
        :${id} :hasOption ?o .
        ?o :value ?val ; rdfs:label ?label .
      } ORDER BY ?val
    `;
    const rows = await toRows(await queryBindingsSafe(q, ctxRdfjs, ctxFile));
    for (const r of rows) {
      console.log(`${r.get('val').value}\t${r.get('label').value}`);
    }
  } else {
    console.error('commands: fields | options <fieldId>');
    process.exit(1);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});

