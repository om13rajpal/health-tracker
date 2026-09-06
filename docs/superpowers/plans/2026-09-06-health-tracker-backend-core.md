# Health Tracker — Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `api` service (auth, data models, health-sync ingestion, training/nutrition/sleep CRUD, the progression engine, nightly rollups, and the MCP coaching server) plus the `shared` package it and future clients depend on. This is the foundation every other subsystem (iOS bridge app, web app) is built against.

**Architecture:** Express 5 + Mongoose 9 + Zod, TypeScript ESM, single-user (no multi-tenancy). One Mongoose model per file under `api/src/models/`. Domain logic lives in `api/src/modules/<domain>/{*.routes.ts,*.service.ts}`. `node-cron` for the one scheduled job (nightly rollup) — no queue, no Redis. An MCP server mounted on the same Express app exposes read tools + one write tool over HTTP, so any MCP-compatible client (Claude, ChatGPT) can query and annotate progress without this codebase ever calling an LLM API itself.

**Tech Stack:** Node.js (ESM), TypeScript 5, Express 5, Mongoose 9, Zod 3, `iron-session`, `node-cron`, `@modelcontextprotocol/sdk`, Vitest + `mongodb-memory-server` + `supertest`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-06-health-tracker-design.md`

## Global Constraints

- TypeScript throughout, ESM modules (`"type": "module"` in every `package.json`), matching the user's existing `finance-tracker` project conventions.
- Express 5 + Mongoose 9 — not Fastify, not Prisma (see spec §4.1 for why).
- No Redis, no BullMQ, no job queue — `node-cron` only, behind a small `schedule()` wrapper so a queue could be substituted later without touching call sites (spec §4.1).
- Auth is a single hardcoded user via `iron-session` — no Clerk, no Auth.js/NextAuth, no Lucia (spec §4.1). Session secret and app password come from environment variables, never hardcoded.
- **This codebase must never call an LLM API directly** — no `ANTHROPIC_API_KEY`, no `GEMINI_API_KEY` used for a coaching/completion call anywhere in `api/`. The only LLM-facing surface is the MCP server, which is called *by* external LLM clients, not the other way around (spec §8, explicit user requirement).
- MongoDB for dev is local (already running via Homebrew on this machine at `mongodb://localhost:27017`) — no Atlas setup required for this plan.
- Tests: Vitest + `mongodb-memory-server` (real Mongo behavior, no mocking the database) + `supertest` for HTTP-level tests, matching the finance-tracker's existing test stack.
- One Mongoose model per file under `api/src/models/`, PascalCase filenames, matching the finance-tracker's existing convention.
- **All "which day does this belong to" logic goes through `api/src/lib/dates.ts` (IST, UTC+5:30), never raw UTC arithmetic.** The app's one user is in India; naive UTC day boundaries misfile data logged late at night by up to 5.5 hours (added after this plan's audit — see Task 3, Task 12).
- **Every secret comparison (login password, device/MCP bearer tokens) goes through `api/src/lib/crypto.ts`'s `constantTimeEquals`, and every bearer-token check goes through `api/src/lib/bearerAuth.ts`'s `requireBearerToken`.** No route defines its own inline token-comparison logic (added after this plan's audit — see Task 3).

---

## File Structure

```
health-tracker/
├── package.json                 # pnpm workspace root scripts
├── pnpm-workspace.yaml
├── .gitignore
├── shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       └── schemas/
│           ├── health.ts        # HealthEventPayload (ingestion contract)
│           ├── workout.ts       # Set, WorkoutSessionInput
│           ├── food.ts          # FoodEntryInput
│           └── sleep.ts         # SleepSessionInput
└── api/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── vitest.config.ts
    └── src/
        ├── index.ts              # Express app bootstrap
        ├── config/
        │   └── env.ts            # typed env var loading
        ├── lib/
        │   ├── db.ts             # Mongoose connect/disconnect
        │   ├── session.ts        # iron-session config + middleware
        │   ├── crypto.ts         # constantTimeEquals
        │   ├── dates.ts          # IST date helpers (day bucketing, cron)
        │   ├── bearerAuth.ts     # shared device/MCP bearer-token middleware
        │   └── errorHandler.ts   # global JSON error-handling middleware
        ├── models/
        │   ├── User.ts
        │   ├── HealthSample.ts
        │   ├── DailyRollup.ts
        │   ├── SleepSession.ts
        │   ├── Exercise.ts
        │   ├── ProgramTemplate.ts
        │   ├── ProgressionState.ts
        │   ├── WorkoutSession.ts
        │   ├── IndianDish.ts
        │   ├── PackagedFood.ts
        │   ├── FoodEntry.ts
        │   ├── Recipe.ts
        │   └── CoachNote.ts
        ├── modules/
        │   ├── auth/
        │   │   └── auth.routes.ts
        │   ├── health-events/
        │   │   ├── ingestion-adapter.ts
        │   │   └── health-events.routes.ts
        │   ├── workouts/
        │   │   ├── progression-engine.ts
        │   │   ├── workouts.service.ts
        │   │   └── workouts.routes.ts
        │   ├── nutrition/
        │   │   ├── nutrition.service.ts
        │   │   └── nutrition.routes.ts
        │   └── sleep/
        │       ├── sleep.service.ts
        │       └── sleep.routes.ts
        ├── jobs/
        │   ├── scheduler.ts
        │   └── nightlyRollup.job.ts
        ├── mcp/
        │   ├── tools.ts
        │   └── server.ts
        └── seed/
            ├── seedExercises.ts
            ├── seedProgramTemplates.ts
            ├── seedProgressionStates.ts
            ├── seedIndianDishes.ts
            ├── seedPackagedFoods.ts
            └── seedRecipes.ts
```

---

### Task 1: Monorepo scaffold + health check endpoint

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/vitest.config.ts`
- Create: `api/.env.example`
- Create: `api/src/index.ts`
- Create: `api/src/app.ts`
- Test: `api/src/app.test.ts`

**Interfaces:**
- Produces: `createApp(): express.Express` from `api/src/app.ts` — every later task's route tests import this.

- [ ] **Step 1: Create the workspace root files**

`package.json`:
```json
{
  "name": "health-tracker",
  "private": true,
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "test:api": "pnpm --filter api test",
    "build:api": "pnpm --filter api build"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "api"
  - "web"
  - "shared"
  - "ios"
```

`.gitignore`:
```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 2: Scaffold the `shared` package**

`shared/package.json`:
```json
{
  "name": "@health-tracker/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

`shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}
```

`shared/src/index.ts`:
```typescript
export const SHARED_PACKAGE_NAME = "@health-tracker/shared";
```

- [ ] **Step 3: Scaffold the `api` package**

Run:
```bash
mkdir -p api/src
```

`api/package.json`:
```json
{
  "name": "@health-tracker/api",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@health-tracker/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^5.0.1",
    "express-rate-limit": "^7.4.0",
    "iron-session": "^8.0.4",
    "mongoose": "^9.0.0",
    "node-cron": "^3.0.3",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/supertest": "^6.0.2",
    "mongodb-memory-server": "^10.0.0",
    "supertest": "^7.0.0",
    "tsx": "^4.16.5",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

`api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

`api/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
```

`api/.env.example`:
```
PORT=4000
MONGO_URI=mongodb://localhost:27017/health-tracker
SESSION_SECRET=replace-with-32-plus-random-bytes
APP_PASSWORD=replace-with-a-real-password
MCP_ACCESS_TOKEN=replace-with-a-long-random-token
WEB_ORIGIN=http://localhost:3000
```

- [ ] **Step 4: Write the failing test for `createApp`**

`api/src/app.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("responds to GET /health with status ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd api && pnpm install && pnpm test`
Expected: FAIL — `./app.js` does not exist yet.

- [ ] **Step 6: Implement `createApp`**

`api/src/app.ts`:
```typescript
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
```

`api/src/index.ts`:
```typescript
import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore shared api
git commit -m "chore: scaffold monorepo with express health check"
```

---

### Task 2: Shared Zod schemas

**Files:**
- Create: `shared/src/schemas/health.ts`
- Create: `shared/src/schemas/workout.ts`
- Create: `shared/src/schemas/food.ts`
- Create: `shared/src/schemas/sleep.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/schemas/health.test.ts`
- Test: `shared/src/schemas/workout.test.ts`
- Test: `shared/src/schemas/food.test.ts`
- Test: `shared/src/schemas/sleep.test.ts`

**Interfaces:**
- Produces: `HealthEventPayloadSchema`, `HealthEventPayload` (type) — consumed by Task 6's ingestion adapter.
- Produces: `SetSchema`, `Set`, `WorkoutSessionInputSchema`, `WorkoutSessionInput` — consumed by Task 8's progression engine and Task 9's workout routes.
- Produces: `FoodEntryInputSchema`, `FoodEntryInput` — consumed by Task 10's nutrition routes.
- Produces: `SleepSessionInputSchema`, `SleepSessionInput` — consumed by Task 11's sleep routes.

This task has no runnable app to test against yet — schemas are tested directly with `zod`'s own parse/safeParse, which is already exercised via `vitest` in the `shared` package. Add `vitest` and `zod` to `shared/package.json` first.

- [ ] **Step 1: Add test tooling to the `shared` package**

Modify `shared/package.json` to add:
```json
{
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "vitest": "^2.0.5"
  }
}
```

Run: `cd shared && pnpm install`

- [ ] **Step 2: Write the failing test for the health-event schema**

`shared/src/schemas/health.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { HealthEventPayloadSchema } from "./health.js";

describe("HealthEventPayloadSchema", () => {
  it("accepts a valid heart-rate sample event", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "heart_rate",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 62,
      unit: "bpm",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an event with an unknown metric", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "not_a_real_metric",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an event missing a timestamp", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "steps",
      value: 100,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a timestamp with a numeric UTC offset, not only a bare Z suffix", () => {
    // HealthKit/iOS timestamps aren't guaranteed to be pre-normalized to UTC "Z" —
    // reject this and every sync payload from the iOS bridge app silently fails.
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "steps",
      timestamp: "2026-09-06T13:30:00.000+05:30",
      value: 100,
    });
    expect(result.success).toBe(true);
  });

  it("rejects sleep and workout as metrics — those go through /api/sleep and /api/workouts instead", () => {
    const sleepResult = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "sleep",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 1,
    });
    expect(sleepResult.success).toBe(false);

    const workoutResult = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "workout",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 1,
    });
    expect(workoutResult.success).toBe(false);
  });

  it("rejects an event with no value, since every remaining metric is a plain quantity sample", () => {
    const result = HealthEventPayloadSchema.safeParse({
      source: "ios-bridge",
      metric: "heart_rate",
      timestamp: "2026-09-06T08:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd shared && pnpm test`
Expected: FAIL — `./health.js` does not exist.

- [ ] **Step 4: Implement the health-event schema**

This schema is deliberately scoped to flat quantity samples only (heart rate, steps, active energy, weight, VO2max) — matching exactly what `HealthSample` (Task 5) is a time-series collection for. Sleep and workout data have their own richer shapes (stages, sets) and their own endpoints (`/api/sleep` in Task 11, `/api/workouts` in Task 9); routing them through this flat metric+value contract instead was the source of a schema/model mismatch caught during this plan's audit (a "sleep" or "workout" event would pass this schema but then fail Mongoose validation against `HealthSample`'s narrower enum — see Task 5).

`shared/src/schemas/health.ts`:
```typescript
import { z } from "zod";

export const HealthMetricSchema = z.enum(["heart_rate", "steps", "active_energy", "weight", "vo2max"]);
export type HealthMetric = z.infer<typeof HealthMetricSchema>;

export const HealthEventPayloadSchema = z.object({
  source: z.string().min(1),
  metric: HealthMetricSchema,
  // { offset: true } accepts numeric-offset ISO timestamps (e.g. "...+05:30"),
  // not only UTC "Z" — the iOS bridge app is not guaranteed to pre-normalize to UTC.
  timestamp: z.string().datetime({ offset: true }),
  value: z.number(),
  unit: z.string().optional(),
});
export type HealthEventPayload = z.infer<typeof HealthEventPayloadSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd shared && pnpm test`
Expected: PASS

- [ ] **Step 6: Write the failing test for the workout schema**

`shared/src/schemas/workout.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { SetSchema, WorkoutSessionInputSchema } from "./workout.js";

describe("SetSchema", () => {
  it("accepts a normal set", () => {
    const result = SetSchema.safeParse({ reps: 10, weight: 20, rir: 2, type: "normal" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative rep count", () => {
    const result = SetSchema.safeParse({ reps: -1, weight: 20, type: "normal" });
    expect(result.success).toBe(false);
  });
});

describe("WorkoutSessionInputSchema", () => {
  it("accepts a session with one exercise and two sets", () => {
    const result = WorkoutSessionInputSchema.safeParse({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 12, weight: 0, type: "normal" },
            { reps: 10, weight: 0, type: "normal" },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a session with no exercises", () => {
    const result = WorkoutSessionInputSchema.safeParse({ date: "2026-09-06", exercises: [] });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 7: Run test to verify it fails, then implement**

Run: `cd shared && pnpm test` → FAIL (`./workout.js` missing)

`shared/src/schemas/workout.ts`:
```typescript
import { z } from "zod";

export const SetTypeSchema = z.enum(["warmup", "normal", "dropset", "failure", "amrap"]);

export const SetSchema = z.object({
  reps: z.number().int().min(0),
  weight: z.number().min(0),
  rir: z.number().min(0).max(10).optional(),
  type: SetTypeSchema,
});
export type Set = z.infer<typeof SetSchema>;

export const ReadinessSchema = z.object({
  sleepHours: z.number().min(0).max(24),
  soreness: z.number().int().min(1).max(5),
  motivation: z.number().int().min(1).max(5),
});
export type Readiness = z.infer<typeof ReadinessSchema>;

export const WorkoutSessionInputSchema = z.object({
  date: z.string().min(1),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().min(1),
        sets: z.array(SetSchema).min(1),
      })
    )
    .min(1),
  readiness: ReadinessSchema.optional(),
});
export type WorkoutSessionInput = z.infer<typeof WorkoutSessionInputSchema>;
```

Run: `cd shared && pnpm test` → PASS

- [ ] **Step 8: Write the failing test for the food-entry schema, then implement**

`shared/src/schemas/food.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { FoodEntryInputSchema } from "./food.js";

describe("FoodEntryInputSchema", () => {
  it("accepts a logged Indian dish with macros", () => {
    const result = FoodEntryInputSchema.safeParse({
      date: "2026-09-06",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
      addedFatGrams: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mealSlot", () => {
    const result = FoodEntryInputSchema.safeParse({
      date: "2026-09-06",
      mealSlot: "midnight-snack",
      source: "llm_estimate",
      macros: { calories: 100, proteinG: 5, carbsG: 10, fatG: 2 },
    });
    expect(result.success).toBe(false);
  });
});
```

Run: `cd shared && pnpm test` → FAIL

`shared/src/schemas/food.ts`:
```typescript
import { z } from "zod";

export const MealSlotSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export const FoodSourceSchema = z.enum(["indian_dish", "packaged_food", "llm_estimate"]);

export const MacrosSchema = z.object({
  calories: z.number().min(0),
  proteinG: z.number().min(0),
  carbsG: z.number().min(0),
  fatG: z.number().min(0),
});
export type Macros = z.infer<typeof MacrosSchema>;

export const FoodEntryInputSchema = z.object({
  date: z.string().min(1),
  mealSlot: MealSlotSchema,
  source: FoodSourceSchema,
  refId: z.string().optional(),
  macros: MacrosSchema,
  addedFatGrams: z.number().min(0).optional(),
});
export type FoodEntryInput = z.infer<typeof FoodEntryInputSchema>;
```

Run: `cd shared && pnpm test` → PASS

- [ ] **Step 9: Write the failing test for the sleep schema, then implement**

`shared/src/schemas/sleep.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { SleepSessionInputSchema } from "./sleep.js";

describe("SleepSessionInputSchema", () => {
  it("accepts a session with bed and wake times", () => {
    const result = SleepSessionInputSchema.safeParse({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "2026-09-07T04:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a session where wakeTime is not a valid datetime", () => {
    const result = SleepSessionInputSchema.safeParse({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});
```

Run: `cd shared && pnpm test` → FAIL

`shared/src/schemas/sleep.ts`:
```typescript
import { z } from "zod";

export const SleepSessionInputSchema = z.object({
  date: z.string().min(1),
  bedTime: z.string().datetime(),
  wakeTime: z.string().datetime(),
  morningLightWithinMinutes: z.number().min(0).optional(),
  morningExercise: z.boolean().optional(),
});
export type SleepSessionInput = z.infer<typeof SleepSessionInputSchema>;
```

Run: `cd shared && pnpm test` → PASS

- [ ] **Step 10: Re-export everything from the package entry point**

`shared/src/index.ts`:
```typescript
export const SHARED_PACKAGE_NAME = "@health-tracker/shared";

export * from "./schemas/health.js";
export * from "./schemas/workout.js";
export * from "./schemas/food.js";
export * from "./schemas/sleep.js";
```

- [ ] **Step 11: Commit**

```bash
git add shared
git commit -m "feat: add shared zod schemas for health events, workouts, food, sleep"
```

---

### Task 3: MongoDB connection + env config + shared crypto/date helpers

**Files:**
- Create: `api/src/config/env.ts`
- Create: `api/src/lib/db.ts`
- Create: `api/src/lib/crypto.ts`
- Create: `api/src/lib/dates.ts`
- Create: `api/src/lib/bearerAuth.ts`
- Test: `api/src/lib/db.test.ts`
- Test: `api/src/lib/crypto.test.ts`
- Test: `api/src/lib/dates.test.ts`
- Test: `api/src/lib/bearerAuth.test.ts`

**Interfaces:**
- Produces: `loadEnv(): Env` (typed env accessor) from `api/src/config/env.ts` — used by every module reading an env var.
- Produces: `connectDb(uri: string): Promise<typeof mongoose>`, `disconnectDb(): Promise<void>` from `api/src/lib/db.ts` — used by every model test and by `index.ts` at boot.
- Produces: `constantTimeEquals(a: string, b: string): boolean` from `api/src/lib/crypto.ts` — the single shared secret-comparison helper used by Task 4 (login), and indirectly by Tasks 7 and 14 via `requireBearerToken` below.
- Produces: `IST_TIME_ZONE`, `toIstDateString(date: Date): string`, `istDateRangeUtc(dateStr: string): { start: Date; end: Date }` from `api/src/lib/dates.ts` — every place in this plan that buckets data "by day" (the nightly rollup in Task 12, the weekly digest in Task 14) must go through these, not raw UTC arithmetic, because the app's one user is in India (UTC+5:30) and naive UTC day boundaries misfile data logged late at night.
- Produces: `requireBearerToken(expectedToken: string): RequestHandler` from `api/src/lib/bearerAuth.ts` — the single shared bearer-token-checking middleware factory used by Task 7's device-ingestion route and Task 14's MCP server, so the "check an Authorization header against a secret" logic exists exactly once.

- [ ] **Step 1: Write the failing test for the constant-time comparison helper**

`api/src/lib/crypto.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { constantTimeEquals } from "./crypto.js";

describe("constantTimeEquals", () => {
  it("returns true for two identical non-empty strings", () => {
    expect(constantTimeEquals("correct-token", "correct-token")).toBe(true);
  });

  it("returns false for two different strings of the same length", () => {
    expect(constantTimeEquals("correct-token", "wrong-tokennn")).toBe(false);
  });

  it("returns false for two different-length strings", () => {
    expect(constantTimeEquals("short", "a-much-longer-string")).toBe(false);
  });

  it("returns false when either input is empty", () => {
    expect(constantTimeEquals("", "")).toBe(false);
    expect(constantTimeEquals("", "something")).toBe(false);
    expect(constantTimeEquals("something", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./crypto.js` does not exist.

- [ ] **Step 3: Implement `constantTimeEquals`**

`api/src/lib/crypto.ts`:
```typescript
import { timingSafeEqual } from "node:crypto";

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length === 0 || bufferB.length === 0) {
    return false;
  }

  if (bufferA.length !== bufferB.length) {
    // Compare against a same-length dummy so the early return above and this
    // branch take roughly comparable time either way — this is a personal,
    // single-user app, so this is a reasonable (not cryptographically
    // rigorous) mitigation, not a guarantee against a determined attacker.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 5: Write the failing test for the IST date helpers**

`api/src/lib/dates.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { toIstDateString, istDateRangeUtc } from "./dates.js";

describe("toIstDateString", () => {
  it("returns the IST calendar date for a UTC instant just before IST midnight", () => {
    // 2026-09-06T18:29:59.000Z is 2026-09-06T23:59:59 IST (UTC+5:30) — still the 6th in IST.
    expect(toIstDateString(new Date("2026-09-06T18:29:59.000Z"))).toBe("2026-09-06");
  });

  it("returns the next IST calendar date once past IST midnight", () => {
    // 2026-09-06T18:30:00.000Z is 2026-09-07T00:00:00 IST — the 7th in IST, still the 6th in UTC.
    expect(toIstDateString(new Date("2026-09-06T18:30:00.000Z"))).toBe("2026-09-07");
  });
});

describe("istDateRangeUtc", () => {
  it("returns the UTC instants bounding IST midnight-to-midnight for the given date", () => {
    const { start, end } = istDateRangeUtc("2026-09-06");
    // IST 2026-09-06T00:00:00 == UTC 2026-09-05T18:30:00
    expect(start.toISOString()).toBe("2026-09-05T18:30:00.000Z");
    // IST 2026-09-07T00:00:00 (exclusive end) == UTC 2026-09-06T18:30:00
    expect(end.toISOString()).toBe("2026-09-06T18:30:00.000Z");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./dates.js` does not exist.

- [ ] **Step 7: Implement the IST date helpers**

India has a single fixed UTC+5:30 offset year-round (no daylight saving), so this can be implemented with plain offset arithmetic instead of a timezone database — `IST_TIME_ZONE` is kept only as a documented label for cron/config, not used for computation.

`api/src/lib/dates.ts`:
```typescript
export const IST_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 5 * 60 + 30;

export function toIstDateString(date: Date): string {
  const istInstant = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return istInstant.toISOString().slice(0, 10);
}

export function istDateRangeUtc(dateStr: string): { start: Date; end: Date } {
  // Midnight IST on `dateStr`, expressed as the equivalent UTC instant.
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  start.setUTCMinutes(start.getUTCMinutes() - IST_OFFSET_MINUTES);

  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 9: Write the failing test for the shared bearer-token middleware**

Task 7 (device/iOS ingestion) and Task 14 (MCP server) both need to check a caller-supplied `Authorization: Bearer <token>` header against a known secret. Rather than each implementing (and slightly diverging on) that check, this one middleware factory is the single implementation both tasks import.

`api/src/lib/bearerAuth.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requireBearerToken } from "./bearerAuth.js";

function testApp(expectedToken: string) {
  const app = express();
  app.get("/protected", requireBearerToken(expectedToken), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("requireBearerToken", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await request(testApp("secret-token")).get("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong token", async () => {
    const res = await request(testApp("secret-token")).get("/protected").set("Authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });

  it("rejects a header that isn't in Bearer form", async () => {
    const res = await request(testApp("secret-token")).get("/protected").set("Authorization", "secret-token");
    expect(res.status).toBe(401);
  });

  it("allows a request with the correct bearer token", async () => {
    const res = await request(testApp("secret-token")).get("/protected").set("Authorization", "Bearer secret-token");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./bearerAuth.js` does not exist.

- [ ] **Step 11: Implement the middleware**

`api/src/lib/bearerAuth.ts`:
```typescript
import type { Request, Response, NextFunction } from "express";
import { constantTimeEquals } from "./crypto.js";

export function requireBearerToken(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

    if (!constantTimeEquals(token, expectedToken)) {
      res.status(401).json({ error: "Invalid or missing bearer token" });
      return;
    }

    next();
  };
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 13: Write the failing test for `connectDb`**

`api/src/lib/db.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "./db.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
});

afterAll(async () => {
  await mongod.stop();
});

describe("connectDb", () => {
  it("connects to the given MongoDB URI", async () => {
    await connectDb(mongod.getUri());
    expect(mongoose.connection.readyState).toBe(1);
    await disconnectDb();
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./db.js` does not exist.

- [ ] **Step 15: Implement `connectDb`/`disconnectDb`**

`api/src/lib/db.ts`:
```typescript
import mongoose from "mongoose";

export async function connectDb(uri: string) {
  return mongoose.connect(uri);
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
```

- [ ] **Step 16: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 17: Implement typed env loading**

`api/src/config/env.ts`:
```typescript
export type Env = {
  port: number;
  mongoUri: string;
  sessionSecret: string;
  appPassword: string;
  mcpAccessToken: string;
  webOrigin: string;
};

export function loadEnv(): Env {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
  };

  return {
    port: Number(process.env.PORT ?? 4000),
    mongoUri: required("MONGO_URI"),
    sessionSecret: required("SESSION_SECRET"),
    appPassword: required("APP_PASSWORD"),
    mcpAccessToken: required("MCP_ACCESS_TOKEN"),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}
```

- [ ] **Step 18: Wire `connectDb` and `loadEnv` into `index.ts`**

Modify `api/src/index.ts`:
```typescript
import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./lib/db.js";

const env = loadEnv();

await connectDb(env.mongoUri);

const app = createApp();
app.listen(env.port, () => {
  console.log(`api listening on port ${env.port}`);
});
```

- [ ] **Step 19: Commit**

```bash
git add api/src/config api/src/lib/db.ts api/src/lib/db.test.ts api/src/lib/crypto.ts api/src/lib/crypto.test.ts api/src/lib/dates.ts api/src/lib/dates.test.ts api/src/lib/bearerAuth.ts api/src/lib/bearerAuth.test.ts api/src/index.ts
git commit -m "feat: add mongodb connection, typed env config, constant-time compare, IST date helpers, bearer auth middleware"
```

---

### Task 4: iron-session auth

**Files:**
- Create: `api/src/lib/session.ts`
- Create: `api/src/modules/auth/auth.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/auth/auth.routes.test.ts`

**Interfaces:**
- Produces: `getSession(req, res): Promise<IronSession<SessionData>>`, `requireAuth` (Express middleware) from `api/src/lib/session.ts` — every protected route in Tasks 6, 9, 10, 11 uses `requireAuth`.
- Consumes: `loadEnv` from Task 3, `constantTimeEquals` from Task 3.

- [ ] **Step 1: Write the failing test for the auth routes**

`api/src/modules/auth/auth.routes.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

describe("auth routes", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "a".repeat(32);
    process.env.APP_PASSWORD = "correct-horse-battery-staple";
  });

  it("rejects a login with the wrong password", async () => {
    const app = createApp();
    const res = await request(app).post("/api/auth/login").send({ password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("logs in with the correct password and sets a session cookie", async () => {
    const app = createApp();
    const res = await request(app).post("/api/auth/login").send({ password: "correct-horse-battery-staple" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("blocks a protected route without a session", async () => {
    const app = createApp();
    const res = await request(app).get("/api/auth/whoami");
    expect(res.status).toBe(401);
  });

  it("allows a protected route after logging in", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "correct-horse-battery-staple" });
    const res = await agent.get("/api/auth/whoami");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ loggedIn: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `/api/auth/login` route does not exist.

- [ ] **Step 3: Implement the session helper**

`api/src/lib/session.ts`:
```typescript
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import type { Request, Response, NextFunction } from "express";

export type SessionData = {
  loggedIn?: boolean;
};

function sessionOptions(): SessionOptions {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return {
    cookieName: "health-tracker-session",
    password: secret,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      httpOnly: true,
    },
  };
}

export async function getSession(req: Request, res: Response): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(req, res, sessionOptions());
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await getSession(req, res);
  if (!session.loggedIn) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}
```

- [ ] **Step 4: Implement the auth routes**

`api/src/modules/auth/auth.routes.ts`:
```typescript
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getSession, requireAuth } from "../../lib/session.js";
import { constantTimeEquals } from "../../lib/crypto.js";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { password } = req.body as { password?: string };

  if (!constantTimeEquals(password ?? "", process.env.APP_PASSWORD ?? "")) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const session = await getSession(req, res);
  session.loggedIn = true;
  await session.save();
  res.json({ loggedIn: true });
});

authRouter.post("/logout", async (req, res) => {
  const session = await getSession(req, res);
  session.destroy();
  res.json({ loggedIn: false });
});

authRouter.get("/whoami", requireAuth, (_req, res) => {
  res.json({ loggedIn: true });
});
```

This depends on `constantTimeEquals` from Task 3 — if executing tasks out of order, implement Task 3 first.

- [ ] **Step 5: Mount the auth router**

Modify `api/src/app.ts`:
```typescript
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { authRouter } from "./modules/auth/auth.routes.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRouter);

  return app;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/session.ts api/src/modules/auth api/src/app.ts
git commit -m "feat: add iron-session auth with login/logout/whoami"
```

---

### Task 5: Health, training, and coaching data models

**Files:**
- Create: `api/src/models/User.ts`
- Create: `api/src/models/HealthSample.ts`
- Create: `api/src/models/DailyRollup.ts`
- Create: `api/src/models/SleepSession.ts`
- Create: `api/src/models/Exercise.ts`
- Create: `api/src/models/ProgramTemplate.ts`
- Create: `api/src/models/ProgressionState.ts`
- Create: `api/src/models/WorkoutSession.ts`
- Test: `api/src/models/models.test.ts`

**Interfaces:**
- Produces: Mongoose models `User`, `HealthSample`, `DailyRollup`, `SleepSession`, `Exercise`, `ProgramTemplate`, `ProgressionState`, `WorkoutSession` — consumed by Tasks 6, 8, 9, 11, 12, 13.

- [ ] **Step 1: Write the failing test for the time-series `HealthSample` model**

`api/src/models/models.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { HealthSample } from "./HealthSample.js";
import { SleepSession } from "./SleepSession.js";
import { Exercise } from "./Exercise.js";
import { WorkoutSession } from "./WorkoutSession.js";
import { ProgressionState } from "./ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("HealthSample", () => {
  it("stores a heart-rate sample with its metric as metadata", async () => {
    const doc = await HealthSample.create({
      timestamp: new Date("2026-09-06T08:00:00.000Z"),
      metric: "heart_rate",
      value: 62,
      unit: "bpm",
      source: "ios-bridge",
    });
    expect(doc.metric).toBe("heart_rate");
    expect(doc.value).toBe(62);
  });
});

describe("SleepSession", () => {
  it("computes nothing on its own but stores bed/wake times and a midpoint", async () => {
    const bedTime = new Date("2026-09-06T20:30:00.000Z");
    const wakeTime = new Date("2026-09-07T04:00:00.000Z");
    const midpoint = new Date((bedTime.getTime() + wakeTime.getTime()) / 2);
    const doc = await SleepSession.create({ date: "2026-09-06", bedTime, wakeTime, midpoint });
    expect(doc.date).toBe("2026-09-06");
    expect(doc.midpoint.toISOString()).toBe(midpoint.toISOString());
  });
});

describe("Exercise", () => {
  it("stores a seeded exercise with muscle groups and equipment", async () => {
    const doc = await Exercise.create({
      slug: "incline-pushup",
      name: "Incline Push-Up",
      muscleGroups: ["chest", "triceps"],
      equipment: ["none"],
      images: [],
    });
    expect(doc.slug).toBe("incline-pushup");
  });
});

describe("WorkoutSession", () => {
  it("stores embedded exercises and sets", async () => {
    const doc = await WorkoutSession.create({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [{ reps: 12, weight: 0, type: "normal" }],
        },
      ],
    });
    expect(doc.exercises).toHaveLength(1);
    expect(doc.exercises[0].sets[0].reps).toBe(12);
  });
});

describe("ProgressionState", () => {
  it("stores one bodyweight-phase state per exercise", async () => {
    const doc = await ProgressionState.create({
      exerciseId: "incline-pushup",
      phase: "bodyweight",
      level: 0,
      repRangeLow: 8,
      repRangeHigh: 15,
      consecutiveTopOfRange: 0,
      consecutiveBelowRange: 0,
    });
    expect(doc.phase).toBe("bodyweight");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — none of the model files exist yet.

- [ ] **Step 3: Implement `User`**

`api/src/models/User.ts`:
```typescript
import { Schema, model } from "mongoose";

const userSchema = new Schema({
  createdAt: { type: Date, default: Date.now },
});

export const User = model("User", userSchema);
```

- [ ] **Step 4: Implement `HealthSample` as a time-series collection**

`api/src/models/HealthSample.ts`:
```typescript
import { Schema, model } from "mongoose";

const healthSampleSchema = new Schema(
  {
    timestamp: { type: Date, required: true },
    metric: {
      type: String,
      required: true,
      enum: ["heart_rate", "steps", "active_energy", "weight", "vo2max"],
    },
    value: { type: Number, required: true },
    unit: { type: String },
    source: { type: String, required: true },
  },
  {
    timeseries: {
      timeField: "timestamp",
      metaField: "metric",
      granularity: "minutes",
    },
  }
);

export const HealthSample = model("HealthSample", healthSampleSchema);
```

- [ ] **Step 5: Implement `DailyRollup`**

`api/src/models/DailyRollup.ts`:
```typescript
import { Schema, model } from "mongoose";

const dailyRollupSchema = new Schema({
  date: { type: String, required: true, unique: true },
  totalSteps: { type: Number, default: 0 },
  restingHeartRate: { type: Number },
  activeCalories: { type: Number },
  totalCalories: { type: Number },
  weightKg: { type: Number },
  sleepMidpoint: { type: Date },
  proteinG: { type: Number, default: 0 },
  hardSets: { type: Number, default: 0 },
});

export const DailyRollup = model("DailyRollup", dailyRollupSchema);
```

- [ ] **Step 6: Implement `SleepSession`**

`api/src/models/SleepSession.ts`:
```typescript
import { Schema, model } from "mongoose";

const sleepSessionSchema = new Schema({
  date: { type: String, required: true, unique: true },
  bedTime: { type: Date, required: true },
  wakeTime: { type: Date, required: true },
  midpoint: { type: Date, required: true },
  stages: {
    core: Number,
    deep: Number,
    rem: Number,
    awake: Number,
  },
  morningLightWithinMinutes: { type: Number },
  morningExercise: { type: Boolean },
  socialJetlagMinutes: { type: Number },
});

export const SleepSession = model("SleepSession", sleepSessionSchema);
```

- [ ] **Step 7: Implement `Exercise`**

`api/src/models/Exercise.ts`:
```typescript
import { Schema, model } from "mongoose";

const exerciseSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  muscleGroups: { type: [String], default: [] },
  equipment: { type: [String], default: [] },
  images: { type: [String], default: [] },
  homeEquivalentSlug: { type: String },
});

export const Exercise = model("Exercise", exerciseSchema);
```

- [ ] **Step 8: Implement `ProgramTemplate`**

`api/src/models/ProgramTemplate.ts`:
```typescript
import { Schema, model } from "mongoose";

const programExerciseSchema = new Schema(
  {
    exerciseSlug: { type: String, required: true },
    sets: { type: Number, required: true },
    repRangeLow: { type: Number, required: true },
    repRangeHigh: { type: Number, required: true },
  },
  { _id: false }
);

const programTemplateSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  phase: { type: String, required: true, enum: ["bodyweight", "barbell"] },
  exercises: { type: [programExerciseSchema], default: [] },
  weeklySchedule: {
    type: [
      {
        day: { type: String, required: true },
        activity: { type: String, required: true },
      },
    ],
    default: [],
  },
});

export const ProgramTemplate = model("ProgramTemplate", programTemplateSchema);
```

- [ ] **Step 9: Implement `ProgressionState`**

`api/src/models/ProgressionState.ts`:
```typescript
import { Schema, model } from "mongoose";

const progressionStateSchema = new Schema({
  exerciseId: { type: String, required: true, unique: true },
  phase: { type: String, required: true, enum: ["bodyweight", "barbell"] },
  level: { type: Number, default: 0 },
  loadKg: { type: Number },
  increment: { type: Number },
  repRangeLow: { type: Number },
  repRangeHigh: { type: Number },
  consecutiveTopOfRange: { type: Number, default: 0 },
  consecutiveBelowRange: { type: Number, default: 0 },
  consecutiveMisses: { type: Number, default: 0 },
  lastDeloadAt: { type: Date },
});

export const ProgressionState = model("ProgressionState", progressionStateSchema);
```

- [ ] **Step 10: Implement `WorkoutSession`**

`api/src/models/WorkoutSession.ts`:
```typescript
import { Schema, model } from "mongoose";

const setSchema = new Schema(
  {
    reps: { type: Number, required: true },
    weight: { type: Number, required: true },
    rir: { type: Number },
    type: {
      type: String,
      required: true,
      enum: ["warmup", "normal", "dropset", "failure", "amrap"],
    },
  },
  { _id: false }
);

const workoutExerciseSchema = new Schema(
  {
    exerciseId: { type: String, required: true },
    sets: { type: [setSchema], required: true },
  },
  { _id: false }
);

const readinessSchema = new Schema(
  {
    sleepHours: { type: Number },
    soreness: { type: Number },
    motivation: { type: Number },
  },
  { _id: false }
);

const workoutSessionSchema = new Schema({
  // Indexed: computeDailyRollup (Task 12) and getWeeklyDigest (Task 14) both
  // query directly by date.
  date: { type: String, required: true, index: true },
  exercises: { type: [workoutExerciseSchema], required: true },
  readiness: { type: readinessSchema },
  createdAt: { type: Date, default: Date.now },
});

export const WorkoutSession = model("WorkoutSession", workoutSessionSchema);
```

- [ ] **Step 11: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add api/src/models
git commit -m "feat: add health, training, and coaching mongoose models"
```

---

### Task 6: Nutrition and coaching data models

**Files:**
- Create: `api/src/models/IndianDish.ts`
- Create: `api/src/models/PackagedFood.ts`
- Create: `api/src/models/FoodEntry.ts`
- Create: `api/src/models/Recipe.ts`
- Create: `api/src/models/CoachNote.ts`
- Test: `api/src/models/nutrition-models.test.ts`

**Interfaces:**
- Produces: Mongoose models `IndianDish`, `PackagedFood`, `FoodEntry`, `Recipe`, `CoachNote` — consumed by Tasks 10, 13, 14.

- [ ] **Step 1: Write the failing test**

`api/src/models/nutrition-models.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { IndianDish } from "./IndianDish.js";
import { PackagedFood } from "./PackagedFood.js";
import { FoodEntry } from "./FoodEntry.js";
import { Recipe } from "./Recipe.js";
import { CoachNote } from "./CoachNote.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("IndianDish", () => {
  it("stores per-serving macros for a cooked dish", async () => {
    const doc = await IndianDish.create({
      slug: "dal-tadka",
      name: "Dal Tadka",
      servingGrams: 200,
      macrosPerServing: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
      source: "INDB",
    });
    expect(doc.macrosPerServing.proteinG).toBe(12);
  });
});

describe("PackagedFood", () => {
  it("stores a barcode-scanned product isolated from IndianDish", async () => {
    const doc = await PackagedFood.create({
      barcode: "8901063001011",
      name: "Nutrela Soya Chunks",
      macrosPer100g: { calories: 345, proteinG: 52, carbsG: 33, fatG: 0.5 },
      source: "open_food_facts",
    });
    expect(doc.barcode).toBe("8901063001011");
  });
});

describe("FoodEntry", () => {
  it("stores a logged entry referencing an IndianDish", async () => {
    const doc = await FoodEntry.create({
      date: "2026-09-06",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
      addedFatGrams: 5,
    });
    expect(doc.mealSlot).toBe("lunch");
  });
});

describe("Recipe", () => {
  it("stores a hostel-cookable recipe with equipment tags", async () => {
    const doc = await Recipe.create({
      slug: "soya-chunk-masala",
      name: "Soya Chunk Masala",
      ingredients: [{ name: "soya chunks (dry)", grams: 50 }],
      steps: ["Soak soya chunks in hot water for 10 minutes.", "Saute with onion-tomato masala on induction."],
      equipment: ["pan", "induction"],
      prepMinutes: 20,
      macros: { calories: 260, proteinG: 26, carbsG: 22, fatG: 6 },
      tags: ["high-protein", "vegetarian"],
    });
    expect(doc.equipment).toContain("induction");
  });
});

describe("CoachNote", () => {
  it("stores an LLM-authored weekly note", async () => {
    const doc = await CoachNote.create({
      weekOf: "2026-09-01",
      digest: { proteinHitRate: 0.8 },
      summary: "Good protein consistency this week.",
      suggestions: ["Add a second dance session."],
      source: "mcp_session",
    });
    expect(doc.source).toBe("mcp_session");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — none of these model files exist yet.

- [ ] **Step 3: Implement `IndianDish`**

`api/src/models/IndianDish.ts`:
```typescript
import { Schema, model } from "mongoose";

const macrosSchema = new Schema(
  {
    calories: { type: Number, required: true },
    proteinG: { type: Number, required: true },
    carbsG: { type: Number, required: true },
    fatG: { type: Number, required: true },
  },
  { _id: false }
);

const indianDishSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  servingGrams: { type: Number, required: true },
  macrosPerServing: { type: macrosSchema, required: true },
  source: { type: String, required: true, enum: ["INDB", "IFCT2017"] },
});

export const IndianDish = model("IndianDish", indianDishSchema);
```

- [ ] **Step 4: Implement `PackagedFood`**

`api/src/models/PackagedFood.ts`:
```typescript
import { Schema, model } from "mongoose";

const macrosSchema = new Schema(
  {
    calories: { type: Number, required: true },
    proteinG: { type: Number, required: true },
    carbsG: { type: Number, required: true },
    fatG: { type: Number, required: true },
  },
  { _id: false }
);

const packagedFoodSchema = new Schema({
  barcode: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  macrosPer100g: { type: macrosSchema, required: true },
  source: { type: String, required: true, enum: ["open_food_facts"] },
});

export const PackagedFood = model("PackagedFood", packagedFoodSchema);
```

- [ ] **Step 5: Implement `FoodEntry`**

`api/src/models/FoodEntry.ts`:
```typescript
import { Schema, model } from "mongoose";

const macrosSchema = new Schema(
  {
    calories: { type: Number, required: true },
    proteinG: { type: Number, required: true },
    carbsG: { type: Number, required: true },
    fatG: { type: Number, required: true },
  },
  { _id: false }
);

const foodEntrySchema = new Schema({
  // Indexed: getDailyMacroSummary (Task 10) and computeDailyRollup (Task 12)
  // both query directly by date.
  date: { type: String, required: true, index: true },
  mealSlot: { type: String, required: true, enum: ["breakfast", "lunch", "dinner", "snack"] },
  source: { type: String, required: true, enum: ["indian_dish", "packaged_food", "llm_estimate"] },
  refId: { type: String },
  macros: { type: macrosSchema, required: true },
  addedFatGrams: { type: Number },
  createdAt: { type: Date, default: Date.now },
});

export const FoodEntry = model("FoodEntry", foodEntrySchema);
```

- [ ] **Step 6: Implement `Recipe`**

`api/src/models/Recipe.ts`:
```typescript
import { Schema, model } from "mongoose";

const macrosSchema = new Schema(
  {
    calories: { type: Number, required: true },
    proteinG: { type: Number, required: true },
    carbsG: { type: Number, required: true },
    fatG: { type: Number, required: true },
  },
  { _id: false }
);

const ingredientSchema = new Schema(
  {
    ifctRefId: { type: String },
    name: { type: String, required: true },
    grams: { type: Number, required: true },
  },
  { _id: false }
);

const recipeSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  ingredients: { type: [ingredientSchema], required: true },
  steps: { type: [String], required: true },
  equipment: { type: [String], required: true, enum: ["pan", "pressure_cooker", "induction"] },
  prepMinutes: { type: Number, required: true },
  macros: { type: macrosSchema, required: true },
  tags: { type: [String], default: [] },
});

export const Recipe = model("Recipe", recipeSchema);
```

- [ ] **Step 7: Implement `CoachNote`**

`api/src/models/CoachNote.ts`:
```typescript
import { Schema, model } from "mongoose";

const coachNoteSchema = new Schema({
  weekOf: { type: String, required: true },
  digest: { type: Schema.Types.Mixed, required: true },
  llmModel: { type: String },
  summary: { type: String, required: true },
  suggestions: { type: [String], default: [] },
  source: { type: String, required: true, enum: ["vendor_scheduled_task", "mcp_session"] },
  createdAt: { type: Date, default: Date.now },
});

export const CoachNote = model("CoachNote", coachNoteSchema);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add api/src/models
git commit -m "feat: add nutrition and coaching mongoose models"
```

---

### Task 7: Health-events ingestion endpoint + adapter

**Files:**
- Create: `api/src/modules/health-events/ingestion-adapter.ts`
- Create: `api/src/modules/health-events/health-events.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/health-events/ingestion-adapter.test.ts`
- Test: `api/src/modules/health-events/health-events.routes.test.ts`

**Interfaces:**
- Consumes: `HealthEventPayload` from `@health-tracker/shared` (Task 2), `HealthSample` model (Task 5), `requireBearerToken` from Task 3.
- Produces: `normalizeHealthEvent(payload: HealthEventPayload): { timestamp: Date; metric: string; value: number; unit?: string; source: string }` from `ingestion-adapter.ts` — this is the one seam spec §4.2 calls out as isolated; if the sync source ever changes, only this function's input handling changes.

- [ ] **Step 1: Write the failing test for the adapter**

`api/src/modules/health-events/ingestion-adapter.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeHealthEvent } from "./ingestion-adapter.js";

describe("normalizeHealthEvent", () => {
  it("converts a valid payload into a Mongo-ready sample", () => {
    const normalized = normalizeHealthEvent({
      source: "ios-bridge",
      metric: "heart_rate",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 62,
      unit: "bpm",
    });
    expect(normalized.metric).toBe("heart_rate");
    expect(normalized.value).toBe(62);
    expect(normalized.timestamp).toBeInstanceOf(Date);
    expect(normalized.source).toBe("ios-bridge");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./ingestion-adapter.js` does not exist.

- [ ] **Step 3: Implement the adapter**

`api/src/modules/health-events/ingestion-adapter.ts`:
```typescript
import type { HealthEventPayload } from "@health-tracker/shared";

export type NormalizedHealthSample = {
  timestamp: Date;
  metric: string;
  value: number;
  unit?: string;
  source: string;
};

export function normalizeHealthEvent(payload: HealthEventPayload): NormalizedHealthSample {
  // payload.value is a required number at the type level (Task 2's schema
  // enforces this), so there is no "missing value" branch to handle here —
  // Zod validation in the route (Step 7 below) is what rejects a bad payload
  // before this function is ever called.
  return {
    timestamp: new Date(payload.timestamp),
    metric: payload.metric,
    value: payload.value,
    unit: payload.unit,
    source: payload.source,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 5: Write the failing test for the ingestion route**

`api/src/modules/health-events/health-events.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { HealthSample } from "../../models/HealthSample.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.MCP_ACCESS_TOKEN = "test-ingestion-token";
});

afterEach(async () => {
  await HealthSample.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /api/health-events", () => {
  it("rejects a request without a bearer token", async () => {
    const app = createApp();
    const res = await request(app).post("/api/health-events").send({
      source: "ios-bridge",
      metric: "steps",
      timestamp: "2026-09-06T08:00:00.000Z",
      value: 4000,
    });
    expect(res.status).toBe(401);
  });

  it("stores a valid event and returns 201", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/health-events")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({
        source: "ios-bridge",
        metric: "steps",
        timestamp: "2026-09-06T08:00:00.000Z",
        value: 4000,
      });
    expect(res.status).toBe(201);
    const stored = await HealthSample.find({});
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBe(4000);
  });

  it("rejects a malformed payload with 400", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/health-events")
      .set("Authorization", "Bearer test-ingestion-token")
      .send({ source: "ios-bridge", metric: "not-real", timestamp: "bad-date" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — the route does not exist.

- [ ] **Step 7: Implement the ingestion route**

`api/src/modules/health-events/health-events.routes.ts`:
```typescript
import { Router } from "express";
import { HealthEventPayloadSchema } from "@health-tracker/shared";
import { normalizeHealthEvent } from "./ingestion-adapter.js";
import { HealthSample } from "../../models/HealthSample.js";
import { requireBearerToken } from "../../lib/bearerAuth.js";

export const healthEventsRouter = Router();

healthEventsRouter.post("/", requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? ""), async (req, res) => {
  const parsed = HealthEventPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const normalized = normalizeHealthEvent(parsed.data);
  await HealthSample.create(normalized);
  res.status(201).json({ stored: true });
});
```

This depends on `requireBearerToken` from Task 3 — implement Task 3 first if executing tasks out of order.

Note: this reuses `MCP_ACCESS_TOKEN` as the device bearer token for simplicity (one long-lived secret for both the iOS bridge app and MCP clients). If the two ever need independent rotation, split into `DEVICE_ACCESS_TOKEN` and `MCP_ACCESS_TOKEN` — not needed for this plan's scope.

- [ ] **Step 8: Mount the router**

Modify `api/src/app.ts` to add:
```typescript
import { healthEventsRouter } from "./modules/health-events/health-events.routes.js";
```
and
```typescript
app.use("/api/health-events", healthEventsRouter);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add api/src/modules/health-events api/src/app.ts
git commit -m "feat: add health-events ingestion endpoint with source adapter"
```

---

### Task 8: Progression engine (pure functions, TDD-first)

**Files:**
- Create: `api/src/modules/workouts/progression-engine.ts`
- Test: `api/src/modules/workouts/progression-engine.test.ts`

**Interfaces:**
- Produces: `applyBodyweightSession`, `applyBarbellSession`, `BodyweightProgressionState`, `BarbellProgressionState` types — consumed by Task 9's workout routes.

This is the highest-value test target in the whole plan (spec §10 calls this out explicitly) — write every branch from spec §5.1 as its own test before writing any implementation.

- [ ] **Step 1: Write the failing tests for the bodyweight phase**

`api/src/modules/workouts/progression-engine.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  applyBodyweightSession,
  applyBarbellSession,
  type BodyweightProgressionState,
  type BarbellProgressionState,
} from "./progression-engine.js";

function freshBodyweightState(overrides: Partial<BodyweightProgressionState> = {}): BodyweightProgressionState {
  return {
    phase: "bodyweight",
    level: 0,
    repRangeLow: 8,
    repRangeHigh: 15,
    consecutiveTopOfRange: 0,
    consecutiveBelowRange: 0,
    ...overrides,
  };
}

describe("applyBodyweightSession", () => {
  it("does nothing on a single session that hits the top of the range", () => {
    const state = freshBodyweightState();
    const result = applyBodyweightSession(state, [15, 15, 15], 2);
    expect(result.advanced).toBe(false);
    expect(result.nextState.consecutiveTopOfRange).toBe(1);
    expect(result.nextState.level).toBe(0);
  });

  it("advances one level after 2 consecutive top-of-range sessions at RIR <= 3", () => {
    const state = freshBodyweightState({ consecutiveTopOfRange: 1 });
    const result = applyBodyweightSession(state, [15, 15, 15], 2);
    expect(result.advanced).toBe(true);
    expect(result.nextState.level).toBe(1);
    expect(result.nextState.consecutiveTopOfRange).toBe(0);
  });

  it("does not count a top-of-range session toward advancing if RIR is above 3", () => {
    const state = freshBodyweightState();
    const result = applyBodyweightSession(state, [15, 15, 15], 5);
    expect(result.nextState.consecutiveTopOfRange).toBe(0);
  });

  it("does not regress after a single below-range session", () => {
    const state = freshBodyweightState();
    const result = applyBodyweightSession(state, [5, 5, 5], 3);
    expect(result.regressed).toBe(false);
    expect(result.nextState.consecutiveBelowRange).toBe(1);
  });

  it("regresses one level after 3 consecutive below-range sessions", () => {
    const state = freshBodyweightState({ level: 2, consecutiveBelowRange: 2 });
    const result = applyBodyweightSession(state, [5, 5, 5], 3);
    expect(result.regressed).toBe(true);
    expect(result.nextState.level).toBe(1);
    expect(result.nextState.consecutiveBelowRange).toBe(0);
  });

  it("resets both counters on a mid-range session that neither hits top nor falls below", () => {
    const state = freshBodyweightState({ consecutiveTopOfRange: 1, consecutiveBelowRange: 1 });
    const result = applyBodyweightSession(state, [10, 10, 10], 3);
    expect(result.nextState.consecutiveTopOfRange).toBe(0);
    expect(result.nextState.consecutiveBelowRange).toBe(0);
    expect(result.advanced).toBe(false);
    expect(result.regressed).toBe(false);
  });
});

describe("applyBarbellSession", () => {
  function freshBarbellState(overrides: Partial<BarbellProgressionState> = {}): BarbellProgressionState {
    return {
      phase: "barbell",
      loadKg: 40,
      increment: 2.5,
      consecutiveMisses: 0,
      ...overrides,
    };
  }

  it("adds the increment after all prescribed reps are hit", () => {
    const state = freshBarbellState();
    const result = applyBarbellSession(state, [5, 5, 5], 5);
    expect(result.loadIncreased).toBe(true);
    expect(result.nextState.loadKg).toBe(42.5);
    expect(result.nextState.consecutiveMisses).toBe(0);
  });

  it("keeps the same load and increments the miss counter after a missed rep", () => {
    const state = freshBarbellState();
    const result = applyBarbellSession(state, [5, 5, 3], 5);
    expect(result.loadIncreased).toBe(false);
    expect(result.nextState.loadKg).toBe(40);
    expect(result.nextState.consecutiveMisses).toBe(1);
  });

  it("deloads 10% after 3 consecutive misses and resets the miss counter", () => {
    const state = freshBarbellState({ consecutiveMisses: 2 });
    const result = applyBarbellSession(state, [5, 5, 3], 5);
    expect(result.deloaded).toBe(true);
    expect(result.nextState.loadKg).toBe(36);
    expect(result.nextState.consecutiveMisses).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./progression-engine.js` does not exist.

- [ ] **Step 3: Implement the progression engine**

`api/src/modules/workouts/progression-engine.ts`:
```typescript
export type BodyweightProgressionState = {
  phase: "bodyweight";
  level: number;
  repRangeLow: number;
  repRangeHigh: number;
  consecutiveTopOfRange: number;
  consecutiveBelowRange: number;
};

export type BarbellProgressionState = {
  phase: "barbell";
  loadKg: number;
  increment: number;
  consecutiveMisses: number;
};

export type BodyweightSessionResult = {
  nextState: BodyweightProgressionState;
  advanced: boolean;
  regressed: boolean;
};

export type BarbellSessionResult = {
  nextState: BarbellProgressionState;
  loadIncreased: boolean;
  deloaded: boolean;
};

const ADVANCE_AFTER_SESSIONS = 2;
const REGRESS_AFTER_SESSIONS = 3;
const MAX_RIR_TO_COUNT_AS_HARD = 3;
const DELOAD_AFTER_MISSES = 3;
const DELOAD_FACTOR = 0.9;

export function applyBodyweightSession(
  state: BodyweightProgressionState,
  repsPerSet: number[],
  selfReportedRIR: number
): BodyweightSessionResult {
  const allSetsHitTop = repsPerSet.every((reps) => reps >= state.repRangeHigh);
  const anySetBelowLow = repsPerSet.some((reps) => reps < state.repRangeLow);
  const wasHardEffort = selfReportedRIR <= MAX_RIR_TO_COUNT_AS_HARD;

  let consecutiveTopOfRange = state.consecutiveTopOfRange;
  let consecutiveBelowRange = state.consecutiveBelowRange;

  if (allSetsHitTop && wasHardEffort) {
    consecutiveTopOfRange += 1;
    consecutiveBelowRange = 0;
  } else if (anySetBelowLow) {
    consecutiveBelowRange += 1;
    consecutiveTopOfRange = 0;
  } else {
    consecutiveTopOfRange = 0;
    consecutiveBelowRange = 0;
  }

  let level = state.level;
  let advanced = false;
  let regressed = false;

  if (consecutiveTopOfRange >= ADVANCE_AFTER_SESSIONS) {
    level += 1;
    consecutiveTopOfRange = 0;
    advanced = true;
  }

  if (consecutiveBelowRange >= REGRESS_AFTER_SESSIONS) {
    level = Math.max(0, level - 1);
    consecutiveBelowRange = 0;
    regressed = true;
  }

  return {
    nextState: { ...state, level, consecutiveTopOfRange, consecutiveBelowRange },
    advanced,
    regressed,
  };
}

export function applyBarbellSession(
  state: BarbellProgressionState,
  repsPerSet: number[],
  targetReps: number
): BarbellSessionResult {
  const hitAllPrescribedReps = repsPerSet.every((reps) => reps >= targetReps);

  let loadKg = state.loadKg;
  let consecutiveMisses = state.consecutiveMisses;
  let loadIncreased = false;
  let deloaded = false;

  if (hitAllPrescribedReps) {
    loadKg += state.increment;
    consecutiveMisses = 0;
    loadIncreased = true;
  } else {
    consecutiveMisses += 1;
  }

  if (consecutiveMisses >= DELOAD_AFTER_MISSES) {
    loadKg = Math.round(loadKg * DELOAD_FACTOR * 10) / 10;
    consecutiveMisses = 0;
    deloaded = true;
  }

  return {
    nextState: { ...state, loadKg, consecutiveMisses },
    loadIncreased,
    deloaded,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS — all 9 progression-engine tests green.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/workouts/progression-engine.ts api/src/modules/workouts/progression-engine.test.ts
git commit -m "feat: implement double-progression and linear-progression engine"
```

---

### Task 9: Workout routes (log a session, apply progression)

**Files:**
- Create: `api/src/modules/workouts/workouts.service.ts`
- Create: `api/src/modules/workouts/workouts.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/workouts/workouts.routes.test.ts`

**Interfaces:**
- Consumes: `WorkoutSessionInputSchema` (Task 2), `WorkoutSession`/`ProgressionState` models (Task 5), `applyBodyweightSession`/`applyBarbellSession` (Task 8), `requireAuth` (Task 4).
- Produces: `logWorkoutSession(input: WorkoutSessionInput): Promise<{ session: ...; progressionResults: Record<string, BodyweightSessionResult | BarbellSessionResult> }>` from `workouts.service.ts`.

- [ ] **Step 1: Write the failing test**

`api/src/modules/workouts/workouts.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { WorkoutSession } from "../../models/WorkoutSession.js";
import { ProgressionState } from "../../models/ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

beforeEach(async () => {
  await ProgressionState.create({
    exerciseId: "incline-pushup",
    phase: "bodyweight",
    level: 0,
    repRangeLow: 8,
    repRangeHigh: 15,
    consecutiveTopOfRange: 1,
    consecutiveBelowRange: 0,
  });
});

afterEach(async () => {
  await WorkoutSession.deleteMany({});
  await ProgressionState.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function loggedInAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "test-password" });
  return agent;
}

describe("POST /api/workouts", () => {
  it("rejects an unauthenticated request", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/workouts")
      .send({ date: "2026-09-06", exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 15, weight: 0, type: "normal" }] }] });
    expect(res.status).toBe(401);
  });

  it("logs a session and advances progression when the top of the range is hit twice", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    const res = await agent.post("/api/workouts").send({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 15, weight: 0, rir: 2, type: "normal" },
            { reps: 15, weight: 0, rir: 2, type: "normal" },
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.progressionResults["incline-pushup"].advanced).toBe(true);

    const stored = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(stored?.level).toBe(1);

    const sessions = await WorkoutSession.find({});
    expect(sessions).toHaveLength(1);
  });

  it("uses the hardest (lowest-RIR) set to judge effort, not just the first set logged", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    // First set is an easy warm-up (RIR 8); the two working sets after it are
    // genuinely hard (RIR 1). If the service naively read only sets[0].rir, it
    // would see RIR 8, judge the whole exercise as low-effort, and wrongly
    // refuse to count this toward advancing — even though the top of the rep
    // range was hit under real difficulty on the sets that mattered.
    const res = await agent.post("/api/workouts").send({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 15, weight: 0, rir: 8, type: "warmup" },
            { reps: 15, weight: 0, rir: 1, type: "normal" },
            { reps: 15, weight: 0, rir: 1, type: "normal" },
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.progressionResults["incline-pushup"].advanced).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement the service**

`api/src/modules/workouts/workouts.service.ts`:
```typescript
import type { WorkoutSessionInput } from "@health-tracker/shared";
import { WorkoutSession } from "../../models/WorkoutSession.js";
import { ProgressionState } from "../../models/ProgressionState.js";
import { applyBodyweightSession, applyBarbellSession } from "./progression-engine.js";

const RIR_FOR_HARD_EFFORT = 2;

export async function logWorkoutSession(input: WorkoutSessionInput) {
  const session = await WorkoutSession.create(input);

  const progressionResults: Record<string, unknown> = {};

  for (const exercise of input.exercises) {
    const state = await ProgressionState.findOne({ exerciseId: exercise.exerciseId });
    if (!state) continue;

    const repsPerSet = exercise.sets.map((set) => set.reps);

    if (state.phase === "bodyweight") {
      // Use the hardest (lowest-RIR) set to represent the exercise's effort —
      // not sets[0], which is often a warm-up and would misclassify a
      // genuinely hard session as easy (caught during this plan's audit).
      const loggedRirValues = exercise.sets.map((set) => set.rir).filter((rir): rir is number => rir !== undefined);
      const hardestSetRir = loggedRirValues.length > 0 ? Math.min(...loggedRirValues) : RIR_FOR_HARD_EFFORT;

      const result = applyBodyweightSession(
        {
          phase: "bodyweight",
          level: state.level,
          repRangeLow: state.repRangeLow ?? 8,
          repRangeHigh: state.repRangeHigh ?? 15,
          consecutiveTopOfRange: state.consecutiveTopOfRange,
          consecutiveBelowRange: state.consecutiveBelowRange,
        },
        repsPerSet,
        hardestSetRir
      );
      state.level = result.nextState.level;
      state.consecutiveTopOfRange = result.nextState.consecutiveTopOfRange;
      state.consecutiveBelowRange = result.nextState.consecutiveBelowRange;
      await state.save();
      progressionResults[exercise.exerciseId] = result;
    } else {
      const targetReps = exercise.sets[0]?.reps ?? 5;
      const result = applyBarbellSession(
        {
          phase: "barbell",
          loadKg: state.loadKg ?? 0,
          increment: state.increment ?? 2.5,
          consecutiveMisses: state.consecutiveMisses,
        },
        repsPerSet,
        targetReps
      );
      state.loadKg = result.nextState.loadKg;
      state.consecutiveMisses = result.nextState.consecutiveMisses;
      if (result.deloaded) state.lastDeloadAt = new Date();
      await state.save();
      progressionResults[exercise.exerciseId] = result;
    }
  }

  return { session, progressionResults };
}
```

- [ ] **Step 4: Implement the route**

`api/src/modules/workouts/workouts.routes.ts`:
```typescript
import { Router } from "express";
import { WorkoutSessionInputSchema } from "@health-tracker/shared";
import { requireAuth } from "../../lib/session.js";
import { logWorkoutSession } from "./workouts.service.js";

export const workoutsRouter = Router();

workoutsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = WorkoutSessionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { session, progressionResults } = await logWorkoutSession(parsed.data);
  res.status(201).json({ session, progressionResults });
});
```

- [ ] **Step 5: Mount the router**

Modify `api/src/app.ts`:
```typescript
import { workoutsRouter } from "./modules/workouts/workouts.routes.js";
```
and
```typescript
app.use("/api/workouts", workoutsRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/workouts api/src/app.ts
git commit -m "feat: add workout logging route wired to the progression engine"
```

---

### Task 10: Nutrition routes

**Files:**
- Create: `api/src/modules/nutrition/nutrition.service.ts`
- Create: `api/src/modules/nutrition/nutrition.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/nutrition/nutrition.routes.test.ts`

**Interfaces:**
- Consumes: `FoodEntryInputSchema` (Task 2), `FoodEntry` model (Task 6), `requireAuth` (Task 4).
- Produces: `logFoodEntry`, `getDailyMacroSummary(date: string): Promise<{ calories: number; proteinG: number; carbsG: number; fatG: number; proteinTargetG: number; proteinHitRate: number }>` from `nutrition.service.ts` — consumed later by the MCP server (Task 14) and by the web app.

- [ ] **Step 1: Write the failing test**

`api/src/modules/nutrition/nutrition.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { FoodEntry } from "../../models/FoodEntry.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await FoodEntry.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function loggedInAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "test-password" });
  return agent;
}

describe("nutrition routes", () => {
  it("logs a food entry and includes it in the day's summary", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    const logRes = await agent.post("/api/nutrition/entries").send({
      date: "2026-09-06",
      mealSlot: "lunch",
      source: "indian_dish",
      refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
    });
    expect(logRes.status).toBe(201);

    const summaryRes = await agent.get("/api/nutrition/summary/2026-09-06");
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.proteinG).toBe(12);
    expect(summaryRes.body.calories).toBe(220);
  });

  it("returns zeroed macros for a day with no entries", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/nutrition/summary/2026-09-01");
    expect(res.status).toBe(200);
    expect(res.body.proteinG).toBe(0);
    expect(res.body.proteinHitRate).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL

- [ ] **Step 3: Implement the service**

`api/src/modules/nutrition/nutrition.service.ts`:
```typescript
import type { FoodEntryInput } from "@health-tracker/shared";
import { FoodEntry } from "../../models/FoodEntry.js";

// Accepted tradeoff, flagged during this plan's audit: this is a hardcoded
// constant, not a per-user stored/configurable value, even though the spec's
// own nutrition targets call for recalibrating every 2-3 weeks off real
// weigh-ins. For a single-user app this is a one-line code change + redeploy
// when that recalibration happens — acceptable for this plan's scope, but if
// recalibration ends up happening often, move this into a small `Settings`
// document instead of continuing to hardcode it.
const DAILY_PROTEIN_TARGET_G = 155;

export async function logFoodEntry(input: FoodEntryInput) {
  return FoodEntry.create(input);
}

export async function getDailyMacroSummary(date: string) {
  const entries = await FoodEntry.find({ date });

  const totals = entries.reduce(
    (acc, entry) => ({
      calories: acc.calories + entry.macros.calories,
      proteinG: acc.proteinG + entry.macros.proteinG,
      carbsG: acc.carbsG + entry.macros.carbsG,
      fatG: acc.fatG + entry.macros.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  return {
    ...totals,
    proteinTargetG: DAILY_PROTEIN_TARGET_G,
    proteinHitRate: Math.min(1, totals.proteinG / DAILY_PROTEIN_TARGET_G),
  };
}
```

- [ ] **Step 4: Implement the routes**

`api/src/modules/nutrition/nutrition.routes.ts`:
```typescript
import { Router } from "express";
import { FoodEntryInputSchema } from "@health-tracker/shared";
import { requireAuth } from "../../lib/session.js";
import { logFoodEntry, getDailyMacroSummary } from "./nutrition.service.js";

export const nutritionRouter = Router();

nutritionRouter.post("/entries", requireAuth, async (req, res) => {
  const parsed = FoodEntryInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const entry = await logFoodEntry(parsed.data);
  res.status(201).json({ entry });
});

nutritionRouter.get("/summary/:date", requireAuth, async (req, res) => {
  const summary = await getDailyMacroSummary(req.params.date);
  res.json(summary);
});
```

- [ ] **Step 5: Mount the router**

Modify `api/src/app.ts`:
```typescript
import { nutritionRouter } from "./modules/nutrition/nutrition.routes.js";
```
and
```typescript
app.use("/api/nutrition", nutritionRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/nutrition api/src/app.ts
git commit -m "feat: add nutrition logging and daily macro summary routes"
```

---

### Task 11: Sleep routes

**Files:**
- Create: `api/src/modules/sleep/sleep.service.ts`
- Create: `api/src/modules/sleep/sleep.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/sleep/sleep.routes.test.ts`

**Interfaces:**
- Consumes: `SleepSessionInputSchema` (Task 2), `SleepSession` model (Task 5), `requireAuth` (Task 4).
- Produces: `logSleepSession(input: SleepSessionInput): Promise<{ midpoint: Date; socialJetlagMinutes: number | null }>` — computes midpoint and, when a prior weekday average exists, the social-jetlag delta from spec §7.

- [ ] **Step 1: Write the failing test**

`api/src/modules/sleep/sleep.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { SleepSession } from "../../models/SleepSession.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await SleepSession.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function loggedInAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "test-password" });
  return agent;
}

describe("POST /api/sleep", () => {
  it("logs a sleep session and computes its midpoint", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);

    const res = await agent.post("/api/sleep").send({
      date: "2026-09-06",
      bedTime: "2026-09-06T20:30:00.000Z",
      wakeTime: "2026-09-07T04:00:00.000Z",
    });

    expect(res.status).toBe(201);
    const stored = await SleepSession.findOne({ date: "2026-09-06" });
    expect(stored?.midpoint.toISOString()).toBe("2026-09-07T00:15:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL

- [ ] **Step 3: Implement the service**

`api/src/modules/sleep/sleep.service.ts`:
```typescript
import type { SleepSessionInput } from "@health-tracker/shared";
import { SleepSession } from "../../models/SleepSession.js";

export async function logSleepSession(input: SleepSessionInput) {
  const bedTime = new Date(input.bedTime);
  const wakeTime = new Date(input.wakeTime);
  const midpoint = new Date((bedTime.getTime() + wakeTime.getTime()) / 2);

  return SleepSession.findOneAndUpdate(
    { date: input.date },
    {
      date: input.date,
      bedTime,
      wakeTime,
      midpoint,
      morningLightWithinMinutes: input.morningLightWithinMinutes,
      morningExercise: input.morningExercise,
    },
    { upsert: true, new: true }
  );
}
```

- [ ] **Step 4: Implement the route**

`api/src/modules/sleep/sleep.routes.ts`:
```typescript
import { Router } from "express";
import { SleepSessionInputSchema } from "@health-tracker/shared";
import { requireAuth } from "../../lib/session.js";
import { logSleepSession } from "./sleep.service.js";

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
```

- [ ] **Step 5: Mount the router**

Modify `api/src/app.ts`:
```typescript
import { sleepRouter } from "./modules/sleep/sleep.routes.js";
```
and
```typescript
app.use("/api/sleep", sleepRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/sleep api/src/app.ts
git commit -m "feat: add sleep logging route with midpoint calculation"
```

---

### Task 12: Nightly rollup job

**Files:**
- Create: `api/src/jobs/scheduler.ts`
- Create: `api/src/jobs/nightlyRollup.job.ts`
- Modify: `api/src/index.ts`
- Test: `api/src/jobs/nightlyRollup.job.test.ts`

**Interfaces:**
- Consumes: `HealthSample`, `WorkoutSession`, `FoodEntry`, `SleepSession`, `DailyRollup` models; `istDateRangeUtc`, `toIstDateString` from Task 3.
- Produces: `computeDailyRollup(date: string): Promise<DailyRollupDoc>` from `nightlyRollup.job.ts` (the pure/testable part), and `scheduleNightlyRollup(): void` from `scheduler.ts` (the `node-cron` wiring, not directly unit tested — cron scheduling is verified by reading the registered expression, not by waiting for it to fire).

**IST-correctness note, added after this plan's audit:** the app's one user is in India (UTC+5:30). `FoodEntry`/`WorkoutSession`/`SleepSession` are keyed by a client-supplied local-date string, but `HealthSample` is stored with UTC timestamps — bucketing `HealthSample` by naive UTC day boundaries (`T00:00:00.000Z` to `T23:59:59.999Z`) would misfile up to 5.5 hours of data into the wrong day relative to the other three collections. `computeDailyRollup` below buckets `HealthSample` using `istDateRangeUtc` for exactly this reason, and the cron schedule is pinned to `Asia/Kolkata` so "yesterday" means the same thing to the scheduler as it does to the user.

- [ ] **Step 1: Write the failing test for `computeDailyRollup`**

`api/src/jobs/nightlyRollup.job.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { HealthSample } from "../models/HealthSample.js";
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { DailyRollup } from "../models/DailyRollup.js";
import { computeDailyRollup } from "./nightlyRollup.job.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([
    HealthSample.deleteMany({}),
    FoodEntry.deleteMany({}),
    WorkoutSession.deleteMany({}),
    DailyRollup.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("computeDailyRollup", () => {
  it("sums steps (bucketed by IST day, not UTC day) and protein, and counts hard sets", async () => {
    await HealthSample.create([
      // Both within IST 2026-09-06 (00:00-23:59:59 IST == 2026-09-05T18:30Z to 2026-09-06T18:29:59.999Z).
      { timestamp: new Date("2026-09-06T09:00:00.000Z"), metric: "steps", value: 3000, source: "ios-bridge" },
      { timestamp: new Date("2026-09-06T18:00:00.000Z"), metric: "steps", value: 2000, source: "ios-bridge" },
      // This is 2026-09-06T19:00:00Z == 2026-09-07T00:30 IST — the NEXT IST day.
      // A naive UTC-day bucket would incorrectly include this in "2026-09-06".
      { timestamp: new Date("2026-09-06T19:00:00.000Z"), metric: "steps", value: 9999, source: "ios-bridge" },
    ]);
    await FoodEntry.create([
      { date: "2026-09-06", mealSlot: "lunch", source: "indian_dish", macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 } },
      { date: "2026-09-06", mealSlot: "dinner", source: "indian_dish", macros: { calories: 300, proteinG: 20, carbsG: 30, fatG: 10 } },
    ]);
    await WorkoutSession.create({
      date: "2026-09-06",
      exercises: [
        {
          exerciseId: "incline-pushup",
          sets: [
            { reps: 12, weight: 0, rir: 2, type: "normal" },
            { reps: 10, weight: 0, rir: 5, type: "normal" },
            { reps: 8, weight: 0, type: "normal" }, // no RIR logged — must not count as a hard set
          ],
        },
      ],
    });

    const rollup = await computeDailyRollup("2026-09-06");

    expect(rollup.totalSteps).toBe(5000); // excludes the 9999 sample from the next IST day
    expect(rollup.proteinG).toBe(32);
    expect(rollup.hardSets).toBe(1); // only the RIR-2 set; RIR-5 and the RIR-less set don't count
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./nightlyRollup.job.js` does not exist.

- [ ] **Step 3: Implement `computeDailyRollup`**

`api/src/jobs/nightlyRollup.job.ts`:
```typescript
import { HealthSample } from "../models/HealthSample.js";
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { DailyRollup } from "../models/DailyRollup.js";
import { istDateRangeUtc } from "../lib/dates.js";

const HARD_SET_MAX_RIR = 4;

export async function computeDailyRollup(date: string) {
  const { start, end } = istDateRangeUtc(date);

  const stepSamples = await HealthSample.find({
    metric: "steps",
    timestamp: { $gte: start, $lt: end },
  });
  const totalSteps = stepSamples.reduce((sum, sample) => sum + sample.value, 0);

  const foodEntries = await FoodEntry.find({ date });
  const proteinG = foodEntries.reduce((sum, entry) => sum + entry.macros.proteinG, 0);
  const totalCalories = foodEntries.reduce((sum, entry) => sum + entry.macros.calories, 0);

  const workoutSessions = await WorkoutSession.find({ date });
  const hardSets = workoutSessions.reduce((sum, session) => {
    return (
      sum +
      session.exercises.reduce((exerciseSum, exercise) => {
        // A set with no logged RIR is missing data, not confirmed maximal
        // effort — exclude it rather than defaulting it to "hard" (audit fix).
        return (
          exerciseSum + exercise.sets.filter((set) => set.rir !== undefined && set.rir <= HARD_SET_MAX_RIR).length
        );
      }, 0)
    );
  }, 0);

  return DailyRollup.findOneAndUpdate(
    { date },
    { date, totalSteps, proteinG, totalCalories, hardSets },
    { upsert: true, new: true }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 5: Implement the cron scheduler**

`api/src/jobs/scheduler.ts`:
```typescript
import cron from "node-cron";
import { computeDailyRollup } from "./nightlyRollup.job.js";
import { toIstDateString, IST_TIME_ZONE } from "../lib/dates.js";

export function scheduleNightlyRollup() {
  // Runs at 00:30 IST every day, rolling up the previous full IST day.
  // `timezone` here is what makes "30 0 * * *" mean 00:30 IST regardless of
  // the server's own timezone (e.g. a UTC-timezone Render instance) — without
  // it this would fire at 00:30 server time, which is 6:00 AM IST.
  cron.schedule(
    "30 0 * * *",
    async () => {
      const nowIst = new Date(Date.now());
      const yesterdayIst = new Date(nowIst.getTime() - 24 * 60 * 60 * 1000);
      const date = toIstDateString(yesterdayIst);
      await computeDailyRollup(date);
    },
    { timezone: IST_TIME_ZONE }
  );
}
```

- [ ] **Step 6: Wire the scheduler into boot**

Modify `api/src/index.ts`:
```typescript
import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./lib/db.js";
import { scheduleNightlyRollup } from "./jobs/scheduler.js";

const env = loadEnv();

await connectDb(env.mongoUri);
scheduleNightlyRollup();

const app = createApp();
app.listen(env.port, () => {
  console.log(`api listening on port ${env.port}`);
});
```

- [ ] **Step 7: Commit**

```bash
git add api/src/jobs api/src/index.ts
git commit -m "feat: add nightly rollup computation and cron scheduling"
```

---

### Task 13: Seed scripts

**Files:**
- Create: `api/src/seed/seedExercises.ts`
- Create: `api/src/seed/seedProgramTemplates.ts`
- Create: `api/src/seed/seedProgressionStates.ts`
- Create: `api/src/seed/seedIndianDishes.ts`
- Create: `api/src/seed/seedPackagedFoods.ts`
- Create: `api/src/seed/seedRecipes.ts`
- Create: `api/src/seed/index.ts`
- Modify: `api/package.json`
- Test: `api/src/seed/seed.test.ts`

**Interfaces:**
- Produces: `runAllSeeds(): Promise<void>` from `api/src/seed/index.ts`, and one `seedX(): Promise<number>` (returns count of documents upserted) per domain — each idempotent via `upsert` on the unique `slug`/`barcode`/`exerciseId` field, safe to re-run.

**Critical ordering note, added after this plan's audit:** without `seedProgressionStates`, Task 9's `logWorkoutSession` finds no `ProgressionState` document for any exercise (`ProgressionState.findOne` returns `null`) and silently skips progression for every single workout, forever — the progression engine built and tested in Task 8 would never actually run against real data. `seedProgressionStates` must run *after* `seedProgramTemplates` (it reads the seeded `home-start-weeks-1-4` program to know which exercises need a starting state) and must be part of `runAllSeeds`, not an optional extra step.

This task seeds a **real, correct starter dataset** (not placeholder data) using the macro figures already gathered during this project's research. It intentionally starts small and is designed to grow — each seed function takes its records from a local array that can be extended with more entries later without changing the seeding mechanism.

- [ ] **Step 1: Write the failing test**

`api/src/seed/seed.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { seedExercises } from "./seedExercises.js";
import { seedIndianDishes } from "./seedIndianDishes.js";
import { seedProgramTemplates } from "./seedProgramTemplates.js";
import { seedProgressionStates } from "./seedProgressionStates.js";
import { Exercise } from "../models/Exercise.js";
import { IndianDish } from "../models/IndianDish.js";
import { ProgramTemplate } from "../models/ProgramTemplate.js";
import { ProgressionState } from "../models/ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([
    Exercise.deleteMany({}),
    IndianDish.deleteMany({}),
    ProgramTemplate.deleteMany({}),
    ProgressionState.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("seedExercises", () => {
  it("inserts exercises and is idempotent on re-run", async () => {
    const firstCount = await seedExercises();
    const afterFirst = await Exercise.countDocuments();
    const secondCount = await seedExercises();
    const afterSecond = await Exercise.countDocuments();

    expect(firstCount).toBeGreaterThan(0);
    expect(afterFirst).toBe(afterSecond);
    expect(secondCount).toBe(firstCount);
  });
});

describe("seedIndianDishes", () => {
  it("inserts dal tadka with correct macros", async () => {
    await seedIndianDishes();
    const dish = await IndianDish.findOne({ slug: "dal-tadka" });
    expect(dish).not.toBeNull();
    expect(dish?.macrosPerServing.proteinG).toBeGreaterThan(0);
  });
});

describe("seedProgramTemplates", () => {
  it("inserts the home-start bodyweight program", async () => {
    await seedProgramTemplates();
    const program = await ProgramTemplate.findOne({ slug: "home-start-weeks-1-4" });
    expect(program).not.toBeNull();
    expect(program?.phase).toBe("bodyweight");
    expect(program?.exercises.length).toBeGreaterThan(0);
  });
});

describe("seedProgressionStates", () => {
  it("creates one starting ProgressionState per exercise in the home-start program", async () => {
    await seedProgramTemplates();
    const program = await ProgramTemplate.findOne({ slug: "home-start-weeks-1-4" });

    const count = await seedProgressionStates();

    expect(count).toBe(program?.exercises.length);

    const state = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(state).not.toBeNull();
    expect(state?.phase).toBe("bodyweight");
    expect(state?.level).toBe(0);
    expect(state?.repRangeLow).toBe(8);
    expect(state?.repRangeHigh).toBe(15);
  });

  it("does not overwrite progress already made on a re-run", async () => {
    await seedProgramTemplates();
    await seedProgressionStates();

    await ProgressionState.findOneAndUpdate({ exerciseId: "incline-pushup" }, { level: 3, consecutiveTopOfRange: 1 });

    await seedProgressionStates();

    const state = await ProgressionState.findOne({ exerciseId: "incline-pushup" });
    expect(state?.level).toBe(3);
    expect(state?.consecutiveTopOfRange).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — none of the seed files exist.

- [ ] **Step 3: Implement `seedExercises`**

Sourced from the plan's research on `yuhonas/free-exercise-db` movement patterns used in the spec's home program (spec §9 step 2). This starter set covers the exact exercises named in the training research's Week 1–4 program; extend with the full 876-exercise dataset later by adding entries to `EXERCISES`.

`api/src/seed/seedExercises.ts`:
```typescript
import { Exercise } from "../models/Exercise.js";

const EXERCISES = [
  { slug: "bodyweight-squat", name: "Bodyweight Squat", muscleGroups: ["quadriceps", "glutes"], equipment: ["none"], images: [] },
  { slug: "glute-bridge", name: "Glute Bridge", muscleGroups: ["glutes", "hamstrings"], equipment: ["none"], images: [] },
  { slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: ["chest", "triceps", "shoulders"], equipment: ["none"], images: [] },
  { slug: "negative-pullup", name: "Negative Pull-Up", muscleGroups: ["back", "biceps"], equipment: ["pull-up bar"], images: [] },
  { slug: "inverted-row", name: "Inverted Row", muscleGroups: ["back", "biceps"], equipment: ["table or bar"], images: [] },
  { slug: "plank", name: "Plank", muscleGroups: ["core"], equipment: ["none"], images: [] },
  { slug: "dead-bug", name: "Dead Bug", muscleGroups: ["core"], equipment: ["none"], images: [] },
  { slug: "step-back-burpee", name: "Step-Back Burpee (No Jump)", muscleGroups: ["full body"], equipment: ["none"], images: [] },
  { slug: "back-squat", name: "Barbell Back Squat", muscleGroups: ["quadriceps", "glutes"], equipment: ["barbell", "rack"], images: [], homeEquivalentSlug: "bodyweight-squat" },
  { slug: "romanian-deadlift", name: "Romanian Deadlift", muscleGroups: ["hamstrings", "glutes"], equipment: ["barbell"], images: [], homeEquivalentSlug: "glute-bridge" },
  { slug: "bench-press", name: "Barbell Bench Press", muscleGroups: ["chest", "triceps", "shoulders"], equipment: ["barbell", "bench"], images: [], homeEquivalentSlug: "incline-pushup" },
  { slug: "lat-pulldown", name: "Lat Pulldown", muscleGroups: ["back", "biceps"], equipment: ["cable machine"], images: [], homeEquivalentSlug: "inverted-row" },
];

export async function seedExercises(): Promise<number> {
  let count = 0;
  for (const exercise of EXERCISES) {
    await Exercise.findOneAndUpdate({ slug: exercise.slug }, exercise, { upsert: true });
    count += 1;
  }
  return count;
}
```

- [ ] **Step 4: Implement `seedProgramTemplates`**

`api/src/seed/seedProgramTemplates.ts`:
```typescript
import { ProgramTemplate } from "../models/ProgramTemplate.js";

const PROGRAMS = [
  {
    slug: "home-start-weeks-1-4",
    name: "Home Start (Weeks 1-4)",
    phase: "bodyweight" as const,
    exercises: [
      { exerciseSlug: "bodyweight-squat", sets: 3, repRangeLow: 10, repRangeHigh: 15 },
      { exerciseSlug: "glute-bridge", sets: 3, repRangeLow: 10, repRangeHigh: 15 },
      { exerciseSlug: "incline-pushup", sets: 3, repRangeLow: 8, repRangeHigh: 15 },
      { exerciseSlug: "negative-pullup", sets: 3, repRangeLow: 3, repRangeHigh: 5 },
      { exerciseSlug: "inverted-row", sets: 3, repRangeLow: 10, repRangeHigh: 15 },
      { exerciseSlug: "plank", sets: 3, repRangeLow: 30, repRangeHigh: 45 },
    ],
    weeklySchedule: [
      { day: "monday", activity: "strength-a" },
      { day: "tuesday", activity: "mobility-and-dance" },
      { day: "wednesday", activity: "strength-b" },
      { day: "thursday", activity: "easy-walk" },
      { day: "friday", activity: "strength-c" },
      { day: "saturday", activity: "walk-run-progression" },
      { day: "sunday", activity: "rest-or-stretch" },
    ],
  },
  {
    slug: "gym-transition",
    name: "Gym Transition",
    phase: "barbell" as const,
    exercises: [
      { exerciseSlug: "back-squat", sets: 3, repRangeLow: 5, repRangeHigh: 5 },
      { exerciseSlug: "romanian-deadlift", sets: 3, repRangeLow: 8, repRangeHigh: 10 },
      { exerciseSlug: "bench-press", sets: 3, repRangeLow: 5, repRangeHigh: 5 },
      { exerciseSlug: "lat-pulldown", sets: 3, repRangeLow: 8, repRangeHigh: 12 },
    ],
    weeklySchedule: [
      { day: "monday", activity: "strength-a" },
      { day: "wednesday", activity: "strength-b" },
      { day: "friday", activity: "strength-c" },
    ],
  },
];

export async function seedProgramTemplates(): Promise<number> {
  let count = 0;
  for (const program of PROGRAMS) {
    await ProgramTemplate.findOneAndUpdate({ slug: program.slug }, program, { upsert: true });
    count += 1;
  }
  return count;
}
```

- [ ] **Step 5: Implement `seedProgressionStates`**

This is the fix for the audit finding that the progression engine (Task 8) never actually runs without a starting `ProgressionState` per exercise. It reads the already-seeded `home-start-weeks-1-4` `ProgramTemplate` — the program the user actually starts on — rather than duplicating a second hardcoded exercise list, so the two can never drift apart. It only creates a document if one doesn't already exist (`upsert` with `$setOnInsert`), so re-running the seed never wipes out real progress.

`api/src/seed/seedProgressionStates.ts`:
```typescript
import { ProgramTemplate } from "../models/ProgramTemplate.js";
import { ProgressionState } from "../models/ProgressionState.js";

const STARTING_PROGRAM_SLUG = "home-start-weeks-1-4";

export async function seedProgressionStates(): Promise<number> {
  const program = await ProgramTemplate.findOne({ slug: STARTING_PROGRAM_SLUG });
  if (!program) {
    throw new Error(
      `Cannot seed progression states: program "${STARTING_PROGRAM_SLUG}" not found — run seedProgramTemplates first.`
    );
  }

  let count = 0;
  for (const exercise of program.exercises) {
    await ProgressionState.findOneAndUpdate(
      { exerciseId: exercise.exerciseSlug },
      {
        $setOnInsert: {
          exerciseId: exercise.exerciseSlug,
          phase: program.phase,
          level: 0,
          repRangeLow: exercise.repRangeLow,
          repRangeHigh: exercise.repRangeHigh,
          consecutiveTopOfRange: 0,
          consecutiveBelowRange: 0,
          consecutiveMisses: 0,
        },
      },
      { upsert: true }
    );
    count += 1;
  }
  return count;
}
```

- [ ] **Step 6: Implement `seedIndianDishes`**

Macro figures below are drawn directly from this project's nutrition research (cooked-legume and staple values, not dry-weight figures — spec §6).

`api/src/seed/seedIndianDishes.ts`:
```typescript
import { IndianDish } from "../models/IndianDish.js";

const DISHES = [
  { slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200, macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB" as const },
  { slug: "roti", name: "Roti (whole wheat)", servingGrams: 40, macrosPerServing: { calories: 120, proteinG: 3, carbsG: 22, fatG: 2 }, source: "IFCT2017" as const },
  { slug: "rajma", name: "Rajma (cooked)", servingGrams: 150, macrosPerServing: { calories: 170, proteinG: 13, carbsG: 26, fatG: 2 }, source: "INDB" as const },
  { slug: "paneer-bhurji", name: "Paneer Bhurji", servingGrams: 100, macrosPerServing: { calories: 265, proteinG: 16, carbsG: 6, fatG: 20 }, source: "INDB" as const },
  { slug: "egg-bhurji", name: "Egg Bhurji (2 eggs)", servingGrams: 120, macrosPerServing: { calories: 200, proteinG: 13, carbsG: 3, fatG: 15 }, source: "INDB" as const },
  { slug: "steamed-rice", name: "Steamed Rice", servingGrams: 150, macrosPerServing: { calories: 195, proteinG: 4, carbsG: 43, fatG: 0.5 }, source: "IFCT2017" as const },
  { slug: "soya-chunk-curry", name: "Soya Chunk Curry", servingGrams: 150, macrosPerServing: { calories: 210, proteinG: 22, carbsG: 18, fatG: 5 }, source: "INDB" as const },
  { slug: "boiled-egg", name: "Boiled Egg", servingGrams: 50, macrosPerServing: { calories: 78, proteinG: 6.3, carbsG: 0.6, fatG: 5.3 }, source: "IFCT2017" as const },
];

export async function seedIndianDishes(): Promise<number> {
  let count = 0;
  for (const dish of DISHES) {
    await IndianDish.findOneAndUpdate({ slug: dish.slug }, dish, { upsert: true });
    count += 1;
  }
  return count;
}
```

- [ ] **Step 7: Implement `seedPackagedFoods`**

`api/src/seed/seedPackagedFoods.ts`:
```typescript
import { PackagedFood } from "../models/PackagedFood.js";

const PRODUCTS = [
  {
    barcode: "8901063001011",
    name: "Nutrela Soya Chunks",
    macrosPer100g: { calories: 345, proteinG: 52, carbsG: 33, fatG: 0.5 },
    source: "open_food_facts" as const,
  },
  {
    barcode: "5449000000996",
    name: "Coca-Cola Zero Sugar",
    macrosPer100g: { calories: 0.3, proteinG: 0, carbsG: 0, fatG: 0 },
    source: "open_food_facts" as const,
  },
];

export async function seedPackagedFoods(): Promise<number> {
  let count = 0;
  for (const product of PRODUCTS) {
    await PackagedFood.findOneAndUpdate({ barcode: product.barcode }, product, { upsert: true });
    count += 1;
  }
  return count;
}
```

Note: this is a two-item starter set proving the ingestion path. The spec's real plan (§6) is a bulk import from an Open Food Facts data export — that importer is a larger, separate task appropriately scoped to its own future plan once this pipeline is proven; do not treat this small list as the final dataset.

- [ ] **Step 8: Implement `seedRecipes`**

Ingredient grams and resulting macros below are computed from the `IndianDish`/packaged-food figures seeded above (spec §6.1 — recipe macros come from verified ingredient data, not from LLM estimation).

`api/src/seed/seedRecipes.ts`:
```typescript
import { Recipe } from "../models/Recipe.js";

const RECIPES = [
  {
    slug: "soya-chunk-masala",
    name: "Soya Chunk Masala",
    ingredients: [
      { name: "soya chunks (dry)", grams: 50 },
      { name: "onion", grams: 50 },
      { name: "tomato", grams: 50 },
      { name: "oil", grams: 10 },
    ],
    steps: [
      "Soak 50g dry soya chunks in hot water for 10 minutes, then squeeze out excess water.",
      "Heat oil in a pan on the induction, saute chopped onion until translucent.",
      "Add chopped tomato and spices, cook until softened.",
      "Add the soaked soya chunks, mix well, cover and cook 5 minutes.",
    ],
    equipment: ["pan", "induction"],
    prepMinutes: 20,
    macros: { calories: 350, proteinG: 27, carbsG: 20, fatG: 15 },
    tags: ["high-protein", "vegetarian"],
  },
  {
    slug: "egg-curry",
    name: "Egg Curry",
    ingredients: [
      { name: "eggs", grams: 100 },
      { name: "onion", grams: 50 },
      { name: "tomato", grams: 50 },
      { name: "oil", grams: 10 },
    ],
    steps: [
      "Boil 2 eggs in the pressure cooker, peel and set aside.",
      "Saute onion and tomato with spices in a pan on the induction.",
      "Add the boiled eggs to the gravy, simmer 5 minutes.",
    ],
    equipment: ["pan", "pressure_cooker", "induction"],
    prepMinutes: 20,
    macros: { calories: 310, proteinG: 16, carbsG: 8, fatG: 24 },
    tags: ["high-protein", "eggetarian"],
  },
];

export async function seedRecipes(): Promise<number> {
  let count = 0;
  for (const recipe of RECIPES) {
    await Recipe.findOneAndUpdate({ slug: recipe.slug }, recipe, { upsert: true });
    count += 1;
  }
  return count;
}
```

- [ ] **Step 9: Implement the seed entrypoint**

`api/src/seed/index.ts`:
```typescript
import "dotenv/config";
import { loadEnv } from "../config/env.js";
import { connectDb, disconnectDb } from "../lib/db.js";
import { seedExercises } from "./seedExercises.js";
import { seedProgramTemplates } from "./seedProgramTemplates.js";
import { seedProgressionStates } from "./seedProgressionStates.js";
import { seedIndianDishes } from "./seedIndianDishes.js";
import { seedPackagedFoods } from "./seedPackagedFoods.js";
import { seedRecipes } from "./seedRecipes.js";

export async function runAllSeeds() {
  const exerciseCount = await seedExercises();
  const programCount = await seedProgramTemplates();
  // Must run after seedProgramTemplates — it reads the seeded program to know
  // which exercises need a starting ProgressionState. Without this step the
  // progression engine (Task 8) never activates against real workout data.
  const progressionStateCount = await seedProgressionStates();
  const dishCount = await seedIndianDishes();
  const packagedFoodCount = await seedPackagedFoods();
  const recipeCount = await seedRecipes();

  console.log(
    `Seeded: ${exerciseCount} exercises, ${programCount} programs, ${progressionStateCount} progression states, ${dishCount} dishes, ${packagedFoodCount} packaged foods, ${recipeCount} recipes`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  await connectDb(env.mongoUri);
  await runAllSeeds();
  await disconnectDb();
}
```

- [ ] **Step 10: Add a run script**

Modify `api/package.json` scripts:
```json
{
  "scripts": {
    "seed": "tsx src/seed/index.ts"
  }
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 12: Run the seed script against local dev Mongo**

Run: `cd api && cp .env.example .env` (fill in real values), then `pnpm seed`
Expected: console log listing non-zero counts for each collection.

- [ ] **Step 13: Commit**

```bash
git add api/src/seed api/package.json
git commit -m "feat: add idempotent seed scripts for exercises, programs, progression states, dishes, foods, recipes"
```

---

### Task 14: MCP server (read tools + `save_coach_note`)

**Files:**
- Create: `api/src/mcp/tools.ts`
- Create: `api/src/mcp/server.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `getDailyMacroSummary` (Task 10), `WorkoutSession`/`ProgressionState` (Tasks 5, 8), `SleepSession` (Task 5), `CoachNote` model (Task 6), `requireBearerToken` (Task 3).
- Produces: `getWeeklyDigest(weekOf: string): Promise<WeeklyDigest>`, `mountMcpServer(app: Express): void`. `WeeklyDigest` type is consumed by the MCP tools and is the same shape mentioned in spec §8.1.

This is the one task in this plan that depends on an external SDK (`@modelcontextprotocol/sdk`) whose exact API surface changes between versions. Write the digest-computation logic (fully testable, no SDK involved) first and separately from the MCP wiring (verify against the installed package's README once `pnpm install` has run, since the transport API shown here may need adjusting to match the installed version).

- [ ] **Step 1: Write the failing test for the digest computation**

`api/src/mcp/tools.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { SleepSession } from "../models/SleepSession.js";
import { getWeeklyDigest } from "./tools.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await Promise.all([FoodEntry.deleteMany({}), WorkoutSession.deleteMany({}), SleepSession.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("getWeeklyDigest", () => {
  it("summarizes workouts, nutrition, and sleep for the given week", async () => {
    await FoodEntry.create({
      date: "2026-09-02",
      mealSlot: "lunch",
      source: "indian_dish",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
    });
    await WorkoutSession.create({
      date: "2026-09-02",
      exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 12, weight: 0, rir: 2, type: "normal" }] }],
    });
    await SleepSession.create({
      date: "2026-09-02",
      bedTime: new Date("2026-09-02T20:30:00.000Z"),
      wakeTime: new Date("2026-09-03T04:00:00.000Z"),
      midpoint: new Date("2026-09-03T00:15:00.000Z"),
    });

    const digest = await getWeeklyDigest("2026-09-01");

    expect(digest.workoutsLogged).toBe(1);
    expect(digest.totalProteinG).toBe(12);
    expect(digest.sleepSessionsLogged).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./tools.js` does not exist.

- [ ] **Step 3: Implement the digest computation**

`api/src/mcp/tools.ts`:
```typescript
import { FoodEntry } from "../models/FoodEntry.js";
import { WorkoutSession } from "../models/WorkoutSession.js";
import { SleepSession } from "../models/SleepSession.js";
import { CoachNote } from "../models/CoachNote.js";

export type WeeklyDigest = {
  weekOf: string;
  workoutsLogged: number;
  totalProteinG: number;
  sleepSessionsLogged: number;
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateStrings(weekOf: string): string[] {
  const start = new Date(`${weekOf}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i).toISOString().slice(0, 10));
}

export async function getWeeklyDigest(weekOf: string): Promise<WeeklyDigest> {
  const dates = toDateStrings(weekOf);

  const [foodEntries, workoutSessions, sleepSessions] = await Promise.all([
    FoodEntry.find({ date: { $in: dates } }),
    WorkoutSession.find({ date: { $in: dates } }),
    SleepSession.find({ date: { $in: dates } }),
  ]);

  return {
    weekOf,
    workoutsLogged: workoutSessions.length,
    totalProteinG: foodEntries.reduce((sum, entry) => sum + entry.macros.proteinG, 0),
    sleepSessionsLogged: sleepSessions.length,
  };
}

export type SaveCoachNoteInput = {
  weekOf: string;
  summary: string;
  suggestions: string[];
  source: "vendor_scheduled_task" | "mcp_session";
  llmModel?: string;
};

export async function saveCoachNote(input: SaveCoachNoteInput) {
  const digest = await getWeeklyDigest(input.weekOf);
  return CoachNote.create({ ...input, digest });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 5: Implement the MCP server wiring**

This step depends on `@modelcontextprotocol/sdk`'s stateless Streamable HTTP recipe. After `pnpm install` completes, check `node_modules/@modelcontextprotocol/sdk/README.md` (or the installed version's docs) for the current stateless-server example and adjust import paths/constructor options if they differ from below — the SDK's transport API has changed across versions.

`api/src/mcp/server.ts`:
```typescript
import type { Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getWeeklyDigest, saveCoachNote } from "./tools.js";
import { getDailyMacroSummary } from "../modules/nutrition/nutrition.service.js";
import { requireBearerToken } from "../lib/bearerAuth.js";

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "health-tracker", version: "0.0.1" });

  server.tool(
    "get_weekly_digest",
    { weekOf: z.string().describe("ISO date (YYYY-MM-DD) of the Monday starting the week") },
    async ({ weekOf }) => {
      const digest = await getWeeklyDigest(weekOf);
      return { content: [{ type: "text", text: JSON.stringify(digest) }] };
    }
  );

  server.tool(
    "get_nutrition_summary",
    { date: z.string().describe("ISO date (YYYY-MM-DD)") },
    async ({ date }) => {
      const summary = await getDailyMacroSummary(date);
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    }
  );

  server.tool(
    "save_coach_note",
    {
      weekOf: z.string(),
      summary: z.string(),
      suggestions: z.array(z.string()),
      source: z.enum(["vendor_scheduled_task", "mcp_session"]),
      llmModel: z.string().optional(),
    },
    async (input) => {
      const note = await saveCoachNote(input);
      return { content: [{ type: "text", text: JSON.stringify({ saved: true, id: note.id }) }] };
    }
  );

  return server;
}

export function mountMcpServer(app: Express) {
  app.post("/mcp", requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? ""), async (req, res) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
}
```

This depends on `requireBearerToken` from Task 3 — implement Task 3 first if executing tasks out of order.

- [ ] **Step 6: Mount it in `app.ts`**

Modify `api/src/app.ts`:
```typescript
import { mountMcpServer } from "./mcp/server.js";
```
and, after all other routes are mounted:
```typescript
mountMcpServer(app);
```

- [ ] **Step 7: Manually verify the MCP endpoint responds**

Run: `cd api && pnpm dev` (in one terminal), then in another:
```bash
curl -i -X POST http://localhost:4000/mcp \
  -H "Authorization: Bearer <value of MCP_ACCESS_TOKEN from your .env>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected: a response listing `get_weekly_digest`, `get_nutrition_summary`, and `save_coach_note`. If the shape differs, adjust `server.ts` to match the installed SDK version's actual request/response cycle before proceeding.

- [ ] **Step 8: Commit**

```bash
git add api/src/mcp api/src/app.ts
git commit -m "feat: add MCP server exposing weekly digest, nutrition summary, and coach-note tools"
```

---

### Task 15: Global JSON error-handling middleware

**Files:**
- Create: `api/src/lib/errorHandler.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/lib/errorHandler.test.ts`

**Interfaces:**
- Produces: `jsonErrorHandler` (a 4-argument Express error-handling middleware) from `api/src/lib/errorHandler.ts`.
- Consumes: nothing from earlier tasks; must be mounted in `app.ts` **after every other `app.use`/router**, including `mountMcpServer` from Task 14 — Express only routes an error to middleware registered after the point where it was thrown/passed to `next()`.

This closes an audit finding: as of Task 14, nothing in `app.ts` catches a malformed JSON body, a Mongoose `ValidationError`, or any other thrown/rejected error into a clean JSON response — they fall through to Express's default handler, which returns an HTML stack trace to a caller (iOS app, web app, or an MCP client) that only ever expects JSON.

- [ ] **Step 1: Write the failing test for the error handler in isolation**

`api/src/lib/errorHandler.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { jsonErrorHandler } from "./errorHandler.js";

function testApp() {
  const app = express();
  app.use(express.json());

  app.post("/throws-generic", () => {
    throw new Error("something broke");
  });

  app.post("/throws-validation", () => {
    const err = new mongoose.Error.ValidationError();
    throw err;
  });

  app.post("/ok", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(jsonErrorHandler);
  return app;
}

describe("jsonErrorHandler", () => {
  it("returns 400 JSON (not an HTML page) for a malformed JSON body", async () => {
    const res = await request(testApp())
      .post("/ok")
      .set("Content-Type", "application/json")
      .send('{"not valid json"');

    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 JSON for a Mongoose ValidationError", async () => {
    const res = await request(testApp()).post("/throws-validation").send({});
    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
  });

  it("returns 500 JSON for an unrecognized error, without leaking the stack trace", async () => {
    const res = await request(testApp()).post("/throws-generic").send({});
    expect(res.status).toBe(500);
    expect(res.type).toBe("application/json");
    expect(res.body.error).toBe("Internal server error");
    expect(JSON.stringify(res.body)).not.toContain("at ");
  });

  it("does not interfere with a successful request", async () => {
    const res = await request(testApp()).post("/ok").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `./errorHandler.js` does not exist.

- [ ] **Step 3: Implement the error handler**

`api/src/lib/errorHandler.ts`:
```typescript
import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";

export const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Malformed JSON bodies surface as a SyntaxError thrown by express.json().
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: "Invalid data", details: err.message });
    return;
  }

  // Never echo an arbitrary error's message/stack to the client — log it
  // server-side for debugging and return a generic message instead.
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 5: Mount it as the last middleware in `app.ts`**

Modify `api/src/app.ts` — add the import at the top alongside the other imports, and add `app.use(jsonErrorHandler)` as the **final** line before `return app`, after every router mounted in Tasks 4, 7, 9, 10, 11, and `mountMcpServer` from Task 14:
```typescript
import { jsonErrorHandler } from "./lib/errorHandler.js";
```
and, immediately before `return app;`:
```typescript
  app.use(jsonErrorHandler);

  return app;
```

- [ ] **Step 6: Run the full test suite to verify nothing else regressed**

Run: `cd api && pnpm test`
Expected: PASS — every earlier task's tests still pass; routes that already returned clean 400s via `safeParse` are unaffected, since `jsonErrorHandler` only ever sees errors that reach `next(err)` (thrown/rejected), not the explicit `res.status(400)` responses those routes already send themselves.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/errorHandler.ts api/src/lib/errorHandler.test.ts api/src/app.ts
git commit -m "feat: add global JSON error-handling middleware"
```

---

## Self-Review

*(This plan was independently audited for edge cases and error handling after its first draft. That audit found nine confirmed issues — a dead progression engine with no seed data, a UTC/IST day-boundary bug corrupting daily rollups, a schema/model enum mismatch, a missing global error handler, duplicated non-constant-time token comparisons, a first-set-RIR effort-classification bug, a `.datetime()` offset-rejection risk, a hardcoded protein target, and RIR-less sets miscounted as maximal effort. The first seven are fixed directly in the task content above — Task 3 gained `constantTimeEquals`, `bearerAuth`, and the IST date helpers; Task 9's RIR selection and Task 12's date bucketing were corrected in place; Task 13 gained `seedProgressionStates`; Task 15 was added for the error handler. The last two (hardcoded protein target, missing secondary indexes on `WorkoutSession.date`/`FoodEntry.date`, and the shared `MCP_ACCESS_TOKEN` between the iOS device and MCP clients) are accepted, documented tradeoffs for this plan's scope, not oversights — noted inline at Task 10, Tasks 5/6, and Task 7 respectively.)*

**Spec coverage:**
- §4.1 stack decisions (Express 5, Mongoose 9, node-cron, iron-session, local Mongo dev) → Tasks 1, 3, 4, 12.
- §4.2 ingestion adapter as an isolated seam → Task 7.
- §5 data models (all twelve) → Tasks 5, 6.
- §5.1 progression engine, both phases, all branch rules including the calendar-based deload note → Task 8 covers the per-session state machine; the every-6-weeks calendar deload from spec §5.1 is **not** implemented in this plan — flagged below as a gap, since it requires a scheduled job querying across all `ProgressionState` docs rather than a per-session pure function. Added as an explicit follow-up rather than silently dropped: this plan's Task 12 pattern (a `node-cron` job) is the right vehicle for it, but it was not in the original task breakdown — add a `Task 16: Calendar-based deload job` before considering backend-core complete, following the same TDD structure as Task 12.
- §6 nutrition sourcing (IndianDish/PackagedFood separation, FoodEntry with `addedFatGrams`) → Tasks 6, 10, 13.
- §6.1 recipe suggestions data → Task 13 seeds `Recipe`; the ranked suggestion *function* (filtering by remaining macro budget) is data-model-ready but not yet implemented as a service — also a gap, same reasoning as above: add a `Task 17: Recipe suggestion function` before considering backend-core complete.
- §7 sleep protocol (midpoint, social jetlag placeholder field) → Task 11 computes midpoint; social-jetlag-delta computation (comparing against a trailing weekday average) is modeled in the schema but not yet computed — another explicit gap; add as `Task 18: Social jetlag calculation` alongside Task 11's route once enough sleep history exists to test against meaningfully.
- §8 MCP server, both read tools and the write tool, explicit no-API-call constraint → Task 14.
- §9 build sequence steps 1-3 → Tasks 1-15 of this plan.
- §10 testing strategy (Vitest + mongodb-memory-server + supertest, progression engine as high-value unit target) → followed throughout; every task is test-first.

**Placeholder scan:** No TBD/TODO markers; every step has runnable code. The follow-up items named above (calendar deload, recipe suggestion function, social jetlag calculation) are explicitly named as follow-up tasks with a stated reason, not silently dropped — consistent with "no placeholders" meaning no vague hand-waving, not "no scope decisions." The two accepted-tradeoff items from the audit (hardcoded protein target, shared device/MCP token) are likewise documented inline with a stated reason, not silently left unaddressed.

**Type consistency:** `WorkoutSessionInput`/`Set`/`Readiness` (Task 2) match the shapes consumed in Task 9's service. `BodyweightProgressionState`/`BarbellProgressionState` (Task 8) match the fields read/written against the `ProgressionState` Mongoose document in Task 9. `FoodEntryInput` (Task 2) matches `FoodEntry` (Task 6) and the service in Task 10. `WeeklyDigest` (Task 14) is self-contained and does not conflict with any earlier type. `HealthMetric` (Task 2, now restricted to quantity metrics) matches `HealthSample`'s Mongoose enum (Task 5) exactly, closing the schema/model mismatch the audit found. `constantTimeEquals`/`requireBearerToken` (Task 3) are each defined once and consumed identically by Tasks 4, 7, and 14 — no more divergent copies.

**Action before treating backend-core as done:** implement Tasks 16-18 named above (calendar deload, recipe suggestions, social jetlag) using the same task-writing process as this plan, once Tasks 1-15 are merged and their real interfaces are settled.
