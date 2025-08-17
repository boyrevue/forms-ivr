"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeXml = escapeXml;
exports.fetchLocal = fetchLocal;
exports.postLocal = postLocal;
// src/voice/utils.ts
function baseUrl() {
    return process.env.PUBLIC_BASE_URL || "http://localhost:3000";
}
function escapeXml(s) {
    return s.replace(/[<>&'"]/g, (c) => {
        return ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            "'": "&apos;",
            '"': "&quot;",
        }[c] || c);
    });
}
async function fetchWithTimeout(resource, options = {}, ms = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        return response;
    }
    finally {
        clearTimeout(id);
    }
}
async function fetchLocal(path) {
    const r = await fetchWithTimeout(baseUrl() + path);
    if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`fetch ${path} failed: ${r.status} ${text}`);
    }
    return r.json();
}
async function postLocal(path, body) {
    const r = await fetchWithTimeout(baseUrl() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`post ${path} failed: ${r.status} ${text}`);
    }
    return r.json();
}
