import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { listCoachNotes } from "./coach-notes.service.js";

export const coachNotesRouter = Router();

coachNotesRouter.get("/", requireAuth, async (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  const notes = await listCoachNotes(limit);
  res.json(notes);
});
