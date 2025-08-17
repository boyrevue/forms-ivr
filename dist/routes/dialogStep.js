"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dialogStepHandler = dialogStepHandler;
const node_child_process_1 = require("node:child_process");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
// --- Script paths (match your repo) ---
const paths = {
    instances: "out/instances.ttl",
    shapes: "out/shapes.ttl",
    answersTtl: "out/answers.ttl",
    answersJson: "answers.json",
    plan: "out/plan.json",
    answersToRdf: "scripts/answers-to-rdf.mjs",
    rdfToPlan: "scripts/rdf-to-plan.mjs",
    nextScript: "scripts/next-as-json.mjs",
};
// --- small runner ---
function runNode(cmdArgs) {
    return new Promise((resolve) => {
        const p = (0, node_child_process_1.spawn)(process.execPath, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        p.stdout.on("data", d => (stdout += d.toString()));
        p.stderr.on("data", d => (stderr += d.toString()));
        p.on("close", code => resolve({ code: code ?? 0, stdout, stderr }));
    });
}
async function ensureFiles() {
    for (const p of [paths.instances, paths.shapes]) {
        try {
            await promises_1.default.access(p);
        }
        catch {
            throw new Error(`Missing required file: ${p}`);
        }
    }
    try {
        await promises_1.default.access(paths.answersJson);
    }
    catch {
        await promises_1.default.mkdir(node_path_1.default.dirname(paths.answersJson), { recursive: true });
        await promises_1.default.writeFile(paths.answersJson, JSON.stringify({ form: "form1", values: {} }, null, 2), "utf8");
    }
}
async function buildAnswers() {
    const r = await runNode([
        paths.answersToRdf, "--json", paths.answersJson, "--out", paths.answersTtl, "--form-id", "form1",
    ]);
    if (r.code !== 0)
        throw new Error(r.stderr || r.stdout);
}
async function computePlan() {
    const r = await runNode([
        paths.rdfToPlan,
        "--instances", paths.instances,
        "--shapes", paths.shapes,
        "--answers", paths.answersTtl,
        "--form-id", "form1",
        "--out", paths.plan,
    ]);
    if (r.code !== 0)
        throw new Error(r.stderr || r.stdout);
    return JSON.parse(await promises_1.default.readFile(paths.plan, "utf8"));
}
async function nextAsJson() {
    const r = await runNode([paths.nextScript, "--instances", paths.instances, "--plan", paths.plan]);
    if (r.code !== 0)
        throw new Error(r.stderr || r.stdout);
    return JSON.parse(r.stdout);
}
// --- value normalizer (cheap & cheerful; SHACL/JS will still guard) ---
function normalizeForField(fieldId, raw) {
    const s = typeof raw === "string" ? raw.trim() : String(raw ?? "");
    switch (fieldId) {
        case "vehicleValue":
        case "personalMilesPerYear":
            return /^\d+$/.test(s) ? Number(s) : s; // keep as string if not pure digits
        default:
            return s;
    }
}
// --- handler ---
async function dialogStepHandler(req, res) {
    try {
        await ensureFiles();
        // (1) compute current plan
        await buildAnswers();
        let plan = await computePlan();
        // already complete?
        if (plan.status === "complete" || (plan.missingCount ?? 0) === 0) {
            return res.json({ status: "complete", done: true });
        }
        // (2) write provided value to current "next"
        if (req.body?.value !== undefined) {
            const nxt = await nextAsJson();
            const id = nxt?.next?.id;
            if (!id)
                return res.status(500).json({ error: "Could not determine next field id." });
            const answers = JSON.parse(await promises_1.default.readFile(paths.answersJson, "utf8"));
            answers.values = answers.values || {};
            const normalized = normalizeForField(id, req.body.value);
            answers.values[id] = normalized;
            await promises_1.default.writeFile(paths.answersJson, JSON.stringify(answers, null, 2), "utf8");
            // recompute
            await buildAnswers();
            plan = await computePlan();
            if (plan.status === "complete" || (plan.missingCount ?? 0) === 0) {
                return res.json({ status: "complete", done: true });
            }
        }
        // (3) return next prompt
        const nxt = await nextAsJson();
        const next = nxt?.next;
        if (!next?.id)
            return res.json({ status: plan.status, next: null });
        return res.json({
            status: plan.status,
            next: {
                id: next.id,
                question: next.question ?? next.label ?? next.id,
                options: (next.options || []).map((o) => ({
                    value: String(o.value ?? ""),
                    label: String(o.label ?? o.value ?? ""),
                })),
            },
        });
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message || e) });
    }
}
