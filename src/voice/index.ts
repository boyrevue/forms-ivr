// src/voice/index.ts
import { Express } from "express";
import type { Request, Response } from "express";
import twilioRouter from "./twilio";
import zadarmaRouter from "./zadarma";

/**
 * Mount enabled voice provider routes under /voice/*
 */
export function registerVoiceRoutes(app: Express) {
  if (process.env.ENABLE_TWILIO) {
    app.use("/voice/twilio", twilioRouter);
  }
  if (process.env.ENABLE_ZADARMA) {
    app.use("/voice/zadarma", zadarmaRouter);
  }
}

// Barrel exports so you can import directly if needed
export { twilioRouter, zadarmaRouter };

