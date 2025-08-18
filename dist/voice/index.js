"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGoogle = exports.registerAlexa = void 0;
exports.registerVoiceRoutes = registerVoiceRoutes;
const twilio_1 = __importDefault(require("./twilio"));
const zadarma_1 = __importDefault(require("./zadarma"));
const alexa_1 = require("./alexa");
Object.defineProperty(exports, "registerAlexa", { enumerable: true, get: function () { return alexa_1.registerAlexa; } });
const google_1 = require("./google");
Object.defineProperty(exports, "registerGoogle", { enumerable: true, get: function () { return google_1.registerGoogle; } });
function registerVoiceRoutes(app) {
    if (!process.env.DISABLE_TWILIO)
        app.use("/voice/twilio", twilio_1.default);
    if (!process.env.DISABLE_ZADARMA)
        app.use("/voice/zadarma", zadarma_1.default);
    if (!process.env.DISABLE_ALEXA)
        (0, alexa_1.registerAlexa)(app);
    if (!process.env.DISABLE_GOOGLE)
        (0, google_1.registerGoogle)(app);
}
