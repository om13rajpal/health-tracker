import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { ProgressionState } from "../../models/ProgressionState.js";

export const progressionRouter = Router();

progressionRouter.get("/", requireAuth, async (_req, res) => {
  const states = await ProgressionState.find({}).lean();
  res.json(states);
});
