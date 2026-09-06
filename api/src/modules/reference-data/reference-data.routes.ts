import { Router } from "express";
import { listExercises, listPrograms } from "./reference-data.service.js";

export const referenceDataRouter = Router();

referenceDataRouter.get("/exercises", async (req, res) => {
  const equipment = typeof req.query.equipment === "string" ? req.query.equipment : undefined;
  const exercises = await listExercises(equipment);
  res.json(exercises);
});

referenceDataRouter.get("/programs", async (_req, res) => {
  const programs = await listPrograms();
  res.json(programs);
});
