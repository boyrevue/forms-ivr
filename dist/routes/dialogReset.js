"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dialogResetHandler = dialogResetHandler;
// src/routes/dialogReset.ts
const promises_1 = __importDefault(require("node:fs/promises"));
const paths = {
    answersJson: "answers.json",
    answersTtl: "out/answers.ttl",
    plan: "out/slot-plan.json",
};
async function dialogResetHandler(req, res) {
    try {
        const { all = true, clear = [] } = req.body || {};
        if (all) {
            await promises_1.default.writeFile(paths.answersJson, JSON.stringify({ values: {} }, null, 2), "utf8");
            await promises_1.default.writeFile(paths.answersTtl, "", "utf8").catch(() => { });
            await promises_1.default.writeFile(paths.plan, JSON.stringify({}), "utf8").catch(() => { });
            return res.json({ status: "reset", all: true });
        }
        // selective clear
        let ctx = { values: {} };
        try {
            ctx = JSON.parse(await promises_1.default.readFile(paths.answersJson, "utf8"));
        }
        catch { }
        for (const f of clear)
            delete ctx.values[f];
        await promises_1.default.writeFile(paths.answersJson, JSON.stringify(ctx, null, 2), "utf8");
        res.json({ status: "reset", cleared: clear });
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message || e) });
    }
}
