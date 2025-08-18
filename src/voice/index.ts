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
