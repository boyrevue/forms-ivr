// src/shaclDryRun.ts
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const answersToRdf = "scripts/answers-to-rdf.mjs";
const rdfValidate  = "scripts/validate.mjs";

function runNode(argv: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(process.execPath, argv, { stdio: ["ignore","pipe","pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", d => (stdout += d));
    p.stderr.on("data", d => (stderr += d));
    p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

export async function shaclDryRunPut(
  formId: string,
  fieldId: string,
  value: any
): Promise<{ ok: true } | { ok: false; message: string }> {
  const raw = await readFile("answers.json", "utf8").catch(() => JSON.stringify({ form: formId, values: {} }));
  const json = JSON.parse(raw);
  json.values = json.values || {};
  json.values[fieldId] = value;

  const tmp = await mkdtemp(join(tmpdir(), "shacl-"));
  const tmpJson = join(tmp, "answers.json");
  const tmpTtl  = join(tmp, "answers.ttl");
  const tmpInst = join(tmp, "instances.ttl");

  try {
    await writeFile(tmpJson, JSON.stringify(json, null, 2), "utf8");

    // answers→ttl
    let r = await runNode([answersToRdf, "--json", tmpJson, "--out", tmpTtl, "--form-id", formId]);
    if (r.code !== 0) {
      return { ok: false, message: r.stderr || r.stdout || "answers-to-rdf failed" };
    }

    // validate
    r = await runNode([rdfValidate, "--form-id", formId, "--instances", tmpInst, "--answers", tmpTtl]);

    const conforms = /conforms:\s*true/i.test(r.stdout);
    if (!conforms) {
      const detail = r.stdout.trim() || r.stderr.trim();
      return { ok: false, message: `SHACL validation failed: ${detail}` };
    }
    return { ok: true };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

