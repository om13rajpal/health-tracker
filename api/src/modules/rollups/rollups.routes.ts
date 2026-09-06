import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { listRollups } from "./rollups.service.js";

export const rollupsRouter = Router();

rollupsRouter.get("/", requireAuth, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const rollups = await listRollups(from, to);
  res.json(rollups);
});
