// scripts/answers-to-rdf.mjs
// Build a small TTL with the user's answers so SHACL/RDF steps can consume it safely.
//
// Usage:
//   node scripts/answers-to-rdf.mjs --json ./answers.json --out ./out/answers.ttl --form-id form1
//
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import minimist from "minimist";

const argv = minimist(process.argv.slice(2), {
  string: ["json", "out", "form-id"],
  alias: { j: "json", o: "out", f: "form-id" },
});

if (!argv.json) {
  console.error("Missing --json");
  process.exit(1);
}

const outPath = argv.out || "out/answers.ttl";
const tmpPath = `${outPath}.tmp`;
const formId = (argv["form-id"] || "form1").trim();

// ---------- IRI / TTL helpers ----------
const PREFIX_BASE = "http://example.org/form#";

function escStr(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n");
}

// safe predicate local name (QName local)
// allow letters, digits, underscore; ensure starts with a letter/underscore
function slugPred(s) {
  let t = String(s || "").trim();
  if (!t) t = "field";
  t = t.replace(/[^A-Za-z0-9_]+/g, "_");
  if (!/^[A-Za-z_]/.test(t)) t = `f_${t}`;
  return t;
}

// turn a JS value into a Turtle object
function ttlObject(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `"${escStr(v)}"`;
}

// ---------- read answers JSON ----------
let dataRaw;
try {
  dataRaw = JSON.parse(fs.readFileSync(argv.json, "utf8"));
} catch (e) {
  console.error(`Could not read/parse ${argv.json}: ${e?.message || e}`);
  process.exit(1);
}

// Accept either { values: {...} } or a flat object
const valuesObj = (dataRaw && typeof dataRaw === "object" && dataRaw.values && typeof dataRaw.values === "object")
  ? dataRaw.values
  : (dataRaw && typeof dataRaw === "object" ? dataRaw : {});

const entries = Object.entries(valuesObj);

// ---------- build Turtle ----------
let ttl = [
  `@prefix : <${PREFIX_BASE}> .`,
  "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
  "", // keep at least 3+ lines before triples to avoid 'EOF line 5' heuristics
].join("\n");

// Always emit a subject so the file is valid even with zero answers
ttl += `:${formId}\n`;

// Emit properties if any; otherwise add a harmless type triple to close the statement.
if (entries.length > 0) {
  entries.forEach(([k, v], idx) => {
    const pred = slugPred(k);

    // support arrays by emitting a comma-separated object list
    const objs = Array.isArray(v) ? v.map(ttlObject).filter(Boolean) : [ttlObject(v)];
    const objStr = objs.filter(Boolean).join(", ");

    // skip empty/invalid
    if (!objStr) return;

    const sep = idx < entries.length - 1 ? " ;" : " .";
    ttl += `  :${pred} ${objStr}${sep}\n`;
  });

  // if all entries were skipped (null/empty), close the subject
  if (!ttl.trim().endsWith(".")) {
    ttl += `  a :Form .\n`;
  }
} else {
  // No answers yet — still produce a valid triple so TTL is non-empty
  ttl += `  a :Form .\n`;
}

// Ensure trailing newline
if (!ttl.endsWith("\n")) ttl += "\n";

// ---------- atomic write ----------
await fsp.mkdir(path.dirname(outPath), { recursive: true });
await fsp.writeFile(tmpPath, ttl, "utf8");
await fsp.rename(tmpPath, outPath);

console.log(`Wrote ${outPath}`);

