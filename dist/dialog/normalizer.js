"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeValue = normalizeValue;
function normalizeValue(raw, slot) {
    if (raw == null)
        return null;
    let v = raw;
    // Option mapping (enums)
    if (slot.options?.length) {
        const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const nRaw = norm(String(raw));
        const found = slot.options.find((o) => norm(String(o.value)) === nRaw) ||
            slot.options.find((o) => norm(o.label) === nRaw) ||
            slot.options.find((o) => norm(o.label).startsWith(nRaw));
        if (found) {
            v = found.value;
        }
    }
    // Type coercion
    switch (slot.datatype) {
        case "integer":
            v = parseInt(v, 10);
            if (isNaN(v))
                throw new Error(`Expected integer for ${slot.id}`);
            break;
        case "decimal":
            v = parseFloat(v);
            if (isNaN(v))
                throw new Error(`Expected decimal for ${slot.id}`);
            break;
        case "boolean":
            if (typeof v === "string") {
                const low = v.toLowerCase();
                if (["true", "yes", "1"].includes(low))
                    v = true;
                else if (["false", "no", "0"].includes(low))
                    v = false;
            }
            v = Boolean(v);
            break;
        case "string":
        default:
            v = String(v);
    }
    // Range enforcement (min/max)
    if (typeof v === "number") {
        if (slot.min != null && v < slot.min) {
            throw new Error(`${slot.id} must be >= ${slot.min}`);
        }
        if (slot.max != null && v > slot.max) {
            throw new Error(`${slot.id} must be <= ${slot.max}`);
        }
    }
    return v;
}
