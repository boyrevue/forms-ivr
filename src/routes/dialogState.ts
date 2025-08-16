// src/routes/dialogState.ts
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const FORM_ID = "form1";
const paths = {
  instances: "out/instances.ttl",
  shapes: "out/shapes.ttl",
  answersTtl: "out/answers.ttl",
  plan: "out/slot-plan.json",
  nextScript: "scripts/next-as-json.mjs",
};

function runNode(argv: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(process.execPath, argv, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout?.on("data", d => (stdout += d.toString()));
    p.stderr?.on("data", d => (stderr += d.toString()));
    p.on("close", code => resolve({ code: code ?? 0, stdout, stderr }));
  });
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

export async function dialogStateHandler(_req: any, res: any) {
  try {
    const planRaw = await fs.readFile(paths.plan, "utf8").catch(() => null);
    if (!planRaw) {
      return res.json({ plan: { form: FORM_ID, status: "incomplete" }, next: null });
    }

    const plan = JSON.parse(planRaw);
    let next: any = null;
    if (plan.status !== "complete") {
      const nxt = await nextAsJson();
      next = nxt?.next ?? null;
    }

    res.json({ plan, next });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}

