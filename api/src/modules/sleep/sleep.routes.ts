import { Router } from "express";
import { SleepSessionInputSchema } from "@health-tracker/shared";
import { requireAuth } from "../../lib/session.js";
import { logSleepSession, listSleepSessions } from "./sleep.service.js";

export const sleepRouter = Router();

sleepRouter.post("/", requireAuth, async (req, res) => {
  const parsed = SleepSessionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const session = await logSleepSession(parsed.data);
  res.status(201).json({ session });
});

sleepRouter.get("/", requireAuth, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const sessions = await listSleepSessions(from, to);
  res.json(sessions);
});
