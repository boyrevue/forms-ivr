"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dialogStateHandler = dialogStateHandler;
// src/routes/dialogState.ts
const promises_1 = __importDefault(require("node:fs/promises"));
const node_child_process_1 = require("node:child_process");
const FORM_ID = "form1";
const paths = {
    instances: "out/instances.ttl",
    shapes: "out/shapes.ttl",
    answersTtl: "out/answers.ttl",
    plan: "out/slot-plan.json",
    nextScript: "scripts/next-as-json.mjs",
};
function runNode(argv) {
    return new Promise((resolve) => {
        const p = (0, node_child_process_1.spawn)(process.execPath, argv, { stdio: ["ignore", "pipe", "pipe"] });
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
    if (r.code !== 0)
        throw new Error(r.stderr || r.stdout || "next-as-json failed");
    return JSON.parse(r.stdout);
}
async function dialogStateHandler(_req, res) {
    try {
        const planRaw = await promises_1.default.readFile(paths.plan, "utf8").catch(() => null);
        if (!planRaw) {
            return res.json({ plan: { form: FORM_ID, status: "incomplete" }, next: null });
        }
        const plan = JSON.parse(planRaw);
        let next = null;
        if (plan.status !== "complete") {
            const nxt = await nextAsJson();
            next = nxt?.next ?? null;
        }
        res.json({ plan, next });
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message || e) });
    }
}
