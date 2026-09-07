import { Router } from "express";
import { HealthEventPayloadSchema, WorkoutPayloadSchema, CategorySamplePayloadSchema, MoodPayloadSchema } from "@health-tracker/shared";
import { normalizeHealthEvent } from "./ingestion-adapter.js";
import { HealthSample } from "../../models/HealthSample.js";
import { HealthWorkout } from "../../models/HealthWorkout.js";
import { HealthCategorySample } from "../../models/HealthCategorySample.js";
import { Mood } from "../../models/Mood.js";
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
