#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const inFile = process.argv[2] || "ir.json";
const outDir = process.argv[3] || "out";
fs.mkdirSync(outDir, { recursive: true });

const ctx = {
  "@vocab": "https://example.org/form#",
  "xsd": "http://www.w3.org/2001/XMLSchema#",
  "id": "@id",
  "type": "@type",
  "Form": "Form",
  "Field": "Field",
  "Answer": "Answer",
  "Variant": "Variant",
  "name": "name",
  "questionText": "questionText",
  "controlType": "controlType",
  "containerKey": "containerKey",
  "cssPath": "cssPath",
  "default": "default",
  "helpText": "helpText",
  "helpSource": "helpSource",
  "hasField": { "@id": "hasField", "@type": "@id" },
  "hasVariant": { "@id": "hasVariant", "@type": "@id" },
  "hasAnswer": { "@id": "hasAnswer", "@type": "@id" },
  "value": "value",
  "label": "label",
  "visible": { "@id": "visible", "@type": "xsd:boolean" },
  "checked": { "@id": "checked", "@type": "xsd:boolean" },
  "locator": "locator",
  "required": { "@id": "required", "@type": "xsd:boolean" },
  "min": { "@id": "min", "@type": "xsd:integer" },
  "max": { "@id": "max", "@type": "xsd:integer" },
  "order": { "@id": "order", "@type": "xsd:integer" },
  "subLocatorMonth": "subLocatorMonth",
  "subLocatorYear": "subLocatorYear",
  "currentValue": "currentValue" // runtime value binding
};

const ir = JSON.parse(fs.readFileSync(inFile, "utf8"));
const formId = "urn:form/current";

const asId = (s) => s.replace(/[^A-Za-z0-9_-]+/g, "_");
const fields = [];
let idx = 0;

for (const f of ir) {
  const fid = asId(f.name || f.id || f.containerKey || `i${idx}`);
  const fieldNode = {
    id: `urn:field/${fid}`,
    type: ["Field"],
    order: idx++,
    name: f.name || null,
    questionText: f.question || "",
    controlType: f.controlType,
    containerKey: f.containerKey || null,
    cssPath: f.containerCssPath || null,
    default: f.default ?? null
  };

  if (f.help?.text) {
    fieldNode.helpText = f.help.text;
    fieldNode.helpSource = f.help.source || null;
  }

  if (f.constraints) {
    if (typeof f.constraints.required === "boolean") fieldNode.required = f.constraints.required;
    if (Number.isFinite(f.constraints.min)) fieldNode.min = f.constraints.min;
    if (Number.isFinite(f.constraints.max)) fieldNode.max = f.constraints.max;
  }

  // Date sub-locators
  if (f.controlType === "date" && f.subLocators) {
    if (f.subLocators.month) fieldNode.subLocatorMonth = f.subLocators.month;
    if (f.subLocators.year) fieldNode.subLocatorYear = f.subLocators.year;
  }

  // Answers / Variants
  if (f.controlType === "variants" && Array.isArray(f.variants)) {
    fieldNode.hasVariant = f.variants.map((v, vi) => {
      const vid = `urn:variant/${fid}/${vi}`;
      const variantNode = {
        id: vid,
        type: ["Variant"],
        controlType: v.type,
        visible: v.visible ?? true
      };
      if (v.radioName) variantNode.name = v.radioName;

      if (Array.isArray(v.answers)) {
        variantNode.hasAnswer = v.answers.map((a, ai) => {
          const aid = `urn:answer/${fid}/${v.type}/${ai}`;
          const ans = {
            id: aid,
            type: ["Answer"],
            value: String(a.value ?? ""),
            label: a.label ?? "",
            checked: !!a.checked,
            visible: !!a.visible,
            locator: a.locator || null
          };
          nodes.push(ans);
          return aid;
        });
      }
      if (v.selectLocator) variantNode.locator = v.selectLocator;
      nodes.push(variantNode);
      return vid;
    });
  } else if (Array.isArray(f.answers)) {
    fieldNode.hasAnswer = f.answers.map((a, ai) => {
      const aid = `urn:answer/${fid}/${ai}`;
      const ans = {
        id: aid,
        type: ["Answer"],
        value: String(a.value ?? ""),
        label: a.label ?? "",
        checked: !!a.checked,
        visible: !!a.visible,
        locator: a.locator || null
      };
      nodes.push(ans);
      return aid;
    });
  }

  nodes.push(fieldNode);
  fields.push(fieldNode.id);
}

// Assemble graph
const doc = {
  "@context": ctx,
  id: formId,
  type: ["Form"],
  name: "Extracted Form",
  hasField: fields
};

// Write JSON-LD as a framed array for convenience
const out = {
  "@context": ctx,
  "@graph": [doc, ...nodes]
};

const outFile = path.join(outDir, "form.jsonld");
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`Wrote ${outFile}`);

function nodes() { return _nodes; }
const _nodes = [];

