// src/server.ts
import express from "express";
import {
  dialogStepHandler,
  dialogStateHandler,
  dialogResetHandler,
} from "./routes";
import { registerVoiceRoutes } from "./voice";

const app = express();

// JSON + form support (Twilio/Zadarma often use urlencoded POSTs)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Dialog APIs
app.post("/dialog/step", dialogStepHandler);
app.get("/dialog/state", dialogStateHandler);
app.post("/dialog/reset", dialogResetHandler);

// Voice provider webhooks
registerVoiceRoutes(app);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () =>
  console.log(`[agent] listening on http://localhost:${PORT}`)
);

