#!/bin/bash
set -e

# 📍 Go to your project root
#cd "$(dirname "$0")/NLP"

echo "👉 Installing Alexa + Google adapter deps..."
pnpm add ask-sdk-core ask-sdk-express-adapter

echo "👉 Creating Alexa adapter..."
mkdir -p src/voice

cat > src/voice/alexa.ts <<'EOF'
// src/voice/alexa.ts
import type { Express } from "express";
import { SkillBuilders } from "ask-sdk-core";
import { ExpressAdapter } from "ask-sdk-express-adapter";

const BASE = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

async function getState() {
  const r = await fetch(`${BASE}/dialog/state`);
  if (!r.ok) throw new Error(`/dialog/state ${r.status}`);
  return r.json();
}
async function postStep(value: any) {
  const r = await fetch(`${BASE}/dialog/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error(`/dialog/step ${r.status}`);
  return r.json();
}

function extractUtterance(handlerInput: any): string | null {
  const req = handlerInput.requestEnvelope.request;
  if (req.type !== "IntentRequest") return null;
  const slots = req.intent?.slots || {};
  for (const k of Object.keys(slots)) {
    const v = slots[k]?.value;
    if (v) return String(v);
  }
  return req.intent?.name || null;
}

export function registerAlexa(app: Express) {
  const handlers = {
    LaunchRequestHandler: {
      canHandle(input: any) {
        return input.requestEnvelope.request.type === "LaunchRequest";
      },
      async handle(input: any) {
        const state = await getState();
        const next = state?.next;
        const msg = next
          ? next.question || "Please answer the next question."
          : "All done. Thanks!";
        return input.responseBuilder.speak(msg).reprompt(msg).getResponse();
      },
    },
    GenericIntentHandler: {
      canHandle(input: any) {
        return input.requestEnvelope.request.type === "IntentRequest";
      },
      async handle(input: any) {
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
      canHandle(input: any) {
        return input.requestEnvelope.request.type === "SessionEndedRequest";
      },
      handle(input: any) {
        return input.responseBuilder.getResponse();
      },
    },
  };

  const skill = SkillBuilders.custom()
    .addRequestHandlers(
      handlers.LaunchRequestHandler as any,
      handlers.GenericIntentHandler as any,
      handlers.SessionEndedRequestHandler as any,
    )
    .create();

  const adapter = new ExpressAdapter(skill, false, false);
  app.post("/alexa", adapter.getRequestHandlers());
}
EOF

echo "👉 Creating Google adapter..."
cat > src/voice/google.ts <<'EOF'
// src/voice/google.ts
import type { Express, Request, Response } from "express";

const BASE = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

async function getState() {
  const r = await fetch(`${BASE}/dialog/state`);
  if (!r.ok) throw new Error(`/dialog/state ${r.status}`);
  return r.json();
}
async function postStep(value: any) {
  const r = await fetch(`${BASE}/dialog/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error(`/dialog/step ${r.status}`);
  return r.json();
}

export function registerGoogle(app: Express) {
  app.post("/google", async (req: Request, res: Response) => {
    try {
      const body: any = req.body || {};
      const utterance =
        body?.queryResult?.queryText ??
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
    } catch (e: any) {
      return res.json({ fulfillmentText: "Sorry, something went wrong." });
    }
  });
}
EOF

echo "👉 Updating index barrel..."
cat > src/voice/index.ts <<'EOF'
import type { Express } from "express";
import twilio from "./twilio";
import zadarma from "./zadarma";
import { registerAlexa } from "./alexa";
import { registerGoogle } from "./google";

export function registerVoiceRoutes(app: Express) {
  if (!process.env.DISABLE_TWILIO) app.use("/voice/twilio", twilio);
  if (!process.env.DISABLE_ZADARMA) app.use("/voice/zadarma", zadarma);
  if (!process.env.DISABLE_ALEXA) registerAlexa(app);
  if (!process.env.DISABLE_GOOGLE) registerGoogle(app);
}

export { registerAlexa, registerGoogle };
EOF

echo "👉 Building..."
pnpm build

echo "👉 Reloading PM2..."
pm2 reload ecosystem.config.cjs --only forms-ivr --update-env || true
pm2 save

echo "✅ Alexa & Google voice adapters installed."

