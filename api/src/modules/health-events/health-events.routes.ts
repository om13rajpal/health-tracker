import { Router } from "express";
import { z } from "zod";
import { HealthEventPayloadSchema, WorkoutPayloadSchema, CategorySamplePayloadSchema, MoodPayloadSchema } from "@health-tracker/shared";
import { normalizeHealthEvent } from "./ingestion-adapter.js";
import { HealthSample } from "../../models/HealthSample.js";
import { HealthWorkout } from "../../models/HealthWorkout.js";
import { HealthCategorySample } from "../../models/HealthCategorySample.js";
import { Mood } from "../../models/Mood.js";
import { PendingWrite } from "../../models/PendingWrite.js";
import { requireBearerToken } from "../../lib/bearerAuth.js";

export const healthEventsRouter = Router();

healthEventsRouter.post(
  "/",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (req, res) => {
    const parsed = HealthEventPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const normalized = normalizeHealthEvent(parsed.data);
    await HealthSample.create(normalized);
    res.status(201).json({ stored: true });
  }
);

// Literal path — must stay declared before the /pending-writes/:id/ack
// param route below, or Express would let a parameterized route shadow it.
healthEventsRouter.post(
  "/workouts",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (req, res) => {
    const parsed = WorkoutPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await HealthWorkout.create({
      source: parsed.data.source,
      activityType: parsed.data.activityType,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      durationSeconds: parsed.data.durationSeconds,
      totalEnergyBurnedKcal: parsed.data.totalEnergyBurnedKcal,
      totalDistanceMeters: parsed.data.totalDistanceMeters,
    });
    res.status(201).json({ stored: true });
  }
);

// Literal path — see the /workouts comment above for why this ordering matters.
healthEventsRouter.post(
  "/category-samples",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (req, res) => {
    const parsed = CategorySamplePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await HealthCategorySample.create({
      source: parsed.data.source,
      category: parsed.data.category,
      value: parsed.data.value,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
    });
    res.status(201).json({ stored: true });
  }
);

// Literal path — see the /workouts comment above for why this ordering matters.
healthEventsRouter.post(
  "/mood",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (req, res) => {
    const parsed = MoodPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await Mood.create({
      source: parsed.data.source,
      kind: parsed.data.kind,
      valence: parsed.data.valence,
      valenceClassification: parsed.data.valenceClassification,
      labels: parsed.data.labels,
      associations: parsed.data.associations,
      date: new Date(parsed.data.date),
    });
    res.status(201).json({ stored: true });
  }
);

healthEventsRouter.get(
  "/pending-writes",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (_req, res) => {
    const pending = await PendingWrite.find({ delivered: false }).sort({ timestamp: 1 });
    res.json(
      pending.map((doc) => ({
        id: doc._id.toString(),
        metric: doc.metric,
        value: doc.value,
        unit: doc.unit,
        timestamp: doc.timestamp.toISOString(),
      }))
    );
  }
);

const AckParamsSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i, "id must be a valid Mongo ObjectId"),
});

healthEventsRouter.post(
  "/pending-writes/:id/ack",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (req, res) => {
    const parsedParams = AckParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ error: parsedParams.error.flatten() });
      return;
    }

    const updated = await PendingWrite.findOneAndUpdate(
      { _id: parsedParams.data.id, delivered: false },
      { delivered: true, deliveredAt: new Date() },
      { returnDocument: "after" }
    );

    if (!updated) {
      res.status(404).json({ error: "Pending write not found" });
      return;
    }

    res.json({ acked: true });
  }
);
