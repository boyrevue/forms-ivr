"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/voice/zadarma.ts
const express_1 = require("express");
const utils_1 = require("./utils");
const router = (0, express_1.Router)();
function xml(res, inner) {
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
}
router.post("/call", async (_req, res) => {
    const state = await (0, utils_1.fetchLocal)("/dialog/state");
    const next = state?.next;
    if (!next) {
        return xml(res, `<Play>https://example.com/bye.mp3</Play>`);
    }
    const text = (0, utils_1.escapeXml)(next.question ?? "Please answer the next question.");
    return xml(res, `<Play>https://example.com/prompt-tone.mp3</Play>
     <Say>${text}</Say>`);
});
router.post("/collect", async (req, res) => {
    const transcript = (req.body?.SpeechResult ?? req.body?.Digits ?? "")
        .toString()
        .trim();
    const { next } = await (0, utils_1.fetchLocal)("/dialog/state");
    let valueToPost = transcript;
    if (next?.options?.length) {
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const ntr = norm(transcript);
        const found = next.options.find((o) => norm(String(o.label)) === ntr) ||
            next.options.find((o) => norm(String(o.value)) === ntr) ||
            next.options.find((o) => norm(String(o.label)).startsWith(ntr));
        if (found)
            valueToPost = String(found.value);
    }
    else if (/^\d{1,9}$/.test(transcript)) {
        valueToPost = Number(transcript);
    }
    await (0, utils_1.postLocal)("/dialog/step", { value: valueToPost });
    const state = await (0, utils_1.fetchLocal)("/dialog/state");
    if (!state?.next) {
        return xml(res, `<Play>https://example.com/bye.mp3</Play>`);
    }
    return xml(res, `<Redirect method="POST">/voice/zadarma/call</Redirect>`);
});
exports.default = router;
