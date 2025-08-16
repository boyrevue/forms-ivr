// scripts/ir-to-rdf.mjs
// Convert our extractor IR (JSON) into:
//   • out/instances.ttl  (Form, Fields, Options)
//   • out/shapes.ttl     (SHACL shapes for constraints/enums)
//
// Usage:
//   node scripts/ir-to-rdf.mjs --in ir.json --out ./out --form-id form1
//
import fs from "fs";
import path from "path";
import minimist from "minimist";

const argv = minimist(process.argv.slice(2), {
  string: ["in", "out", "form-id"],
  alias: { i: "in", o: "out", f: "form-id" },
});
if (!argv.in) {
  console.error("Missing --in <path-to-ir.json>");
  process.exit(1);
}
const outDir = argv.out || "./out";
const formId = (argv["form-id"] || "form").trim();
const PREFIX_BASE = "http://example.org/form#";

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const slug = (s) => {
  const base = String(s || "").trim() || "field";
  let t = base.replace(/[^A-Za-z0-9_]+/g, "_");
  if (!/^[A-Za-z_]/.test(t)) t = "f_" + t;
  return t;
};
const esc = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n");

const typeMap = {
  number: "NumberField",
  select: "SelectField",
  radio: "RadioField",
  variants: "VariantsField",
  date: "DateField",
  text: "TextField",
};

function collectOptions(item) {
  const opts = [];
  const push = (a) => {
    for (const o of a || []) {
      const v = (o.value ?? "").toString();
      const lbl = (o.label ?? "").toString();
      // skip empty placeholders
      if (!v && lbl.toLowerCase().includes("please select")) continue;
      if (!v && !lbl) continue;
      opts.push({ value: v, label: lbl });
    }
  };
  if (Array.isArray(item.answers)) push(item.answers);
  if (Array.isArray(item.variants)) {
    for (const v of item.variants) push(v.answers);
  }
  // de-dup on value
  const seen = new Set();
  return opts.filter((o) => {
    const k = o.value;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fieldDatatype(item) {
  if (item.controlType === "number") return "xsd:integer";
  if (item.controlType === "date") return "xsd:string"; // refine later if needed
  return "xsd:string";
}

function buildInstancesTTL(ir, formIri) {
  const prefixes = [
    `@prefix : <${PREFIX_BASE}> .`,
    "@prefix sh: <http://www.w3.org/ns/shacl#> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    "",
  ].join("\n");

  const ontology = `
:Form a rdfs:Class .
:Field a rdfs:Class .
:NumberField rdfs:subClassOf :Field .
:SelectField rdfs:subClassOf :Field .
:RadioField  rdfs:subClassOf :Field .
:VariantsField rdfs:subClassOf :Field .
:DateField rdfs:subClassOf :Field .
:TextField rdfs:subClassOf :Field .
:Option a rdfs:Class .

:hasField a rdf:Property ; rdfs:domain :Form ; rdfs:range :Field .
:hasOption a rdf:Property ; rdfs:domain :Field ; rdfs:range :Option .
:name a rdf:Property ; rdfs:range xsd:string .
:htmlId a rdf:Property ; rdfs:range xsd:string .
:value a rdf:Property ; rdfs:range xsd:string .
:controlType a rdf:Property ; rdfs:range xsd:string .
:question a rdf:Property ; rdfs:range xsd:string .
:helpText a rdf:Property ; rdfs:range xsd:string .
`.trim();

  let ttl = prefixes + ontology + "\n\n";

  ttl += `:${formIri} a :Form ; rdfs:label "${esc(formIri)}" .\n`;

  (ir || []).forEach((item, idx) => {
    if (!item || !item.controlType) return;

    const fieldId =
      slug(item.name || item.id || item.containerKey || `field_${idx}`);
    const fieldType = typeMap[item.controlType] || "Field";

    ttl += `\n:${formIri} :hasField :${fieldId} .\n`;

    // Property
    ttl += `:${fieldId} a rdf:Property .\n`;

    // Field node
    ttl += `:${fieldId} a :${fieldType} ;\n`;
    if (item.question) ttl += `  :question "${esc(item.question)}" ;\n`;
    if (item.name) ttl += `  :name "${esc(item.name)}" ;\n`;
    if (item.id) ttl += `  :htmlId "${esc(item.id)}" ;\n`;
    ttl += `  :controlType "${esc(item.controlType)}" .\n`;

    // Options
    const options = collectOptions(item);
    options.forEach((o, j) => {
      const optId = slug(`${fieldId}_opt_${o.value || o.label || j}`);
      ttl += `:${fieldId} :hasOption :${optId} .\n`;
      ttl += `:${optId} a :Option ; :value "${esc(o.value)}" ; rdfs:label "${esc(
        o.label || o.value
      )}" .\n`;
    });

    if (item.help && item.help.text) {
      ttl += `:${fieldId} :helpText "${esc(item.help.text)}" .\n`;
    }
  });

  return ttl + "\n";
}

function buildShapesTTL(ir, formIri) {
  const prefixes = [
    `@prefix : <${PREFIX_BASE}> .`,
    "@prefix sh: <http://www.w3.org/ns/shacl#> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    "",
  ].join("\n");

  let ttl = prefixes;

  ttl += `
:FormShape
  a sh:NodeShape ;
  sh:targetClass :Form .
`.trim() + "\n";

  (ir || []).forEach((item, idx) => {
    if (!item || !item.controlType) return;
    const fieldId =
      slug(item.name || item.id || item.containerKey || `field_${idx}`);
    const shapeId = `${fieldId}Shape`;
    const dt = fieldDatatype(item);
    const isRequired = !!(item.constraints && item.constraints.required);

    // enum
    const options = collectOptions(item).filter((o) => o.value !== "");
    const enumList =
      options.length > 0
        ? `( ${options.map((o) => `"${esc(o.value)}"`).join(" ")} )`
        : null;

    ttl += `\n:${shapeId} a sh:PropertyShape ;\n`;
    ttl += `  sh:path :${fieldId} ;\n`;
    if (item.question) ttl += `  sh:name "${esc(item.question)}" ;\n`;
    ttl += `  sh:datatype ${dt} ;\n`;
    if (isRequired) ttl += `  sh:minCount 1 ;\n`;
    if (item.constraints?.min != null)
      ttl += `  sh:minInclusive ${item.constraints.min} ;\n`;
    if (item.constraints?.max != null)
      ttl += `  sh:maxInclusive ${item.constraints.max} ;\n`;
    if (enumList) ttl += `  sh:in ${enumList} ;\n`;
    ttl = ttl.replace(/;\n$/, "\n"); // clean trailing ;
    ttl += `.\n`;

    ttl += `:FormShape sh:property :${shapeId} .\n`;
  });

  return ttl + "\n";
}

// ---- main
const ir = read(argv.in);
fs.mkdirSync(outDir, { recursive: true });

const formIri = slug(formId);
const instancesTTL = buildInstancesTTL(ir, formIri);
const shapesTTL = buildShapesTTL(ir, formIri);

fs.writeFileSync(path.join(outDir, "instances.ttl"), instancesTTL, "utf8");
fs.writeFileSync(path.join(outDir, "shapes.ttl"), shapesTTL, "utf8");

console.log(`Wrote:
  • ${path.join(outDir, "instances.ttl")}
  • ${path.join(outDir, "shapes.ttl")}
`);

