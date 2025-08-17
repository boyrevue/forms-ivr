"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shaclDryRunPut = shaclDryRunPut;
// src/shaclDryRun.ts
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const answersToRdf = "scripts/answers-to-rdf.mjs";
const rdfValidate = "scripts/validate.mjs";
function runNode(argv) {
    return new Promise((resolve) => {
        const p = (0, node_child_process_1.spawn)(process.execPath, argv, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        p.stdout.on("data", d => (stdout += d));
        p.stderr.on("data", d => (stderr += d));
        p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });
}
async function shaclDryRunPut(formId, fieldId, value) {
    const raw = await (0, promises_1.readFile)("answers.json", "utf8").catch(() => JSON.stringify({ form: formId, values: {} }));
    const json = JSON.parse(raw);
    json.values = json.values || {};
    json.values[fieldId] = value;
    const tmp = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "shacl-"));
    const tmpJson = (0, node_path_1.join)(tmp, "answers.json");
    const tmpTtl = (0, node_path_1.join)(tmp, "answers.ttl");
    const tmpInst = (0, node_path_1.join)(tmp, "instances.ttl");
    try {
        await (0, promises_1.writeFile)(tmpJson, JSON.stringify(json, null, 2), "utf8");
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
    }
    finally {
        await (0, promises_1.rm)(tmp, { recursive: true, force: true }).catch(() => { });
    }
}
