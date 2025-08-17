"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadValidators = loadValidators;
exports.getValidator = getValidator;
exports.validateWithJs = validateWithJs;
// src/jsSandbox.ts
const promises_1 = require("node:fs/promises");
const node_vm_1 = require("node:vm");
let cache = null;
async function loadValidators(file = "data/validators.json") {
    let spec = {};
    try {
        const raw = await (0, promises_1.readFile)(file, "utf8");
        spec = JSON.parse(raw);
    }
    catch {
        cache = {}; // fail-open if validators file is missing
        return cache;
    }
    const compiled = {};
    for (const [field, src] of Object.entries(spec)) {
        // NOTE: don't freeze; the validator code needs to assign module.exports
        const sandbox = {
            module: { exports: undefined },
            exports: undefined,
        };
        const context = (0, node_vm_1.createContext)(sandbox, {
            name: `validator:${field}`,
            codeGeneration: { strings: false, wasm: false },
        });
        const wrapped = `
      (function () {
        const require = undefined;
        const process = undefined;
        const globalThis = undefined;
        const window = undefined;
        const document = undefined;
        ${src}
        return module.exports;
      })()
    `;
        const maybeFn = (0, node_vm_1.runInNewContext)(wrapped, context, { timeout: 100 });
        if (typeof maybeFn !== "function") {
            throw new Error(`Validator for "${field}" did not export a function`);
        }
        compiled[field] = maybeFn;
    }
    cache = compiled;
    return cache;
}
function getValidator(field) {
    if (!cache)
        throw new Error("Validators not loaded. Call loadValidators() first.");
    return cache[field];
}
async function validateWithJs(field, value, ctx) {
    if (!cache)
        await loadValidators().catch(() => (cache = {}));
    const fn = getValidator(field);
    if (!fn)
        return { ok: true, value };
    let res;
    try {
        const out = fn(value, ctx);
        res = out && typeof out.then === "function" ? await out : out;
    }
    catch (e) {
        return { ok: false, message: `Validation error: ${e?.message || e}` };
    }
    if (res === true)
        return { ok: true, value };
    if (res && typeof res === "object") {
        if (res.ok === false) {
            return { ok: false, message: res.message || "Invalid value" };
        }
        if (res.ok === true) {
            return { ok: true, value: res.value ?? value };
        }
    }
    return { ok: true, value };
}
