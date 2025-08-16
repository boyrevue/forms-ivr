// src/routes/dialogReset.ts
import fs from "node:fs/promises";

const paths = {
  answersJson: "answers.json",
  answersTtl: "out/answers.ttl",
  plan: "out/slot-plan.json",
};

export async function dialogResetHandler(req: any, res: any) {
  try {
    const { all = true, clear = [] } = req.body || {};

    if (all) {
      await fs.writeFile(paths.answersJson, JSON.stringify({ values: {} }, null, 2), "utf8");
      await fs.writeFile(paths.answersTtl, "", "utf8").catch(() => {});
      await fs.writeFile(paths.plan, JSON.stringify({}), "utf8").catch(() => {});
      return res.json({ status: "reset", all: true });
    }

    // selective clear
    let ctx = { values: {} as Record<string, any> };
    try {
      ctx = JSON.parse(await fs.readFile(paths.answersJson, "utf8"));
    } catch {}
    for (const f of clear) delete ctx.values[f];
    await fs.writeFile(paths.answersJson, JSON.stringify(ctx, null, 2), "utf8");
    res.json({ status: "reset", cleared: clear });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}

