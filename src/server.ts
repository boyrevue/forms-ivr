// src/server.ts
import express from "express";
import { dialogStepHandler, dialogStateHandler, dialogResetHandler } from "./routes";

const app = express();
app.use(express.json());

app.post("/dialog/step", dialogStepHandler);
app.get("/dialog/state", dialogStateHandler);
app.post("/dialog/reset", dialogResetHandler);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => console.log(`[agent] listening on http://localhost:${PORT}`));

