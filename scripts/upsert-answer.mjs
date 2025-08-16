// scripts/upsert-answer.mjs
import fs from "node:fs/promises";

const args = Object.fromEntries(process.argv.slice(2).map((a,i,arr)=>a.startsWith("--")?[a.slice(2),arr[i+1]]:[]).filter(Boolean));
const answersPath = args.json || "answers.json";
const field = args.field;
let value = args.value;

if (!field || value === undefined) {
  console.error("Usage: node scripts/upsert-answer.mjs --field usage_type_id --value 2 [--json answers.json]");
  process.exit(1);
}
if (/^-?\d+$/.test(String(value))) value = Number(value);

const form = args.form || "form1";

let data;
try { data = JSON.parse(await fs.readFile(answersPath, "utf8")); }
catch { data = { form, values: {} }; }

data.form = form;
data.values = data.values || {};
data.values[field] = value;

await fs.writeFile(answersPath, JSON.stringify(data, null, 2));
console.log(JSON.stringify({ ok: true, updated: { [field]: value } }, null, 2));

