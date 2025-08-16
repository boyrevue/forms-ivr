:1,$d
i// src/routes/dialogStep.ts
import fs from "node:fs/promises";
import { validateWithJs } from "../jsSandbox";
import { shaclDryRunPut } from "../shaclDryRun";
import path from "node:path";
import { spawn } from "node:child_process";

const FORM_ID = "form1";
const paths = {
  instances: "out/instances.ttl",
  shapes: "out/shapes.ttl",
  answersTtl: "out/answers.ttl",
  answersJson: "answers.json",
  plan: "out/slot-plan.json",
  nextScript: "scripts/next-as-json.mjs",
  answersToRdf: "scripts/answers-to-rdf.mjs",
  rdfToPlan: "scripts/rdf-to-plan.mjs",
};

// ---- helpers ----
function runNode(cmdArgs: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(process.execPath, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout?.on("data", (d) => (stdout += d.toString()));
    p.stderr?.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function buildAnswersTTL() {
  const r = await runNode([
    paths.answersToRdf,
    "--json", paths.answersJson,
    "--out", paths.answersTtl,
    "--form-id", FORM_ID,
  ]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || "answers-to-rdf failed");
}

async function computePlan() {
  const r = await runNode([
    paths.rdfToPlan,
    "--instances", paths.instances,
    "--shapes", paths.shapes,
    "--answers", paths.answersTtl,
    "--form-id", FORM_ID,
    "--out", paths.plan,
  ]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || "rdf-to-plan failed");
  return JSON.parse(await fs.readFile(paths.plan, "utf8"));
}

async function nextAsJson() {
  const r = await runNode([
    paths.nextScript,
    "--instances", paths.instances,
    "--plan", paths.plan,
    "--answers", paths.answersTtl,
  ]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || "next-as-json failed");
  return JSON.parse(r.stdout);
}

// ---- exported route handler ----
export async function dialogStepHandler(req: any, res: any) {
  try {
    const { field, value } = req.body || {};
    if (!field) {
      return res.status(400).json({ status: "error", message: "Missing 'field' in body" });
    }

    // Load current answers
    let ctx = { form: FORM_ID, values: {} as Record<string, any> };
    try {
      ctx = JSON.parse(await fs.readFile(paths.answersJson, "utf8"));
    } catch {}
    ctx.values ||= {};

    // 1) JS validator
    const js = await validateWithJs(field, value, ctx.values);
    if (!js.ok) {
      return res.json({ status: "invalid", field, message: js.message });
    }

    // 2) SHACL dry-run
    const shacl = await shaclDryRunPut(FORM_ID, field, js.value);
    if (!shacl.ok) {
      return res.json({ status: "invalid", field, message: shacl.message });
    }

    // 3) Save accepted answer
    ctx.values[field] = js.value;
    await fs.writeFile(paths.answersJson, JSON.stringify(ctx, null, 2), "utf8");

    // 4) Recompute plan
    await buildAnswersTTL();
    const plan = await computePlan();

    if (plan.status === "complete" || (plan.missingCount ?? 0) === 0) {
      return res.json({ status: "complete", done: true });
    }

    const nxt = await nextAsJson();
    const next = nxt?.next;
    return res.json({
      status: plan.status,
      next: next
        ? {
            id: next.id,
            question: next.question ?? next.label ?? next.id,
            options: (next.options || []).map((o: any) => ({
              value: String(o.value ?? ""),
              label: String(o.label ?? o.value ?? ""),
            })),
          }
        : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
// src/routes/dialogStep.ts
import type { Request, Response } from "express";
import { validateWithJs } from "../jsSandbox";
import { shaclDryRunPut } from "../shaclDryRun";
import { readFile, writeFile } from "node:fs/promises";

const FORM_ID = "form1";
const ANSWERS_FILE = "answers.json";

/**
 * POST /dialog/step
 * Body: { field?: string, value: any }
 */
export async function dialogStep(req: Request, res: Response) {
  const { field, value } = req.body || {};
  if (!field) {
    return res.status(400).json({ status: "error", message: "Missing field id" });
  }

  // ---- 1) Load current context
  let ctx: any = {};
  try {
    ctx = JSON.parse(await readFile(ANSWERS_FILE, "utf8"));
  } catch {
    ctx = { form: FORM_ID, values: {} };
  }

  // ---- 2) Run JS validator (if available)
  const jsResult = await validateWithJs(field, value, ctx.values);
  if (!jsResult.ok) {
    return res.json({
      status: "invalid",
      field,
      message: jsResult.message,
    });
  }

  // ---- 3) Run SHACL dry-run (structural constraints)
  const shaclResult = await shaclDryRunPut(FORM_ID, field, jsResult.value);
  if (!shaclResult.ok) {
    return res.json({
      status: "invalid",
      field,
      message: shaclResult.message,
    });
  }

  // ---- 4) Persist accepted value
  ctx.values[field] = jsResult.value;
  await writeFile(ANSWERS_FILE, JSON.stringify(ctx, null, 2), "utf8");

  // ---- 5) Ask the planner for the next question
  // (assumes you have a helper script `next-as-json.mjs`)
  const { spawn } = await import("node:child_process");
  const run = (argv: string[]) =>
    new Promise<string>((resolve) => {
      const p = spawn(process.execPath, argv, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", () => resolve(out));
    });

  const out = await run([
    "./scripts/next-as-json.mjs",
    "--instances",
    "out/instances.ttl",
    "--plan",
    "out/slot-plan.json",
    "--answers",
    "out/answers.ttl",
  ]);

  let next: any = null;
  try {
    next = JSON.parse(out);
  } catch (e) {
    console.error("plan:next parse error", e, out);
  }

  return res.json(next || { status: "ok", field, saved: true });
}

