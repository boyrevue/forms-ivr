"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/server.ts
const express_1 = __importDefault(require("express"));
const routes_1 = require("./routes");
const voice_1 = require("./voice");
const app = (0, express_1.default)();
// JSON + form support (Twilio/Zadarma often use urlencoded POSTs)
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: false }));
// Dialog APIs
app.post("/dialog/step", routes_1.dialogStepHandler);
app.get("/dialog/state", routes_1.dialogStateHandler);
app.post("/dialog/reset", routes_1.dialogResetHandler);
// Voice provider webhooks
(0, voice_1.registerVoiceRoutes)(app);
const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`[agent] listening on http://localhost:${PORT}`));
