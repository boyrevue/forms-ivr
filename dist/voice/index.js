"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.zadarmaRouter = exports.twilioRouter = void 0;
exports.registerVoiceRoutes = registerVoiceRoutes;
const twilio_1 = __importDefault(require("./twilio"));
exports.twilioRouter = twilio_1.default;
const zadarma_1 = __importDefault(require("./zadarma"));
exports.zadarmaRouter = zadarma_1.default;
/**
 * Mount enabled voice provider routes under /voice/*
 */
function registerVoiceRoutes(app) {
    if (process.env.ENABLE_TWILIO) {
        app.use("/voice/twilio", twilio_1.default);
    }
    if (process.env.ENABLE_ZADARMA) {
        app.use("/voice/zadarma", zadarma_1.default);
    }
}
