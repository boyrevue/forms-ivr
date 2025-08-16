// scripts/validate.mjs
import fs from "node:fs/promises";
import { Parser } from "n3";
import rdf from "@zazuko/env";
import SHACLValidator from "rdf-validate-shacl";

async function readTurtleAsDataset(filePath) {
  const ttl = await fs.readFile(filePath, "utf8");
  const quads = new Parser({ format: "text/turtle" }).parse(ttl);
  const ds = rdf.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}
const exists = async p => !!(await fs.stat(p).catch(() => null));

function boolConforms(report) {
  if (typeof report?.conforms === "function") return report.conforms();
  if (typeof report?.conforms === "boolean") return report.conforms;
  return undefined;
}

(async () => {
  const data = await readTurtleAsDataset("out/instances.ttl");
  if (await exists("out/answers.ttl")) {
    const answers = await readTurtleAsDataset("out/answers.ttl");
    data.addAll(answers);
  }
  const shapes = await readTurtleAsDataset("out/shapes.ttl");

  const validator = new SHACLValidator(shapes, { factory: rdf });
  const report = await validator.validate(data);

  const conforms = boolConforms(report);
  console.log("conforms:", conforms);

  if (conforms === false && Array.isArray(report.results)) {
    for (const r of report.results) {
      const msg = (r.message || []).map(m => m.value || String(m)).join(" ");
      const focus = r.focusNode?.value || "";
      const path = r.path?.value || "";
      const sev = r.severity?.value?.split("#").pop() || "";
      console.log(`• [${sev}] ${msg}  focus=${focus}  path=${path}`);
    }
  }
})();

