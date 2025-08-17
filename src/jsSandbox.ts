// src/jsSandbox.ts
import { readFile } from "node:fs/promises";
import { createContext, runInNewContext } from "node:vm";

type Result =
  | true
  | { ok: true; value?: any }
  | { ok: false; message?: string };

export type JsValidateOutcome =
  | { ok: true; value: any }
  | { ok: false; message: string };

let cache: Record<string, (value: any, ctx: any) => Result | Promise<Result>> | null = null;

export async function loadValidators(file = "data/validators.json") {
  let spec: Record<string, string> = {};
  try {
    const raw = await readFile(file, "utf8");
    spec = JSON.parse(raw);
  } catch {
    cache = {}; // fail-open if validators file is missing
    return cache;
  }

  const compiled: typeof cache = {};
  for (const [field, src] of Object.entries(spec)) {
    // NOTE: don't freeze; the validator code needs to assign module.exports
    const sandbox = {
      module: { exports: undefined as any },
      exports: undefined as any,
    };
    const context = createContext(sandbox, {
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

    const maybeFn = runInNewContext(wrapped, context, { timeout: 100 });
    if (typeof maybeFn !== "function") {
      throw new Error(`Validator for "${field}" did not export a function`);
    }
    compiled[field] = maybeFn as any;
  }

  cache = compiled;
  return cache!;
}

export function getValidator(field: string) {
  if (!cache) throw new Error("Validators not loaded. Call loadValidators() first.");
  return cache[field];
}

export async function validateWithJs(
  field: string,
  value: any,
  ctx: any
): Promise<JsValidateOutcome> {
  if (!cache) await loadValidators().catch(() => (cache = {}));
  const fn = getValidator(field);
  if (!fn) return { ok: true, value };

  let res: Result;
  try {
    const out = fn(value, ctx);
    res = out && typeof (out as any).then === "function" ? await (out as any) : out;
  } catch (e: any) {
    return { ok: false, message: `Validation error: ${e?.message || e}` };
  }

  if (res === true) return { ok: true, value };
  if (res && typeof res === "object") {
    if ((res as any).ok === false) {
      return { ok: false, message: (res as any).message || "Invalid value" };
    }
    if ((res as any).ok === true) {
      return { ok: true, value: (res as any).value ?? value };
    }
  }
  return { ok: true, value };
}

