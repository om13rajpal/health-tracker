import { Router } from "express";
import { WorkoutSessionInputSchema } from "@health-tracker/shared";
import { requireAuth } from "../../lib/session.js";
import { logWorkoutSession, listWorkoutSessions } from "./workouts.service.js";

export const workoutsRouter = Router();

workoutsRouter.get("/", requireAuth, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const sessions = await listWorkoutSessions(from, to);
  res.json(sessions);
});

workoutsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = WorkoutSessionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { session, progressionResults } = await logWorkoutSession(parsed.data);
  res.status(201).json({ session, progressionResults });
});
