"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAlexa = registerAlexa;
const ask_sdk_core_1 = require("ask-sdk-core");
const ask_sdk_express_adapter_1 = require("ask-sdk-express-adapter");
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
function extractUtterance(handlerInput) {
    const req = handlerInput.requestEnvelope.request;
    if (req.type !== "IntentRequest")
        return null;
    const slots = req.intent?.slots || {};
    for (const k of Object.keys(slots)) {
        const v = slots[k]?.value;
        if (v)
            return String(v);
    }
    return req.intent?.name || null;
}
function registerAlexa(app) {
    const handlers = {
        LaunchRequestHandler: {
            canHandle(input) {
                return input.requestEnvelope.request.type === "LaunchRequest";
            },
            async handle(input) {
                const state = await getState();
                const next = state?.next;
                const msg = next
                    ? next.question || "Please answer the next question."
                    : "All done. Thanks!";
                return input.responseBuilder.speak(msg).reprompt(msg).getResponse();
            },
        },
        GenericIntentHandler: {
            canHandle(input) {
                return input.requestEnvelope.request.type === "IntentRequest";
            },
            async handle(input) {
                const utterance = extractUtterance(input);
                if (!utterance) {
                    return input.responseBuilder
                        .speak("Sorry, I didn't get that. Please repeat.")
                        .reprompt("Please repeat.")
                        .getResponse();
                }
                await postStep(utterance);
                const state = await getState();
                const next = state?.next;
                if (!next) {
                    return input.responseBuilder
                        .speak("Thanks, your form is complete. Goodbye.")
                        .withShouldEndSession(true)
                        .getResponse();
                }
                const q = next.question || "Please answer the next question.";
                return input.responseBuilder.speak(q).reprompt(q).getResponse();
            },
        },
        SessionEndedRequestHandler: {
            canHandle(input) {
                return input.requestEnvelope.request.type === "SessionEndedRequest";
            },
            handle(input) {
                return input.responseBuilder.getResponse();
            },
        },
    };
    const skill = ask_sdk_core_1.SkillBuilders.custom()
        .addRequestHandlers(handlers.LaunchRequestHandler, handlers.GenericIntentHandler, handlers.SessionEndedRequestHandler)
        .create();
    const adapter = new ask_sdk_express_adapter_1.ExpressAdapter(skill, false, false);
    app.post("/alexa", adapter.getRequestHandlers());
}
