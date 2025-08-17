// src/voice/zadarma.ts
import { Router, type Request, type Response } from "express";
import { escapeXml, fetchLocal, postLocal } from "./utils";

const router = Router();

function xml(res: Response, inner: string) {
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`
  );
}

router.post("/call", async (_req: Request, res: Response) => {
  const state = await fetchLocal("/dialog/state");
  const next = state?.next;

  if (!next) {
    return xml(res, `<Play>https://example.com/bye.mp3</Play>`);
  }

  const text = escapeXml(next.question ?? "Please answer the next question.");
  return xml(
    res,
    `<Play>https://example.com/prompt-tone.mp3</Play>
     <Say>${text}</Say>`
  );
});

router.post("/collect", async (req: Request, res: Response) => {
  const transcript = (req.body?.SpeechResult ?? req.body?.Digits ?? "")
    .toString()
    .trim();

  const { next } = await fetchLocal("/dialog/state");
  let valueToPost: string | number = transcript;

  if (next?.options?.length) {
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const ntr = norm(transcript);
    const found =
      next.options.find((o: any) => norm(String(o.label)) === ntr) ||
      next.options.find((o: any) => norm(String(o.value)) === ntr) ||
      next.options.find((o: any) => norm(String(o.label)).startsWith(ntr));
    if (found) valueToPost = String(found.value);
  } else if (/^\d{1,9}$/.test(transcript)) {
    valueToPost = Number(transcript);
  }

  await postLocal("/dialog/step", { value: valueToPost });
  const state = await fetchLocal("/dialog/state");

  if (!state?.next) {
    return xml(res, `<Play>https://example.com/bye.mp3</Play>`);
  }

  return xml(res, `<Redirect method="POST">/voice/zadarma/call</Redirect>`);
});

export default router;

