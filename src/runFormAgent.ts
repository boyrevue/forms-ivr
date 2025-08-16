// src/runFormAgent.ts
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Parser, Store, DataFactory, Quad } from "n3";
import { StateGraph, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";

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

type PlanStatus = "complete" | "incomplete" | string;

type Plan = {
  form: string;
  status: PlanStatus;
  next?: { path?: string; label?: string } | null;
  requiredTotal?: number;
  missingCount?: number;
  missing?: Array<{ path: string; label: string }>;
};

type NextInfo = {
  id?: string;
  path?: string;
  label?: string;
  question?: string;
  options?: { value?: string | number; label?: string }[];
};

type AgentState = {
  formId: string;
  prefix: typeof PREFIX;
  paths: typeof paths;

  instancesStore: Store;
  shapesStore: Store;
  integerFields: Set<string>;

  plan?: Plan;
  next?: string | null; // local field name
  question?: string | null;
  options?: { value: string; label: string }[] | null;
  lastAnswer?: string | null;
};

// ---------- utilities ----------
async function ensureFile(p: string, contents = "") {
  try {
    await fs.access(p);
  } catch {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, contents, "utf8");
  }
}

async function readTTLAsStore(file: string): Promise<Store> {
  const text = await fs.readFile(file, "utf8");
  const store = new Store();
  const parser = new Parser();
  store.addQuads(parser.parse(text));
  return store;
}

function countQuads(store: Store): number {
  // @ts-ignore N3.Store quads
  const q: Quad[] = store.getQuads(null, null, null, null);
  return q.length;
}

function detectIntegerFields(shapes: Store): Set<string> {
  const set = new Set<string>();
  const quads = shapes.getQuads(null, DataFactory.namedNode(`${SH}property`), null, null);
  for (const q of quads) {
    const shapeNode = q.object;
    const pathQ = shapes.getQuads(shapeNode, DataFactory.namedNode(`${SH}path`), null, null)[0];
    const dtypeQ = shapes.getQuads(shapeNode, DataFactory.namedNode(`${SH}datatype`), null, null)[0];
    if (!pathQ || !dtypeQ) continue;
    const pathNode = pathQ.object;
    const dt = dtypeQ.object.value;
    if (!pathNode.value.startsWith(PREFIX)) continue;
    const local = pathNode.value.slice(PREFIX.length);
    if (dt === `${XSD}integer`) set.add(local);
  }
  return set;
}

async function runNode(
  cmdArgs: string[],
  { captureStdout = true } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, cmdArgs, {
      stdio: captureStdout ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (captureStdout && p.stdout) p.stdout.on("data", (d) => (stdout += d.toString()));
    if (captureStdout && p.stderr) p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function safeParseJson<T = any>(s: string): T {
  try {
    return JSON.parse(s);
  } catch {}
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const snippet = s.slice(start, end + 1);
    return JSON.parse(snippet);
  }
  throw new Error(`Could not parse JSON from:\n${s}`);
}

function toLocalFieldName(maybeIri?: string): string | undefined {
  if (!maybeIri) return undefined;
  return maybeIri.startsWith(PREFIX) ? maybeIri.slice(PREFIX.length) : maybeIri;
}

function normalizeNextPayload(stdout: string): {
  localId?: string;
  question: string;
  options: { value: string; label: string }[];
} {
  const parsed = safeParseJson<any>(stdout);
  const payload: NextInfo = parsed?.next ?? parsed ?? {};
  const localId =
    payload.id ??
    toLocalFieldName(payload.path);

  const question =
    payload.label ??
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
async function nodeAnswersToRdf(state: AgentState): Promise<Partial<AgentState>> {
  if (VERBOSE) console.log("[answersToRdf] building TTL from answers.json");
  try {
    await fs.access(state.paths.answersJson);
  } catch {
    await fs.writeFile(
      state.paths.answersJson,
      JSON.stringify({ form: state.formId, values: {} }, null, 2),
      "utf8"
    );
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
  if (res.code !== 0) throw new Error(`answers-to-rdf failed:\n${res.stderr || res.stdout}`);
  if (VERBOSE) process.stdout.write(res.stdout);
  return {};
}

async function nodeRdfToPlan(state: AgentState): Promise<Partial<AgentState>> {
  if (VERBOSE) console.log("[rdfToPlan] computing plan from instances/shapes/answers");
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
  if (res.code !== 0) throw new Error(`rdf-to-plan failed:\n${res.stderr || res.stdout}`);
  if (VERBOSE) process.stdout.write(res.stdout);

  const planText = await fs.readFile(state.paths.plan, "utf8");
  const plan = safeParseJson<Plan>(planText);
  if (VERBOSE) console.log("[rdfToPlan] plan:", JSON.stringify(plan, null, 2));

  if (plan.status === "complete" || (plan.missingCount ?? 0) === 0) {
    return { plan, next: null, question: null, options: null };
  }

  // Ask next-as-json for the rich "next" (with id + options)
  const resNext = await runNode(
    [
      state.paths.nextScript,
      "--instances",
      state.paths.instances,
      "--plan",
      state.paths.plan,
    ],
    { captureStdout: true }
  );
  if (resNext.code !== 0) throw new Error(`next-as-json failed:\n${resNext.stderr || resNext.stdout}`);

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

function makeAskNode(rl: readline.Interface) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const qText = state.question ?? state.next ?? "(no label)";
    console.log("\n=== Next ===");
    console.log(qText);

    const opts = state.options ?? [];
    if (opts.length) {
      console.log("Options:");
      for (const o of opts) console.log(`  [${o.value}] ${o.label}`);
    }

    const ans = await rl.question("> ");
    return { lastAnswer: ans };
  };
}

async function nodeUpdateAnswers(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.next) {
    console.log("No 'next' field returned; halting.");
    return {};
  }
  const text = await fs.readFile(state.paths.answersJson, "utf8");
  const obj = safeParseJson<{ form: string; values: Record<string, any> }>(text);

  const field = state.next;
  let value: any = state.lastAnswer ?? "";

  // Coerce integer fields
  if (state.integerFields.has(field)) {
    if (/^-?\d+$/.test(String(value).trim())) value = Number(value);
  }

  obj.values[field] = value;
  await fs.writeFile(state.paths.answersJson, JSON.stringify(obj, null, 2), "utf8");
  return {};
}

async function nodeDone(state: AgentState): Promise<Partial<AgentState>> {
  const p = state.plan!;
  console.log(
    `\n✅ All required fields set for ${state.formId} (missing ${p.missingCount ?? 0}/${p.requiredTotal ?? 0})`
  );
  return {};
}

async function nodeHalt(state: AgentState): Promise<Partial<AgentState>> {
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

  const baseState: AgentState = {
    formId: "form1",
    prefix: PREFIX,
    paths,
    instancesStore,
    shapesStore,
    integerFields,
  };

  const rl = readline.createInterface({ input, output });

  const graph = new StateGraph<AgentState>({
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
    .addEdge(START, "answersToRdf")
    .addNode("answersToRdf", nodeAnswersToRdf)
    .addNode("rdfToPlan", nodeRdfToPlan)
    .addNode("ask", makeAskNode(rl))
    .addNode("updateAnswers", nodeUpdateAnswers)
    .addNode("done", nodeDone)
    .addNode("halt", nodeHalt)
    .addEdge("answersToRdf", "rdfToPlan")
    .addConditionalEdges(
      "rdfToPlan",
      (s) => {
        if (s.plan?.status === "complete" || (s.plan && (s.plan.missingCount ?? 0) === 0)) return "done";
        if (!s.next) return "halt";
        return "ask";
      },
      { ask: "ask", halt: "halt", done: "done" }
    )
    .addEdge("ask", "updateAnswers")
    .addEdge("updateAnswers", "answersToRdf")
    .addEdge("done", END)
    .addEdge("halt", END);

  const app = graph.compile({ checkpointer: new MemorySaver() });

  const result = await app.invoke(baseState, {
    recursionLimit: 200,
    configurable: { thread_id: `form1-${Date.now()}` },
  });

  if (result.plan?.status === "complete") {
    console.log(
      `\n✅ All required fields set for ${result.formId} (missing ${result.plan.missingCount}/${result.plan.requiredTotal})`
    );
  }

  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

