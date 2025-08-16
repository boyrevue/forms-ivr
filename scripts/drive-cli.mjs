// scripts/drive-cli.mjs
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Parser, Store } from "n3";
import comunica from "@comunica/query-sparql";

const { QueryEngine } = comunica;
const engine = new QueryEngine();

const PREFIX = "http://example.org/form#";
const paths = {
  instances: "out/instances.ttl",
  shapes: "out/shapes.ttl",
  answersTtl: "out/answers.ttl",
  answersJson: "answers.json",
  plan: "out/plan.json",
};

async function parseTTL(path) {
  const text = await fs.readFile(path, "utf8");
  const store = new Store();
  store.addQuads(new Parser().parse(text));
  return store;
}

async function q(store, query) {
  const res = await engine.queryBindings(query, { sources: [{ type: "rdfjs", value: store }] });

  // Figure out the variable names in the SELECT
  const md = await res.metadata?.();
  // md.variables can be strings or RDFJS Variable terms; normalize to plain names
  const vars = md?.variables
    ? [...md.variables].map(v => (typeof v === "string" ? v : (v.value ?? String(v)).replace(/^\?/, "")))
    : undefined;

  const rows = await res.toArray();

  return rows.map(b => {
    // Build a plain object var -> string value
    const out = {};
    const names = vars ?? ["q", "value", "label"]; // fallback for our simple queries
    for (const v of names) {
      const term = b.get(v) ?? b.get(`?${v}`); // be extra defensive
      if (term) out[v] = term.value;
    }
    return out;
  });
}



const localName = (iriOrLocal = "") =>
  iriOrLocal.includes("#") ? iriOrLocal.split("#").pop() : iriOrLocal.split("/").pop();

// Only these should be numeric; enums remain strings
const NUMERIC_FIELDS = new Set(["vehicleValue", "personalMilesPerYear"]);

async function getQuestion(store, field) {
  const rows = await q(store, `
    PREFIX : <${PREFIX}>
    SELECT ?q WHERE { :${field} :question ?q }
  `);
  return rows[0]?.q || field;
}

async function getOptions(store, field) {
  const rows = await q(store, `
    PREFIX : <${PREFIX}>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT ?value ?label WHERE {
      :${field} :hasOption ?o .
      OPTIONAL { ?o :value ?value }
      OPTIONAL { ?o rdfs:label ?label }
    } ORDER BY ?label ?value
  `);
  const seen = new Set();
  return rows
    .map(r => ({ value: r.value ?? "", label: r.label ?? r.value ?? "" }))
    .filter(o => {
      const k = o.value + "||" + o.label;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .filter(o => o.label && o.value !== "");
}

async function run(cmd, args) {
  await new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function buildAnswersTTL(formId) {
  await run("node", [
    "scripts/answers-to-rdf.mjs",
    "--json",
    paths.answersJson,
    "--out",
    paths.answersTtl,
    "--form-id",
    formId,
  ]);
}

async function plan(formId) {
  await run("node", [
    "scripts/rdf-to-plan.mjs",
    "--instances",
    paths.instances,
    "--shapes",
    paths.shapes,
    "--answers",
    paths.answersTtl,
    "--form-id",
    formId,
    "--out",
    paths.plan,
  ]);
  return JSON.parse(await fs.readFile(paths.plan, "utf8"));
}

async function main() {
  const formId = "form1";
  try {
    await fs.access(paths.answersJson);
  } catch {
    await fs.writeFile(paths.answersJson, JSON.stringify({ form: formId, values: {} }, null, 2));
  }
  await buildAnswersTTL(formId);

  const rl = readline.createInterface({ input, output });
  const store = await parseTTL(paths.instances);

  while (true) {
    const p = await plan(formId);
    if (p.status === "complete") {
      console.log(`✅ All required fields set for ${p.form} (missing ${p.missingCount}/${p.requiredTotal})`);
      break;
    }
    const nextObj = p.next || p.missing?.[0];
    if (!nextObj) {
      console.log("No 'next' returned; stopping.");
      break;
    }
    const field = localName(nextObj.path || nextObj);
    const qText = await getQuestion(store, field);
    const opts = await getOptions(store, field);

    console.log("\n=== Next ===");
    console.log(qText);
    if (opts.length) {
      console.log("Options:");
      opts.forEach(o => console.log(`  [${o.value}] ${o.label}`));
    }

    const answer = await rl.question("> ");

    // update answers.json
    const obj = JSON.parse(await fs.readFile(paths.answersJson, "utf8"));
    const coerced =
      NUMERIC_FIELDS.has(field) && /^\d+$/.test(answer) ? Number(answer) : String(answer);
    obj.values[field] = coerced;
    await fs.writeFile(paths.answersJson, JSON.stringify(obj, null, 2));

    // rebuild TTL and continue
    await buildAnswersTTL(formId);
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

