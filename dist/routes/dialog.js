"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dialogStateHandler = dialogStateHandler;
exports.dialogResetHandler = dialogResetHandler;
exports.dialogStepHandler = dialogStepHandler;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const n3_1 = require("n3");
const paths = {
    instances: "out/instances.ttl",
    shapes: "out/shapes.ttl",
    answersTtl: "out/answers.ttl",
    answersJson: "answers.json",
    plan: "out/plan.json",
    nextScript: "scripts/next-as-json.mjs",
    answersToRdf: "scripts/answers-to-rdf.mjs",
    rdfToPlan: "scripts/rdf-to-plan.mjs",
};
const FORM_ID = process.env.FORM_ID || "form1";
const PREFIX_BASE = "http://example.org/form#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const { namedNode } = n3_1.DataFactory;
/* -------------------- small process helpers -------------------- */
function runNode(cmdArgs) {
    return new Promise((resolve) => {
        const p = (0, node_child_process_1.spawn)(process.execPath, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        p.stdout?.on("data", (d) => (stdout += d.toString()));
        p.stderr?.on("data", (d) => (stderr += d.toString()));
        p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
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
        await promises_1.default.writeFile(paths.answersJson, JSON.stringify({ form: FORM_ID, values: {} }, null, 2));
    }
}
async function buildAnswers() {
    const res = await runNode([
        paths.answersToRdf, "--json", paths.answersJson, "--out", paths.answersTtl, "--form-id", FORM_ID,
    ]);
    if (res.code !== 0)
        throw new Error(res.stderr || res.stdout);
}
async function computePlan() {
    const res = await runNode([
        paths.rdfToPlan,
        "--instances", paths.instances,
        "--shapes", paths.shapes,
        "--answers", paths.answersTtl,
        "--form-id", FORM_ID,
        "--out", paths.plan,
    ]);
    if (res.code !== 0)
        throw new Error(res.stderr || res.stdout);
    const plan = JSON.parse(await promises_1.default.readFile(paths.plan, "utf8"));
    return plan;
}
async function nextAsJson() {
    const res = await runNode([paths.nextScript, "--instances", paths.instances, "--plan", paths.plan]);
    if (res.code !== 0)
        throw new Error(res.stderr || res.stdout);
    return JSON.parse(res.stdout);
}
let SHAPES_CACHE = null;
async function loadShapesMeta() {
    if (SHAPES_CACHE)
        return SHAPES_CACHE;
    const text = await promises_1.default.readFile(paths.shapes, "utf8");
    const store = new n3_1.Store(new n3_1.Parser().parse(text));
    const map = new Map();
    // Find all sh:PropertyShape having sh:path :<field>
    const SH = "http://www.w3.org/ns/shacl#";
    const formNs = PREFIX_BASE;
    // For each triple ?shape sh:path :fieldId
    const quads = store.getQuads(null, namedNode(`${SH}path`), null, null);
    for (const q of quads) {
        const pathObj = q.object;
        if (pathObj.termType !== "NamedNode")
            continue;
        if (!pathObj.value.startsWith(formNs))
            continue;
        const fieldId = pathObj.value.slice(formNs.length);
        const shape = q.subject;
        const meta = {};
        const dtQuad = store.getQuads(shape, namedNode(`${SH}datatype`), null, null)[0];
        if (dtQuad?.object?.termType === "NamedNode") {
            meta.datatype = dtQuad.object.value; // e.g. xsd:integer
        }
        const minQ = store.getQuads(shape, namedNode(`${SH}minInclusive`), null, null)[0];
        const maxQ = store.getQuads(shape, namedNode(`${SH}maxInclusive`), null, null)[0];
        if (minQ?.object?.termType === "Literal")
            meta.minInclusive = Number(minQ.object.value);
        if (maxQ?.object?.termType === "Literal")
            meta.maxInclusive = Number(maxQ.object.value);
        map.set(fieldId, meta);
    }
    SHAPES_CACHE = map;
    return map;
}
async function getFieldMeta(fieldId) {
    const m = await loadShapesMeta();
    return m.get(fieldId) ?? {};
}
function shortDatatype(iri) {
    if (!iri)
        return undefined;
    if (iri === `${XSD}integer`)
        return "integer";
    if (iri === `${XSD}boolean`)
        return "boolean";
    if (iri === `${XSD}decimal` || iri === `${XSD}double` || iri === `${XSD}float`)
        return "decimal";
    if (iri === `${XSD}string`)
        return "string";
    return undefined;
}
function normalizeValue(raw, slot, meta) {
    if (raw == null)
        return null;
    let v = raw;
    // 1) If options present, map speech/digits to canonical value
    if (slot.options?.length) {
        const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const nRaw = norm(String(raw));
        const found = slot.options.find((o) => norm(String(o.value)) === nRaw) ||
            slot.options.find((o) => norm(o.label) === nRaw) ||
            slot.options.find((o) => norm(o.label).startsWith(nRaw));
        if (found)
            v = found.value;
    }
    // 2) Coerce datatype based on SHACL
    const dt = shortDatatype(meta.datatype);
    switch (dt) {
        case "integer": {
            const n = typeof v === "number" ? v : parseInt(String(v), 10);
            if (!Number.isFinite(n))
                throw new Error(`Expected an integer for ${slot.id}`);
            v = n;
            break;
        }
        case "decimal": {
            const n = typeof v === "number" ? v : parseFloat(String(v));
            if (!Number.isFinite(n))
                throw new Error(`Expected a number for ${slot.id}`);
            v = n;
            break;
        }
        case "boolean": {
            if (typeof v === "string") {
                const low = v.toLowerCase();
                if (["true", "yes", "1"].includes(low))
                    v = true;
                else if (["false", "no", "0"].includes(low))
                    v = false;
            }
            v = Boolean(v);
            break;
        }
        case "string":
        default:
            v = String(v);
    }
    // 3) min/max (numbers only)
    if (typeof v === "number") {
        if (meta.minInclusive != null && v < meta.minInclusive) {
            throw new Error(`${slot.id} must be ≥ ${meta.minInclusive}`);
        }
        if (meta.maxInclusive != null && v > meta.maxInclusive) {
            throw new Error(`${slot.id} must be ≤ ${meta.maxInclusive}`);
        }
    }
    return v;
}
/* -------------------- shared handlers -------------------- */
// Return current plan + next
async function dialogStateHandler(_req, res) {
    try {
        await ensureFiles();
        await buildAnswers();
        const plan = await computePlan();
        let next = null;
        if (plan.status !== "complete" && (plan.missingCount ?? 0) > 0) {
            const nxt = await nextAsJson();
            next = nxt?.next ?? null;
        }
        res.json({ plan, next });
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message || e) });
    }
}
// Reset answers: clear all or specific fields
async function dialogResetHandler(req, res) {
    try {
        await ensureFiles();
        const body = req.body || {};
        let answers = { form: FORM_ID, values: {} };
        try {
            answers = JSON.parse(await promises_1.default.readFile(paths.answersJson, "utf8"));
        }
        catch { }
        if (body.all) {
            answers.values = {};
        }
        else if (Array.isArray(body.clear)) {
            for (const k of body.clear)
                delete answers.values[k];
        }
        else if (typeof body.field === "string") {
            delete answers.values[body.field];
        }
        await promises_1.default.writeFile(paths.answersJson, JSON.stringify(answers, null, 2));
        await buildAnswers();
        const plan = await computePlan();
        let next = null;
        if (plan.status !== "complete" && (plan.missingCount ?? 0) > 0) {
            const nxt = await nextAsJson();
            next = nxt?.next ?? null;
        }
        res.json({ status: "ok", plan, next });
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message || e) });
    }
}
/* -------------------- /dialog/step with normalization -------------------- */
async function dialogStepHandler(req, res) {
    try {
        await ensureFiles();
        // 1) recompute current plan
        await buildAnswers();
        let plan = await computePlan();
        // If already complete
        if (plan.status === "complete" || (plan.missingCount ?? 0) === 0) {
            return res.json({ status: "complete", done: true });
        }
        // If value provided, normalize and write it to the current 'next'
        if (req.body?.value !== undefined) {
            const nxtJson = await nextAsJson();
            const next = nxtJson?.next;
            const id = next?.id;
            if (!id)
                return res.status(500).json({ error: "Could not determine next field id." });
            // Pull datatype/range from shapes
            const meta = await getFieldMeta(id);
            // Normalize based on options + SHACL datatype/range
            let normalized;
            try {
                normalized = normalizeValue(req.body.value, next, meta);
            }
            catch (err) {
                return res.status(400).json({ error: String(err?.message || err) });
            }
            // Persist into answers.json
            const answers = JSON.parse(await promises_1.default.readFile(paths.answersJson, "utf8"));
            answers.values = answers.values || {};
            answers.values[id] = normalized;
            await promises_1.default.writeFile(paths.answersJson, JSON.stringify(answers, null, 2));
            // Recompute
            await buildAnswers();
            plan = await computePlan();
            if (plan.status === "complete" || (plan.missingCount ?? 0) === 0) {
                return res.json({ status: "complete", done: true });
            }
        }
        // Return the next prompt
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
