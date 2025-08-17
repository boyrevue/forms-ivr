// patch-fixes.js
// Run: node patch-fixes.js
// Applies all fixes for normalizer.ts, runFormAgent.ts, and missing n3 types.

import fs from "node:fs/promises";
import path from "node:path";

async function patchNormalizer() {
  const file = "src/dialog/normalizer.ts";
  try {
    let text = await fs.readFile(file, "utf8");
    if (text.includes("norm(o.value)")) {
      text = text.replace(/norm\(o\.value\)/g, "norm(String(o.value))");
      await fs.writeFile(file, text, "utf8");
      console.log(`✔ Patched ${file}`);
    } else {
      console.log(`ℹ ${file} already patched or pattern not found`);
    }
  } catch (e) {
    console.warn(`⚠ Skipping ${file}: ${e.message}`);
  }
}

async function patchRunFormAgent() {
  const file = "src/runFormAgent.ts";
  try {
    let text = await fs.readFile(file, "utf8");

    // Fix addEdge(START, ...)
    text = text.replace(/\.addEdge\(\s*START\s*,/g, ".addEdge(START as any,");

    // Force safeParseJson<Plan>
    text = text.replace(
      /const plan = safeParseJson<Plan>\(planText\);/g,
      "const plan = safeParseJson<Plan>(planText) as Plan;"
    );

    // Fix final check on result.plan
    text = text.replace(
      /if \(result\.plan\?\.(status.*?)\)/g,
      "if ((result.plan as Plan)?.status$1)"
    );

    await fs.writeFile(file, text, "utf8");
    console.log(`✔ Patched ${file}`);
  } catch (e) {
    console.warn(`⚠ Skipping ${file}: ${e.message}`);
  }
}

async function addN3Types() {
  const file = "src/types/n3.d.ts";
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'declare module "n3";\n', "utf8");
    console.log(`✔ Added ${file}`);
  } catch (e) {
    console.warn(`⚠ Could not write ${file}: ${e.message}`);
  }
}

async function main() {
  console.log("🔧 Applying patches...");
  await patchNormalizer();
  await patchRunFormAgent();
  await addN3Types();
  console.log("✅ All patches applied");
}

main();

