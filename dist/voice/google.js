"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGoogle = registerGoogle;
const BASE = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
async function getState() {
    const r = await fetch(`${BASE}/dialog/state`);
    if (!r.ok)
        throw new Error(`/dialog/state ${r.status}`);
    return r.json();
}
async function postStep(value) {
    const r = await fetch(`${BASE}/dialog/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
    });
    if (!r.ok)
        throw new Error(`/dialog/step ${r.status}`);
    return r.json();
}
function registerGoogle(app) {
    app.post("/google", async (req, res) => {
        try {
            const body = req.body || {};
            const utterance = body?.queryResult?.queryText ??
                body?.text ??
                body?.fulfillmentInfo?.tag ??
                "";
            if (!utterance) {
                const s = await getState();
                const q = s?.next?.question || "Please say your answer.";
                return res.json({ fulfillmentText: q });
            }
            await postStep(utterance);
            const s2 = await getState();
            const next = s2?.next;
            const reply = next ? (next.question || "Please answer the next question.") : "Thanks, your form is complete.";
            return res.json({ fulfillmentText: reply });
        }
        catch (e) {
            return res.json({ fulfillmentText: "Sorry, something went wrong." });
        }
    });
}
