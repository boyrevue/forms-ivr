"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/voice/twilio.ts
const express_1 = require("express");
const utils_1 = require("./utils");
const router = (0, express_1.Router)();
function twiml(res, inner) {
    res
        .type("application/xml")
        .send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
}
function validateTwilio(_req) {
    // Hook up X-Twilio-Signature if/when you want. For now, allow.
    return true;
}
router.post("/call", async (req, res) => {
    if (!validateTwilio(req))
        return res.status(403).end();
    const state = await (0, utils_1.fetchLocal)("/dialog/state");
    const next = state?.next;
    if (!next) {
        return twiml(res, `<Say>Thanks, your form is complete.</Say><Hangup/>`);
    }
    const text = (0, utils_1.escapeXml)(next.question || "Please answer the next question.");
    // Ask and gather speech/dtmf; Twilio will POST to /voice/twilio/collect
    return twiml(res, `<Gather input="speech dtmf" action="/voice/twilio/collect" method="POST">
       <Say>${text}</Say>
     </Gather>
     <Say>Sorry, I didn't catch that.</Say>
     <Redirect method="POST">/voice/twilio/call</Redirect>`);
});
router.post("/collect", async (req, res) => {
    if (!validateTwilio(req))
        return res.status(403).end();
    const transcript = (req.body?.SpeechResult ?? req.body?.Digits ?? "").toString().trim();
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
        return twiml(res, `<Say>Thanks, your form is complete.</Say><Hangup/>`);
    }
    return twiml(res, `<Redirect method="POST">/voice/twilio/call</Redirect>`);
});
exports.default = router;
