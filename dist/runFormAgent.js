"use strict";
// src/runFormAgent.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const promises_2 = __importDefault(require("node:readline/promises"));
const node_process_1 = require("node:process");
const n3_1 = require("n3");
const langgraph_1 = require("@langchain/langgraph");
const langgraph_checkpoint_1 = require("@langchain/langgraph-checkpoint");
const VERBOSE = !!process.env.VERBOSE;
const PREFIX = "http://example.org/form#";
const SH = "http://www.w3.org/ns/shacl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
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
// ---------- utilities ----------
async function ensureFile(p, contents = "") {
    try {
        await promises_1.default.access(p);
    }
    catch {
        await promises_1.default.mkdir(node_path_1.default.dirname(p), { recursive: true });
        await promises_1.default.writeFile(p, contents, "utf8");
    }
}
async function readTTLAsStore(file) {
    const text = await promises_1.default.readFile(file, "utf8");
    const store = new n3_1.Store();
    const parser = new n3_1.Parser();
    store.addQuads(parser.parse(text));
    return store;
}
function countQuads(store) {
    // @ts-ignore N3.Store quads
    const q = store.getQuads(null, null, null, null);
    return q.length;
}
function detectIntegerFields(shapes) {
    const set = new Set();
    const quads = shapes.getQuads(null, n3_1.DataFactory.namedNode(`${SH}property`), null, null);
    for (const q of quads) {
        const shapeNode = q.object;
        const pathQ = shapes.getQuads(shapeNode, n3_1.DataFactory.namedNode(`${SH}path`), null, null)[0];
        const dtypeQ = shapes.getQuads(shapeNode, n3_1.DataFactory.namedNode(`${SH}datatype`), null, null)[0];
        if (!pathQ || !dtypeQ)
            continue;
        const pathNode = pathQ.object;
        const dt = dtypeQ.object.value;
        if (!pathNode.value.startsWith(PREFIX))
            continue;
        const local = pathNode.value.slice(PREFIX.length);
        if (dt === `${XSD}integer`)
            set.add(local);
    }
    return set;
}
async function runNode(cmdArgs, { captureStdout = true } = {}) {
    return new Promise((resolve) => {
        const p = (0, node_child_process_1.spawn)(process.execPath, cmdArgs, {
            stdio: captureStdout ? ["ignore", "pipe", "pipe"] : "inherit",
        });
        let stdout = "";
        let stderr = "";
        if (captureStdout && p.stdout)
            p.stdout.on("data", (d) => (stdout += d.toString()));
        if (captureStdout && p.stderr)
            p.stderr.on("data", (d) => (stderr += d.toString()));
        p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });
}
function safeParseJson(s) {
    try {
        return JSON.parse(s);
    }
    catch { }
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
        const snippet = s.slice(start, end + 1);
        return JSON.parse(snippet);
    }
    throw new Error(`Could not parse JSON from:\n${s}`);
}
function toLocalFieldName(maybeIri) {
    if (!maybeIri)
        return undefined;
    return maybeIri.startsWith(PREFIX) ? maybeIri.slice(PREFIX.length) : maybeIri;
}
function normalizeNextPayload(stdout) {
    const parsed = safeParseJson(stdout);
    const payload = parsed?.next ?? parsed ?? {};
    const localId = payload.id ??
        toLocalFieldName(payload.path);
    const question = payload.label ??
        payload.question ??
        (localId ?? "(no id)");
    const optionsRaw = Array.isArray(payload.options) ? payload.options : [];
    const options = optionsRaw
        .map((o) => ({
        value: String(o?.value ?? ""),
        label: String(o?.label ?? o?.value ?? ""),
    }))
        .filter((o) => o.label && o.value !== "");
    return { localId, question, options };
}
// ---------- nodes ----------
async function nodeAnswersToRdf(state) {
    if (VERBOSE)
        console.log("[answersToRdf] building TTL from answers.json");
    try {
        await promises_1.default.access(state.paths.answersJson);
    }
    catch {
        await promises_1.default.writeFile(state.paths.answersJson, JSON.stringify({ form: state.formId, values: {} }, null, 2), "utf8");
    }
    const args = [
        state.paths.answersToRdf,
        "--json",
        state.paths.answersJson,
        "--out",
        state.paths.answersTtl,
        "--form-id",
        state.formId,
    ];
    const res = await runNode(args);
    if (res.code !== 0)
        throw new Error(`answers-to-rdf failed:\n${res.stderr || res.stdout}`);
    if (VERBOSE)
        process.stdout.write(res.stdout);
    return {};
}
async function nodeRdfToPlan(state) {
    if (VERBOSE)
        console.log("[rdfToPlan] computing plan from instances/shapes/answers");
    const args = [
        state.paths.rdfToPlan,
        "--instances",
        state.paths.instances,
        "--shapes",
        state.paths.shapes,
        "--answers",
        state.paths.answersTtl,
        "--form-id",
        state.formId,
        "--out",
        state.paths.plan,
    ];
    const res = await runNode(args);
    if (res.code !== 0)
        throw new Error(`rdf-to-plan failed:\n${res.stderr || res.stdout}`);
    if (VERBOSE)
        process.stdout.write(res.stdout);
    const planText = await promises_1.default.readFile(state.paths.plan, "utf8");
    const plan = safeParseJson(planText);
    if (VERBOSE)
        console.log("[rdfToPlan] plan:", JSON.stringify(plan, null, 2));
    if (plan.status === "complete" || (plan.missingCount ?? 0) === 0) {
        return { plan, next: null, question: null, options: null };
    }
    // Ask next-as-json for the rich "next" (with id + options)
    const resNext = await runNode([
        state.paths.nextScript,
        "--instances",
        state.paths.instances,
        "--plan",
        state.paths.plan,
    ], { captureStdout: true });
    if (resNext.code !== 0)
        throw new Error(`next-as-json failed:\n${resNext.stderr || resNext.stdout}`);
    const { localId, question, options } = normalizeNextPayload(resNext.stdout);
    if (!localId) {
        // Fallback: try deriving from plan.next.path if present
        const fallbackLocal = toLocalFieldName(plan.next?.path);
        if (!fallbackLocal) {
            return { plan, next: null, question: null, options: null };
        }
        return { plan, next: fallbackLocal, question: question ?? fallbackLocal, options: options ?? [] };
    }
    return {
        plan,
        next: localId,
        question,
        options,
    };
}
function makeAskNode(rl) {
    return async (state) => {
        const qText = state.question ?? state.next ?? "(no label)";
        console.log("\n=== Next ===");
        console.log(qText);
        const opts = state.options ?? [];
        if (opts.length) {
            console.log("Options:");
            for (const o of opts)
                console.log(`  [${o.value}] ${o.label}`);
        }
        const ans = await rl.question("> ");
        return { lastAnswer: ans };
    };
}
async function nodeUpdateAnswers(state) {
    if (!state.next) {
        console.log("No 'next' field returned; halting.");
        return {};
    }
    const text = await promises_1.default.readFile(state.paths.answersJson, "utf8");
    const obj = safeParseJson(text);
    const field = state.next;
    let value = state.lastAnswer ?? "";
    // Coerce integer fields
    if (state.integerFields.has(field)) {
        if (/^-?\d+$/.test(String(value).trim()))
            value = Number(value);
    }
    obj.values[field] = value;
    await promises_1.default.writeFile(state.paths.answersJson, JSON.stringify(obj, null, 2), "utf8");
    return {};
}
async function nodeDone(state) {
    const p = state.plan;
    console.log(`\n✅ All required fields set for ${state.formId} (missing ${p.missingCount ?? 0}/${p.requiredTotal ?? 0})`);
    return {};
}
async function nodeHalt(state) {
    const stat = state.plan?.status ?? "unknown";
    const miss = state.plan?.missingCount ?? "?";
    console.log(`No next field available (status: ${stat}, missing: ${miss}). Halting.`);
    return {};
}
// ---------- main ----------
async function main() {
    console.log(`[FormAgent] starting… ${new Date().toLocaleTimeString()}`);
    await ensureFile(paths.instances);
    await ensureFile(paths.shapes);
    await ensureFile(paths.answersJson, JSON.stringify({ form: "form1", values: {} }, null, 2) + "\n");
    const instancesStore = await readTTLAsStore(paths.instances);
    const shapesStore = await readTTLAsStore(paths.shapes);
    if (VERBOSE) {
        console.log(`[preflight] quads: instances=${countQuads(instancesStore)}, shapes=${countQuads(shapesStore)}`);
    }
    const integerFields = detectIntegerFields(shapesStore);
    const baseState = {
        formId: "form1",
        prefix: PREFIX,
        paths,
        instancesStore,
        shapesStore,
        integerFields,
    };
    const rl = promises_2.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
    const graph = new langgraph_1.StateGraph({
        channels: {
            formId: null,
            prefix: null,
            paths: null,
            instancesStore: null,
            shapesStore: null,
            integerFields: null,
            plan: null,
            next: null,
            question: null,
            options: null,
            lastAnswer: null,
        },
    })
        .addEdge(langgraph_1.START, "answersToRdf")
        .addNode("answersToRdf", nodeAnswersToRdf)
        .addNode("rdfToPlan", nodeRdfToPlan)
        .addNode("ask", makeAskNode(rl))
        .addNode("updateAnswers", nodeUpdateAnswers)
        .addNode("done", nodeDone)
        .addNode("halt", nodeHalt)
        .addEdge("answersToRdf", "rdfToPlan")
        .addConditionalEdges("rdfToPlan", (s) => {
        if (s.plan?.status === "complete" || (s.plan && (s.plan.missingCount ?? 0) === 0))
            return "done";
        if (!s.next)
            return "halt";
        return "ask";
    }, { ask: "ask", halt: "halt", done: "done" })
        .addEdge("ask", "updateAnswers")
        .addEdge("updateAnswers", "answersToRdf")
        .addEdge("done", langgraph_1.END)
        .addEdge("halt", langgraph_1.END);
    const app = graph.compile({ checkpointer: new langgraph_checkpoint_1.MemorySaver() });
    const result = await app.invoke(baseState, {
        recursionLimit: 200,
        configurable: { thread_id: `form1-${Date.now()}` },
    });
    if (result.plan?.status === "complete") {
        console.log(`\n✅ All required fields set for ${result.formId} (missing ${result.plan.missingCount}/${result.plan.requiredTotal})`);
    }
    rl.close();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
