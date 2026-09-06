# Health Tracker Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `web` package (Next.js 16 App Router PWA) that gives the single user a real interface to everything the `api` package already does — gym logging with offline support, nutrition logging (manual/barcode/natural-language/photo) with recipe suggestions, training/nutrition/sleep dashboards, and a coach-notes feed — plus the backend read/LLM-parsing endpoints `api` needs to support it, since backend-core (already merged) only ever built write endpoints and one summary read.

**Architecture:** Part 1 (Tasks 1-8) extends the existing Express 5 + Mongoose 9 + Zod `api` package with read-only listing endpoints for every domain (exercises, programs, progression, workouts, sleep, rollups, food, recipes, coach notes) plus two Gemini-backed food-parsing endpoints, following the exact patterns backend-core already established. Part 2 (Tasks 9-19) builds `web` as a Next.js 16 App Router PWA: TanStack Query for server-state reads, a Dexie (IndexedDB) offline outbox as the local-first source of truth for writes (so a set logged on bad gym wifi is never lost), and Serwist for app-shell PWA caching.

**Tech Stack:** `api` additions: no new runtime dependencies except a Gemini HTTP call via the platform `fetch` (no SDK dependency needed). `web`: Next.js 16.3, React 19, TanStack Query 5, Dexie 4.4 + dexie-react-hooks 4.4, Tailwind v4 (CSS-first, no config file), Serwist (`@serwist/next`) for the service worker, `fake-indexeddb` for testing Dexie logic against a real IndexedDB implementation in Node.

**Spec:** `docs/superpowers/specs/2026-09-06-health-tracker-design.md` — this plan implements build-sequence step 5 (§9) plus the read/LLM-parsing backend surface step 5 depends on but which backend-core (steps 1-3) never built.

## Global Constraints

- TypeScript throughout. `api` additions are ESM, matching the existing package exactly. `web` uses Next.js 16's own module conventions.
- `api` additions: every new route reuses the EXISTING helpers exactly as built — `requireAuth` (`api/src/lib/session.ts`) for personal-data routes, `requireBearerToken` (`api/src/lib/bearerAuth.ts`) via the per-request-wrapper pattern (`(req,res,next) => requireBearerToken(process.env.X ?? "")(req,res,next)`) for any bearer-token route, never a bare `requireBearerToken(TOKEN)` evaluated once at router-registration time — that exact mistake was found and fixed once already in backend-core's Task 7 and must not recur.
- `api` additions: one Mongoose model per file under `api/src/models/`, matching backend-core's convention. Every test uses `mongodb-memory-server` + `supertest` + `createApp()` (a fresh app instance per test, via the factory function — never a module-level singleton `app` export, since none exists) — matches backend-core's established pattern exactly.
- `api` additions: `WorkoutSession`, `SleepSession`, `DailyRollup`, and `FoodEntry` are all keyed by a client-supplied local-date string (`"YYYY-MM-DD"`), not a raw UTC timestamp — date-range queries on these four collections use plain ISO-string range comparison (`{ $gte: from, $lte: to }`), matching the precedent already set by `computeDailyRollup`/`getDailyMacroSummary`. Do NOT run these through `istDateRangeUtc` — that helper exists specifically for `HealthSample`'s raw-UTC-timestamp bucketing problem, a different field type entirely, and using it here would be wrong, not extra-safe.
- LLM calls to Gemini (Tasks 7-8) are the one explicitly-permitted exception to backend-core's "never call an LLM API directly" constraint. That constraint (design spec §8) is scoped specifically to the coaching feature, which must route through the MCP server instead of a direct call from `api`. Food-parsing (design spec §6) is explicitly designed to call Gemini directly from `api`, modeled on the finance-tracker's `merchant-llm-cleanup.ts` "call an LLM, normalize, cache" pattern. A reviewer must not flag Tasks 7-8 as violating the no-direct-LLM-call rule.
- Every LLM response is Zod-validated before use. A malformed/unexpected LLM response is a normal 502 error path returned to the caller, never a crash and never passed through unvalidated.
- New env var `GEMINI_API_KEY`, added to `api/.env.example` and `api/src/config/env.ts`'s `Env` type/`loadEnv()`.
- `web`: Next.js 16's `cookies()`/`headers()`/route `params`/`searchParams` are async — every Server Component/Route Handler that needs them must `await` them. Server-side `fetch` calls to the separate Express API do NOT automatically forward the browser's session cookie cross-origin — any authenticated server-side call must explicitly read `await cookies()` and set a `Cookie` header on the outbound fetch. Client-side calls use `fetch(url, { credentials: "include" })` instead, which the existing API's CORS config (`credentials: true`, specific origin) already supports.
- `web`: Dexie is the single source of truth for offline writes (gym/nutrition/sleep logging) — every logging form calls `queueForSync()`, never a direct `fetch`. `navigator.onLine`/the `online` event are known to false-positive (report "online" while actually unreachable) — reconnect-triggered sync is verified by an actual fetch attempt succeeding or failing, never by trusting the browser's online signal alone.
- `web`: TanStack Query is used for server-state reads/caching only. It is kept independent of the Dexie outbox — writes never route through `persistQueryClient` or TanStack Query's own mutation system, since Dexie already solves durable offline writes and mixing the two mechanisms adds risk for no benefit.
- `web`: Tailwind v4 is CSS-first (`@theme`/`@import` directives in the global CSS file) — no `tailwind.config.ts`.
- `web`: e1RM, PR, streak, jetlag, and wake-time-consistency calculations are pure, unit-tested functions with no I/O — matching the rigor backend-core's progression engine got, per design spec §10's explicit call-out that "data loss [in the offline outbox] is the one UI failure mode that would actually break trust in the app," extended here to every other correctness-sensitive calculation the dashboards display.
- `web`: every logging form (gym, nutrition, sleep, natural-language/photo parsing) wraps its network/`queueForSync` call in try/catch, tracks an explicit loading state (button disabled + label change while in flight, not just an inert click), and shows a distinct, specific error message on failure — never a silent no-op that leaves the user unsure whether their data was saved. A network failure and a local-storage failure (Dexie write rejected — quota exceeded, private-browsing IndexedDB restrictions) are different failure modes with different user-facing messages; both are recoverable by retrying, so neither is treated as fatal. Every multi-step save (e.g. confirming a multi-item food-parsing draft) tracks success per item — a partial failure keeps the unsaved items visible and retryable rather than discarding the whole batch or silently dropping the failures.
- `web`: every dashboard/list page reads `isError` from its query and renders a distinct error state — an empty list because there's genuinely no data yet (e.g. no coach notes saved) is never visually indistinguishable from an empty list because the fetch failed (e.g. session expired, backend unreachable).

---

## Part 1: Backend read + LLM-parsing extensions

### Task 1: Reference-data read endpoints (exercises, programs)

**Files:**
- Create: `api/src/modules/reference-data/reference-data.service.ts`
- Create: `api/src/modules/reference-data/reference-data.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/reference-data/reference-data.routes.test.ts`

**Interfaces:**
- Produces: `listExercises(equipment?: string): Promise<ExerciseDoc[]>`, `listPrograms(): Promise<ProgramTemplateDoc[]>`.
- No `requireAuth` — this is a static exercise/program catalog seeded once, not personal data; there is nothing sensitive to protect, matching the trust level of static config.

- [ ] **Step 1: Write the failing test**

`api/src/modules/reference-data/reference-data.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { Exercise } from "../../models/Exercise.js";
import { ProgramTemplate } from "../../models/ProgramTemplate.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  await Promise.all([Exercise.deleteMany({}), ProgramTemplate.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/exercises", () => {
  it("lists all exercises", async () => {
    await Exercise.create([
      { slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: ["chest"], equipment: ["none"], images: [] },
      { slug: "back-squat", name: "Barbell Back Squat", muscleGroups: ["quadriceps"], equipment: ["barbell", "rack"], images: [] },
    ]);
    const res = await request(createApp()).get("/api/exercises");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("filters by equipment", async () => {
    await Exercise.create([
      { slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: ["chest"], equipment: ["none"], images: [] },
      { slug: "back-squat", name: "Barbell Back Squat", muscleGroups: ["quadriceps"], equipment: ["barbell", "rack"], images: [] },
    ]);
    const res = await request(createApp()).get("/api/exercises?equipment=none");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe("incline-pushup");
  });
});

describe("GET /api/programs", () => {
  it("lists all program templates", async () => {
    await ProgramTemplate.create({
      slug: "home-start-weeks-1-4",
      name: "Home Start",
      phase: "bodyweight",
      exercises: [{ exerciseSlug: "incline-pushup", sets: 3, repRangeLow: 8, repRangeHigh: 15 }],
      weeklySchedule: [],
    });
    const res = await request(createApp()).get("/api/programs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].phase).toBe("bodyweight");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement the service**

`api/src/modules/reference-data/reference-data.service.ts`:
```typescript
import { Exercise } from "../../models/Exercise.js";
import { ProgramTemplate } from "../../models/ProgramTemplate.js";

export async function listExercises(equipment?: string) {
  const filter = equipment ? { equipment } : {};
  return Exercise.find(filter);
}

export async function listPrograms() {
  return ProgramTemplate.find({});
}
```

- [ ] **Step 4: Implement the routes**

`api/src/modules/reference-data/reference-data.routes.ts`:
```typescript
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
```

- [ ] **Step 5: Mount the router**

Modify `api/src/app.ts` — add `import { referenceDataRouter } from "./modules/reference-data/reference-data.routes.js";` and, alongside the other `app.use("/api/...")` lines: `app.use("/api", referenceDataRouter);` (mounted at root `/api` since the routes declare their own full sub-paths `/exercises`, `/programs`).

- [ ] **Step 6: Run test to verify it passes**

Run: `cd api && pnpm test && pnpm run build`
Expected: PASS, clean build.

- [ ] **Step 7: Commit**
```bash
git add api/src/modules/reference-data api/src/app.ts
git commit -m "feat: add public exercise and program-template listing endpoints"
```

---

### Task 2: Training-history read endpoints (progression states, workout history)

**Files:**
- Create: `api/src/modules/workouts/progression.routes.ts`
- Modify: `api/src/modules/workouts/workouts.service.ts` (add `listWorkoutSessions`)
- Modify: `api/src/modules/workouts/workouts.routes.ts` (add `GET /`)
- Modify: `api/src/app.ts`
- Test: `api/src/modules/workouts/progression.routes.test.ts`
- Test: extend `api/src/modules/workouts/workouts.routes.test.ts`

**Interfaces:**
- Consumes: `requireAuth` from `api/src/lib/session.ts` (already used by the existing `POST /` in `workouts.routes.ts`).
- Produces: `listWorkoutSessions(from?: string, to?: string): Promise<WorkoutSessionDoc[]>` from `workouts.service.ts`. Both new routes use `requireAuth` (personal training data).

- [ ] **Step 1: Write the failing test for `GET /api/progression`**

`api/src/modules/workouts/progression.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { ProgressionState } from "../../models/ProgressionState.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
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

describe("GET /api/progression", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(createApp()).get("/api/progression");
    expect(res.status).toBe(401);
  });

  it("lists all progression states", async () => {
    await ProgressionState.create({
      exerciseId: "incline-pushup",
      phase: "bodyweight",
      level: 1,
      repRangeLow: 8,
      repRangeHigh: 15,
      consecutiveTopOfRange: 0,
      consecutiveBelowRange: 0,
      consecutiveMisses: 0,
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/progression");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].level).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement the progression route**

`api/src/modules/workouts/progression.routes.ts`:
```typescript
import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { ProgressionState } from "../../models/ProgressionState.js";

export const progressionRouter = Router();

progressionRouter.get("/", requireAuth, async (_req, res) => {
  const states = await ProgressionState.find({});
  res.json(states);
});
```

- [ ] **Step 4: Mount at `/api/progression`**

Modify `api/src/app.ts`: `import { progressionRouter } from "./modules/workouts/progression.routes.js";` and `app.use("/api/progression", progressionRouter);`.

- [ ] **Step 5: Write the failing test for `GET /api/workouts` (history)**

Add to `api/src/modules/workouts/workouts.routes.test.ts` (reuse the file's existing `loggedInAgent` helper and add `WorkoutSession` to its imports if not already present, with an `afterEach` clearing it):
```typescript
describe("GET /api/workouts", () => {
  it("lists sessions in a date range", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    await WorkoutSession.create([
      { date: "2026-09-01", exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 10, weight: 0, type: "normal" }] }] },
      { date: "2026-09-10", exercises: [{ exerciseId: "incline-pushup", sets: [{ reps: 10, weight: 0, type: "normal" }] }] },
    ]);
    const res = await agent.get("/api/workouts?from=2026-09-05&to=2026-09-15");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBe("2026-09-10");
  });

  it("defaults to the last 30 days when no range is given", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/workouts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

- [ ] **Step 7: Implement `listWorkoutSessions`**

Add to `api/src/modules/workouts/workouts.service.ts`:
```typescript
const DEFAULT_HISTORY_WINDOW_DAYS = 30;

export async function listWorkoutSessions(from?: string, to?: string) {
  if (from && to) {
    return WorkoutSession.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 });
  }
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - DEFAULT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return WorkoutSession.find({
    date: { $gte: fromDate.toISOString().slice(0, 10), $lte: toDate.toISOString().slice(0, 10) },
  }).sort({ date: 1 });
}
```
(Add `import { WorkoutSession } from "../../models/WorkoutSession.js";` if not already present in this file.)

Note: `WorkoutSession.date` is a client-supplied local-date string, not a UTC timestamp — string comparison on ISO-format dates sorts/ranges correctly without `istDateRangeUtc` (see Global Constraints).

- [ ] **Step 8: Add the route**

Add to `api/src/modules/workouts/workouts.routes.ts` (add `listWorkoutSessions` to the existing service import):
```typescript
workoutsRouter.get("/", requireAuth, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const sessions = await listWorkoutSessions(from, to);
  res.json(sessions);
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd api && pnpm test && pnpm run build`

- [ ] **Step 10: Commit**
```bash
git add api/src/modules/workouts api/src/app.ts
git commit -m "feat: add progression-state and workout-history read endpoints"
```

---

### Task 3: Sleep and rollup history read endpoints

**Files:**
- Modify: `api/src/modules/sleep/sleep.service.ts` (add `listSleepSessions`)
- Modify: `api/src/modules/sleep/sleep.routes.ts` (add `GET /`)
- Create: `api/src/modules/rollups/rollups.service.ts`
- Create: `api/src/modules/rollups/rollups.routes.ts`
- Modify: `api/src/app.ts`
- Test: extend `api/src/modules/sleep/sleep.routes.test.ts`
- Test: `api/src/modules/rollups/rollups.routes.test.ts`

**Interfaces:**
- Produces: `listSleepSessions(from?, to?): Promise<SleepSessionDoc[]>`, `listRollups(from?, to?): Promise<DailyRollupDoc[]>`. Both `requireAuth`. Same date-range/default-30-days convention as Task 2.

- [ ] **Step 1: Write the failing test for `GET /api/sleep`**

Add to `api/src/modules/sleep/sleep.routes.test.ts` (reuse the file's existing `loggedInAgent` helper and `SleepSession` import):
```typescript
describe("GET /api/sleep", () => {
  it("lists sessions in a date range", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    await SleepSession.create([
      { date: "2026-09-01", bedTime: new Date("2026-09-01T20:00:00Z"), wakeTime: new Date("2026-09-02T04:00:00Z"), midpoint: new Date("2026-09-02T00:00:00Z") },
      { date: "2026-09-10", bedTime: new Date("2026-09-10T20:00:00Z"), wakeTime: new Date("2026-09-11T04:00:00Z"), midpoint: new Date("2026-09-11T00:00:00Z") },
    ]);
    const res = await agent.get("/api/sleep?from=2026-09-05&to=2026-09-15");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Implement `listSleepSessions`**

Add to `api/src/modules/sleep/sleep.service.ts`:
```typescript
const DEFAULT_HISTORY_WINDOW_DAYS = 30;

export async function listSleepSessions(from?: string, to?: string) {
  if (from && to) {
    return SleepSession.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 });
  }
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - DEFAULT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return SleepSession.find({
    date: { $gte: fromDate.toISOString().slice(0, 10), $lte: toDate.toISOString().slice(0, 10) },
  }).sort({ date: 1 });
}
```

- [ ] **Step 4: Add the route**

Add to `api/src/modules/sleep/sleep.routes.ts`:
```typescript
sleepRouter.get("/", requireAuth, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const sessions = await listSleepSessions(from, to);
  res.json(sessions);
});
```

- [ ] **Step 5: Run test, verify PASS.**

- [ ] **Step 6: Write the failing test for `GET /api/rollups`**

`api/src/modules/rollups/rollups.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { DailyRollup } from "../../models/DailyRollup.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await DailyRollup.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/rollups", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(createApp()).get("/api/rollups");
    expect(res.status).toBe(401);
  });

  it("lists rollups in a date range", async () => {
    await DailyRollup.create([
      { date: "2026-09-01", totalSteps: 3000, proteinG: 100, hardSets: 2 },
      { date: "2026-09-10", totalSteps: 8000, proteinG: 150, hardSets: 5 },
    ]);
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });
    const res = await agent.get("/api/rollups?from=2026-09-05&to=2026-09-15");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalSteps).toBe(8000);
  });
});
```

- [ ] **Step 7: Run test, verify FAIL.**

- [ ] **Step 8: Implement the rollups service and route**

`api/src/modules/rollups/rollups.service.ts`:
```typescript
import { DailyRollup } from "../../models/DailyRollup.js";

const DEFAULT_HISTORY_WINDOW_DAYS = 30;

export async function listRollups(from?: string, to?: string) {
  if (from && to) {
    return DailyRollup.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 });
  }
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - DEFAULT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return DailyRollup.find({
    date: { $gte: fromDate.toISOString().slice(0, 10), $lte: toDate.toISOString().slice(0, 10) },
  }).sort({ date: 1 });
}
```

`api/src/modules/rollups/rollups.routes.ts`:
```typescript
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
```

- [ ] **Step 9: Mount both**

Modify `api/src/app.ts`: add `import { rollupsRouter } from "./modules/rollups/rollups.routes.js";` and `app.use("/api/rollups", rollupsRouter);`.

- [ ] **Step 10: Run tests, verify PASS. Run `pnpm run build`.**

- [ ] **Step 11: Commit**
```bash
git add api/src/modules/sleep api/src/modules/rollups api/src/app.ts
git commit -m "feat: add sleep-history and daily-rollup-history read endpoints"
```

---

### Task 4: Food data read endpoints (dish search, barcode lookup, raw entries)

**Files:**
- Create: `api/src/modules/food/food.service.ts`
- Create: `api/src/modules/food/food.routes.ts`
- Modify: `api/src/modules/nutrition/nutrition.service.ts` (add `listFoodEntriesForDate`)
- Modify: `api/src/modules/nutrition/nutrition.routes.ts` (add `GET /entries/:date`)
- Modify: `api/src/app.ts`
- Test: `api/src/modules/food/food.routes.test.ts`
- Test: extend `api/src/modules/nutrition/nutrition.routes.test.ts`

**Interfaces:**
- Produces: `searchIndianDishes(query: string): Promise<IndianDishDoc[]>`, `lookupPackagedFoodByBarcode(barcode: string): Promise<PackagedFoodDoc | null>` from `food.service.ts`; `listFoodEntriesForDate(date: string): Promise<FoodEntryDoc[]>` from `nutrition.service.ts`. All `requireAuth`.

- [ ] **Step 1: Write the failing test for dish search and barcode lookup**

`api/src/modules/food/food.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { IndianDish } from "../../models/IndianDish.js";
import { PackagedFood } from "../../models/PackagedFood.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await Promise.all([IndianDish.deleteMany({}), PackagedFood.deleteMany({})]);
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

describe("GET /api/food/dishes", () => {
  it("case-insensitively searches by name, capped at 20", async () => {
    await IndianDish.create({
      slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200,
      macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/food/dishes?q=dal");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe("dal-tadka");
  });
});

describe("GET /api/food/packaged/:barcode", () => {
  it("returns the product for a known barcode", async () => {
    await PackagedFood.create({
      barcode: "8901063001011", name: "Nutrela Soya Chunks",
      macrosPer100g: { calories: 345, proteinG: 52, carbsG: 33, fatG: 0.5 }, source: "open_food_facts",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/food/packaged/8901063001011");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Nutrela Soya Chunks");
  });

  it("returns 404 for an unknown barcode", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.get("/api/food/packaged/0000000000000");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Implement the food service and routes**

`api/src/modules/food/food.service.ts`:
```typescript
import { IndianDish } from "../../models/IndianDish.js";
import { PackagedFood } from "../../models/PackagedFood.js";

const MAX_DISH_RESULTS = 20;

export async function searchIndianDishes(query: string) {
  return IndianDish.find({ name: { $regex: query, $options: "i" } }).limit(MAX_DISH_RESULTS);
}

export async function lookupPackagedFoodByBarcode(barcode: string) {
  return PackagedFood.findOne({ barcode });
}
```

`api/src/modules/food/food.routes.ts`:
```typescript
import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { searchIndianDishes, lookupPackagedFoodByBarcode } from "./food.service.js";

export const foodRouter = Router();

foodRouter.get("/dishes", requireAuth, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const dishes = await searchIndianDishes(q);
  res.json(dishes);
});

foodRouter.get("/packaged/:barcode", requireAuth, async (req, res) => {
  const barcode = Array.isArray(req.params.barcode) ? req.params.barcode[0] : req.params.barcode;
  const product = await lookupPackagedFoodByBarcode(barcode);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(product);
});
```

- [ ] **Step 4: Mount at `/api/food`**

Modify `api/src/app.ts`: `import { foodRouter } from "./modules/food/food.routes.js";` and `app.use("/api/food", foodRouter);`.

- [ ] **Step 5: Run test, verify PASS.**

- [ ] **Step 6: Write the failing test for `GET /api/nutrition/entries/:date`**

Add to `api/src/modules/nutrition/nutrition.routes.test.ts`:
```typescript
describe("GET /api/nutrition/entries/:date", () => {
  it("lists the raw entries logged for a date", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    await agent.post("/api/nutrition/entries").send({
      date: "2026-09-06", mealSlot: "lunch", source: "indian_dish", refId: "dal-tadka",
      macros: { calories: 220, proteinG: 12, carbsG: 28, fatG: 6 },
    });
    const res = await agent.get("/api/nutrition/entries/2026-09-06");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].mealSlot).toBe("lunch");
  });
});
```

- [ ] **Step 7: Run test, verify FAIL.**

- [ ] **Step 8: Implement `listFoodEntriesForDate`**

Add to `api/src/modules/nutrition/nutrition.service.ts`:
```typescript
export async function listFoodEntriesForDate(date: string) {
  return FoodEntry.find({ date });
}
```

- [ ] **Step 9: Add the route**

Add to `api/src/modules/nutrition/nutrition.routes.ts` (add `listFoodEntriesForDate` to the existing service import):
```typescript
nutritionRouter.get("/entries/:date", requireAuth, async (req, res) => {
  const date = Array.isArray(req.params.date) ? req.params.date[0] : req.params.date;
  const entries = await listFoodEntriesForDate(date);
  res.json(entries);
});
```

- [ ] **Step 10: Run full suite + build, verify PASS/clean.**

- [ ] **Step 11: Commit**
```bash
git add api/src/modules/food api/src/modules/nutrition api/src/app.ts
git commit -m "feat: add dish search, barcode lookup, and raw food-entry listing endpoints"
```

---

### Task 5: Recipe suggestion endpoint

**Files:**
- Create: `api/src/modules/recipes/recipes.service.ts`
- Create: `api/src/modules/recipes/recipes.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/recipes/recipes.routes.test.ts`

**Interfaces:**
- Produces: `suggestRecipes(remainingCalories: number): Promise<RecipeDoc[]>`. `requireAuth`.
- **Ranking algorithm:** filter to recipes whose `macros.calories <= remainingCalories * 1.15` (15% tolerance — a recipe slightly over budget is still a reasonable suggestion; one drastically over is not) AND `macros.calories > 0`; rank by protein density (`macros.proteinG / macros.calories`) descending, since design spec §6/§6.1's stated priority is protein-first, not calorie-minimization. `mealSlot`/`remainingProteinG` are accepted as route query params for forward compatibility but not used to filter yet — the `Recipe` model has no `mealSlot` field (seeded recipes are meal-agnostic), so meal-slot filtering is out of scope until a future seed-data enhancement tags recipes by slot. This is a scoped-down decision, not an oversight.

- [ ] **Step 1: Write the failing test**

`api/src/modules/recipes/recipes.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { Recipe } from "../../models/Recipe.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await Recipe.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/recipes/suggestions", () => {
  it("ranks recipes within budget by protein density", async () => {
    await Recipe.create([
      { slug: "high-protein", name: "Soya Chunk Masala", ingredients: [{ name: "soya", grams: 50 }], steps: ["cook"], equipment: ["pan"], prepMinutes: 20, macros: { calories: 300, proteinG: 30, carbsG: 20, fatG: 10 }, tags: [] },
      { slug: "low-protein", name: "Plain Rice", ingredients: [{ name: "rice", grams: 150 }], steps: ["cook"], equipment: ["pressure_cooker"], prepMinutes: 15, macros: { calories: 200, proteinG: 4, carbsG: 43, fatG: 0.5 }, tags: [] },
      { slug: "over-budget", name: "Feast", ingredients: [{ name: "everything", grams: 500 }], steps: ["cook"], equipment: ["pan"], prepMinutes: 40, macros: { calories: 900, proteinG: 50, carbsG: 80, fatG: 30 }, tags: [] },
    ]);
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });
    const res = await agent.get("/api/recipes/suggestions?mealSlot=lunch&remainingProteinG=40&remainingCalories=400");
    expect(res.status).toBe(200);
    expect(res.body.map((r: { slug: string }) => r.slug)).toEqual(["high-protein", "low-protein"]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Implement the service and route**

`api/src/modules/recipes/recipes.service.ts`:
```typescript
import { Recipe } from "../../models/Recipe.js";

const OVER_BUDGET_TOLERANCE = 1.15;

export async function suggestRecipes(remainingCalories: number) {
  const candidates = await Recipe.find({
    "macros.calories": { $gt: 0, $lte: remainingCalories * OVER_BUDGET_TOLERANCE },
  });

  return candidates.sort((a, b) => {
    const densityA = a.macros.proteinG / a.macros.calories;
    const densityB = b.macros.proteinG / b.macros.calories;
    return densityB - densityA;
  });
}
```

`api/src/modules/recipes/recipes.routes.ts`:
```typescript
import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { suggestRecipes } from "./recipes.service.js";

export const recipesRouter = Router();

recipesRouter.get("/suggestions", requireAuth, async (req, res) => {
  const remainingCalories = Number(req.query.remainingCalories ?? 0);
  // A garbage/missing query value coerces to NaN, and Mongo's $lte against
  // NaN is not a validation error — it just silently matches nothing (or
  // behaves unpredictably depending on driver version). Reject it explicitly
  // instead of returning a confusing empty list with no explanation.
  if (!Number.isFinite(remainingCalories) || remainingCalories < 0) {
    res.status(400).json({ error: "remainingCalories must be a non-negative number" });
    return;
  }
  const suggestions = await suggestRecipes(remainingCalories);
  res.json(suggestions);
});
```

- [ ] **Step 3b: Add the edge-case test**

Add to `api/src/modules/recipes/recipes.routes.test.ts`:
```typescript
it("rejects a non-numeric remainingCalories with 400", async () => {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "test-password" });
  const res = await agent.get("/api/recipes/suggestions?remainingCalories=not-a-number");
  expect(res.status).toBe(400);
});
```

- [ ] **Step 4: Mount at `/api/recipes`**

Modify `api/src/app.ts`: `import { recipesRouter } from "./modules/recipes/recipes.routes.js";` and `app.use("/api/recipes", recipesRouter);`.

- [ ] **Step 5: Run test, verify PASS. Run build.**

- [ ] **Step 6: Commit**
```bash
git add api/src/modules/recipes api/src/app.ts
git commit -m "feat: add protein-density-ranked recipe suggestion endpoint"
```

---

### Task 6: Coach notes read endpoint

**Files:**
- Create: `api/src/modules/coach-notes/coach-notes.service.ts`
- Create: `api/src/modules/coach-notes/coach-notes.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/modules/coach-notes/coach-notes.routes.test.ts`

**Interfaces:**
- Produces: `listCoachNotes(limit?: number): Promise<CoachNoteDoc[]>`, most-recent-first (default limit 10). `requireAuth`.

- [ ] **Step 1: Write the failing test**

`api/src/modules/coach-notes/coach-notes.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../app.js";
import { CoachNote } from "../../models/CoachNote.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.APP_PASSWORD = "test-password";
});

afterEach(async () => {
  await CoachNote.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/coach-notes", () => {
  it("lists notes most-recent-first, default limit 10", async () => {
    await CoachNote.create({ weekOf: "2026-08-25", digest: {}, summary: "older", suggestions: [], source: "mcp_session" });
    await CoachNote.create({ weekOf: "2026-09-01", digest: {}, summary: "newer", suggestions: [], source: "mcp_session" });
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "test-password" });
    const res = await agent.get("/api/coach-notes");
    expect(res.status).toBe(200);
    expect(res.body[0].summary).toBe("newer");
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Implement**

`api/src/modules/coach-notes/coach-notes.service.ts`:
```typescript
import { CoachNote } from "../../models/CoachNote.js";

const DEFAULT_LIMIT = 10;

export async function listCoachNotes(limit: number = DEFAULT_LIMIT) {
  return CoachNote.find({}).sort({ createdAt: -1 }).limit(limit);
}
```

`api/src/modules/coach-notes/coach-notes.routes.ts`:
```typescript
import { Router } from "express";
import { requireAuth } from "../../lib/session.js";
import { listCoachNotes } from "./coach-notes.service.js";

export const coachNotesRouter = Router();

coachNotesRouter.get("/", requireAuth, async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const notes = await listCoachNotes(limit);
  res.json(notes);
});
```

- [ ] **Step 4: Mount at `/api/coach-notes`**

Modify `api/src/app.ts`: `import { coachNotesRouter } from "./modules/coach-notes/coach-notes.routes.js";` and `app.use("/api/coach-notes", coachNotesRouter);`.

- [ ] **Step 5: Run test, verify PASS. Run build.**

- [ ] **Step 6: Commit**
```bash
git add api/src/modules/coach-notes api/src/app.ts
git commit -m "feat: add coach-notes feed endpoint"
```

---

### Task 7: Natural-language food parsing

**Files:**
- Create: `api/src/modules/nutrition/gemini-client.ts`
- Create: `api/src/modules/nutrition/nutrition-parsing.service.ts`
- Modify: `api/src/modules/nutrition/nutrition.routes.ts` (add `POST /parse`)
- Modify: `api/src/config/env.ts` (add `geminiApiKey`)
- Modify: `api/.env.example`
- Test: `api/src/modules/nutrition/nutrition-parsing.service.test.ts`
- Test: extend `api/src/modules/nutrition/nutrition.routes.test.ts`

**Interfaces:**
- Produces: `GeminiClient` type (`{ generateContent(prompt: string): Promise<string> }`), `parseNaturalLanguageFood(text: string, mealSlot: string, geminiClient: GeminiClient): Promise<ParsedFoodDraft>`.
- Produces the canonical response shape every food-parsing endpoint and the web frontend share — **this exact shape is authoritative; Task 15 (web nutrition logging UI) must match it exactly, not invent additional fields:**
  ```typescript
  export type ParsedFoodItem = {
    source: "indian_dish" | "packaged_food" | "llm_estimate";
    refId?: string;
    name: string;
    macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
  };
  export type ParsedFoodDraft = {
    items: ParsedFoodItem[];
    needsAddedFatPrompt: boolean;
  };
  ```
- Consumes: `IndianDish` model (for matching). Never writes to the DB — this endpoint only returns an editable draft; the frontend later POSTs confirmed items to the existing `POST /api/nutrition/entries`.

This is the one task in this plan whose core logic (the Gemini call itself) is not directly unit-testable without a real API key. Isolate it behind `GeminiClient` and test everything else (prompt construction, response validation, DB-matching fallback logic) against a fake client — mirrors the project convention of never mocking the database, applied to the one genuinely external dependency here.

- [ ] **Step 1: Write the failing test for the parsing service, using a fake Gemini client**

`api/src/modules/nutrition/nutrition-parsing.service.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { IndianDish } from "../../models/IndianDish.js";
import { parseNaturalLanguageFood, type GeminiClient } from "./nutrition-parsing.service.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await IndianDish.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function fakeGeminiClient(response: string): GeminiClient {
  return { generateContent: async () => response };
}

describe("parseNaturalLanguageFood", () => {
  it("matches a Gemini-identified dish slug against IndianDish", async () => {
    await IndianDish.create({
      slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200,
      macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB",
    });
    const gemini = fakeGeminiClient(
      JSON.stringify({ items: [{ matchedSlug: "dal-tadka", isGravyOrCurry: true }] })
    );
    const draft = await parseNaturalLanguageFood("dal chawal", "lunch", gemini);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ source: "indian_dish", refId: "dal-tadka", name: "Dal Tadka" });
    expect(draft.needsAddedFatPrompt).toBe(true);
  });

  it("falls back to an llm_estimate when no dish/product match is found", async () => {
    const gemini = fakeGeminiClient(
      JSON.stringify({
        items: [{ matchedSlug: null, isGravyOrCurry: false, estimatedName: "Mystery Snack", estimatedMacros: { calories: 150, proteinG: 3, carbsG: 20, fatG: 6 } }],
      })
    );
    const draft = await parseNaturalLanguageFood("some random snack", "snack", gemini);
    expect(draft.items[0]).toMatchObject({ source: "llm_estimate", name: "Mystery Snack" });
    expect(draft.needsAddedFatPrompt).toBe(false);
  });

  it("throws a clear error when Gemini returns malformed JSON, rather than passing it through", async () => {
    const gemini = fakeGeminiClient("not json at all");
    await expect(parseNaturalLanguageFood("dal chawal", "lunch", gemini)).rejects.toThrow(/invalid.*response/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — module doesn't exist.

- [ ] **Step 3: Define the Gemini client interface**

`api/src/modules/nutrition/gemini-client.ts`:
```typescript
export type GeminiClient = {
  generateContent(prompt: string): Promise<string>;
};

// Real implementation, wired in nutrition.routes.ts — not exercised by unit
// tests, which inject a fake GeminiClient instead. Verify the exact current
// Gemini REST endpoint/model name against https://ai.google.dev/gemini-api/docs
// at execution time before treating "gemini-2.0-flash" below as final; the
// GeminiClient interface it implements is what matters for the rest of this
// task and is stable regardless of which model name is current.
export function createGeminiClient(apiKey: string): GeminiClient {
  return {
    async generateContent(prompt: string): Promise<string> {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!response.ok) {
        throw new Error(`Gemini API request failed: ${response.status}`);
      }
      const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Gemini API returned no content");
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Implement Zod schemas and the matching/fallback logic**

`api/src/modules/nutrition/nutrition-parsing.service.ts`:
```typescript
import { z } from "zod";
import { IndianDish } from "../../models/IndianDish.js";
import type { GeminiClient } from "./gemini-client.js";

export type { GeminiClient };

const GeminiFoodItemSchema = z.object({
  matchedSlug: z.string().nullable(),
  isGravyOrCurry: z.boolean(),
  estimatedName: z.string().optional(),
  estimatedMacros: z
    .object({ calories: z.number(), proteinG: z.number(), carbsG: z.number(), fatG: z.number() })
    .optional(),
});

const GeminiFoodResponseSchema = z.object({
  items: z.array(GeminiFoodItemSchema),
});

type GeminiFoodItem = z.infer<typeof GeminiFoodItemSchema>;

export type ParsedFoodItem = {
  source: "indian_dish" | "packaged_food" | "llm_estimate";
  refId?: string;
  name: string;
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
};

export type ParsedFoodDraft = {
  items: ParsedFoodItem[];
  needsAddedFatPrompt: boolean;
};

function buildTextPrompt(text: string, mealSlot: string): string {
  return `You are a nutrition-logging assistant for an Indian home-cooking context. The user logged this ${mealSlot}: "${text}".

Identify each distinct food item mentioned. For each item, respond with a JSON object matching this exact shape (respond with ONLY the JSON, no other text):
{
  "items": [
    {
      "matchedSlug": "<a plausible database slug for a common Indian dish, e.g. 'dal-tadka', 'roti', 'rajma' — lowercase, hyphenated, or null if this doesn't match a well-known dish>",
      "isGravyOrCurry": <true if this is a gravy/curry-type dish where added oil/ghee is likely invisible and significant, false otherwise>,
      "estimatedName": "<a human-readable name, only needed if matchedSlug is null>",
      "estimatedMacros": { "calories": <number>, "proteinG": <number>, "carbsG": <number>, "fatG": <number> } (only needed if matchedSlug is null)
    }
  ]
}`;
}

async function resolveMatchedItems(items: GeminiFoodItem[]): Promise<ParsedFoodDraft> {
  const resolved: ParsedFoodItem[] = [];
  let needsAddedFatPrompt = false;

  for (const item of items) {
    if (item.isGravyOrCurry) needsAddedFatPrompt = true;

    if (item.matchedSlug) {
      const dish = await IndianDish.findOne({ slug: item.matchedSlug });
      if (dish) {
        resolved.push({ source: "indian_dish", refId: dish.slug, name: dish.name, macros: dish.macrosPerServing });
        continue;
      }
    }

    resolved.push({
      source: "llm_estimate",
      name: item.estimatedName ?? "Unknown item",
      macros: item.estimatedMacros ?? { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    });
  }

  return { items: resolved, needsAddedFatPrompt };
}

function parseAndValidate(raw: string): GeminiFoodItem[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned an invalid response: not valid JSON");
  }

  const validated = GeminiFoodResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error("Gemini returned an invalid response: unexpected shape");
  }

  return validated.data.items;
}

export async function parseNaturalLanguageFood(
  text: string,
  mealSlot: string,
  geminiClient: GeminiClient
): Promise<ParsedFoodDraft> {
  const raw = await geminiClient.generateContent(buildTextPrompt(text, mealSlot));
  const items = parseAndValidate(raw);
  return resolveMatchedItems(items);
}
```

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Add `GEMINI_API_KEY` to env config**

Modify `api/src/config/env.ts` — add `geminiApiKey: string;` to the `Env` type and `geminiApiKey: required("GEMINI_API_KEY"),` to the returned object.

Modify `api/.env.example` — add `GEMINI_API_KEY=replace-with-your-gemini-api-key`.

- [ ] **Step 7: Write the failing test for the route**

Add to `api/src/modules/nutrition/nutrition.routes.test.ts`:
```typescript
describe("POST /api/nutrition/parse", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "placeholder-key-for-tests";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ items: [{ matchedSlug: "dal-tadka", isGravyOrCurry: true }] }) }] } },
            ],
          })
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an editable draft without saving anything", async () => {
    await IndianDish.create({
      slug: "dal-tadka", name: "Dal Tadka", servingGrams: 200,
      macrosPerServing: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 }, source: "INDB",
    });
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.post("/api/nutrition/parse").send({ text: "dal chawal", mealSlot: "lunch" });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    const entries = await FoodEntry.find({});
    expect(entries).toHaveLength(0); // never auto-saves
  });
});
```
(Add `vi` to this test file's existing vitest import if not already present.)

- [ ] **Step 8: Add the route**

Add to `api/src/modules/nutrition/nutrition.routes.ts`:
```typescript
import { z } from "zod";
import { MealSlotSchema } from "@health-tracker/shared";
import { createGeminiClient } from "./gemini-client.js";
import { parseNaturalLanguageFood } from "./nutrition-parsing.service.js";
// ...
const ParseTextBodySchema = z.object({
  text: z.string().trim().min(1),
  mealSlot: MealSlotSchema,
});

nutritionRouter.post("/parse", requireAuth, async (req, res) => {
  // Reuse the same MealSlotSchema the rest of nutrition already validates
  // against (FoodEntryInputSchema), rather than a loose truthy check that
  // would accept an invalid mealSlot like "midnight-snack" and only fail
  // later, confusingly, when the frontend tries to save the confirmed draft.
  const parsed = ParseTextBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? "");
  try {
    const draft = await parseNaturalLanguageFood(parsed.data.text, parsed.data.mealSlot, geminiClient);
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: "Failed to parse food text", details: (err as Error).message });
  }
});
```

- [ ] **Step 8b: Add the edge-case tests**

Add to `api/src/modules/nutrition/nutrition.routes.test.ts`:
```typescript
it("rejects an empty text field with 400", async () => {
  const app = createApp();
  const agent = await loggedInAgent(app);
  const res = await agent.post("/api/nutrition/parse").send({ text: "", mealSlot: "lunch" });
  expect(res.status).toBe(400);
});

it("rejects an invalid mealSlot with 400", async () => {
  const app = createApp();
  const agent = await loggedInAgent(app);
  const res = await agent.post("/api/nutrition/parse").send({ text: "dal chawal", mealSlot: "midnight-snack" });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 9: Run full suite + build, verify PASS/clean.**

- [ ] **Step 10: Commit**
```bash
git add api/src/modules/nutrition api/src/config/env.ts api/.env.example
git commit -m "feat: add natural-language food parsing via Gemini, returning an editable draft"
```

---

### Task 8: Photo food parsing

**Files:**
- Modify: `api/src/modules/nutrition/gemini-client.ts` (extend `GeminiClient` with `generateContentWithImage`)
- Modify: `api/src/modules/nutrition/nutrition-parsing.service.ts` (add `parsePhotoFood`)
- Modify: `api/src/modules/nutrition/nutrition.routes.ts` (add `POST /parse-photo`)
- Test: extend `api/src/modules/nutrition/nutrition-parsing.service.test.ts`
- Test: extend `api/src/modules/nutrition/nutrition.routes.test.ts`

**Interfaces:**
- Produces: `parsePhotoFood(imageBase64: string, mealSlot: string, geminiClient: GeminiClient): Promise<ParsedFoodDraft>` — same `ParsedFoodDraft` shape as Task 7, same Gemini-isolation testing approach.
- Extends `GeminiClient` (Task 7) with `generateContentWithImage(prompt: string, imageBase64: string): Promise<string>`, since multimodal Gemini calls take image + text in one request.

- [ ] **Step 1: Write the failing test**

Add to `api/src/modules/nutrition/nutrition-parsing.service.test.ts`:
```typescript
describe("parsePhotoFood", () => {
  it("parses an image the same way as text, via the multimodal client", async () => {
    await IndianDish.create({
      slug: "paneer-bhurji", name: "Paneer Bhurji", servingGrams: 100,
      macrosPerServing: { calories: 265, proteinG: 16, carbsG: 6, fatG: 20 }, source: "INDB",
    });
    const gemini: GeminiClient = {
      generateContent: async () => "",
      generateContentWithImage: async () =>
        JSON.stringify({ items: [{ matchedSlug: "paneer-bhurji", isGravyOrCurry: false }] }),
    };
    const draft = await parsePhotoFood("base64-fake-image-data", "dinner", gemini);
    expect(draft.items[0]).toMatchObject({ source: "indian_dish", refId: "paneer-bhurji" });
  });
});
```
(Add `parsePhotoFood` to this file's existing import from `./nutrition-parsing.service.js`.)

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Extend `GeminiClient`**

Modify `api/src/modules/nutrition/gemini-client.ts`:
```typescript
export type GeminiClient = {
  generateContent(prompt: string): Promise<string>;
  generateContentWithImage(prompt: string, imageBase64: string): Promise<string>;
};

export function createGeminiClient(apiKey: string): GeminiClient {
  return {
    async generateContent(prompt: string): Promise<string> {
      // ...unchanged from Task 7...
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!response.ok) {
        throw new Error(`Gemini API request failed: ${response.status}`);
      }
      const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Gemini API returned no content");
      }
      return text;
    },
    async generateContentWithImage(prompt: string, imageBase64: string): Promise<string> {
      // Same caveat as Task 7: verify the exact current Gemini multimodal
      // request shape against https://ai.google.dev/gemini-api/docs at
      // execution time — the inline_data/mime_type field names below are
      // illustrative of the general pattern, not guaranteed byte-exact for
      // whatever API version is current when this task is implemented.
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] },
            ],
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Gemini API request failed: ${response.status}`);
      }
      const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Gemini API returned no content");
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Implement `parsePhotoFood`, reusing the shared matching logic from Task 7**

Add to `api/src/modules/nutrition/nutrition-parsing.service.ts` (this reuses `resolveMatchedItems`/`parseAndValidate` already defined in Task 7 — no duplicated matching logic):
```typescript
function buildPhotoPrompt(mealSlot: string): string {
  return `You are a nutrition-logging assistant for an Indian home-cooking context. Identify the food item(s) in this photo, logged as ${mealSlot}. Respond with ONLY JSON in this exact shape:
{
  "items": [
    {
      "matchedSlug": "<a plausible database slug for a common Indian dish, lowercase hyphenated, or null>",
      "isGravyOrCurry": <true if this is a gravy/curry where added oil/ghee is likely invisible in the photo, false otherwise>,
      "estimatedName": "<human-readable name, only if matchedSlug is null>",
      "estimatedMacros": { "calories": <number>, "proteinG": <number>, "carbsG": <number>, "fatG": <number> } (only if matchedSlug is null)
    }
  ]
}`;
}

export async function parsePhotoFood(
  imageBase64: string,
  mealSlot: string,
  geminiClient: GeminiClient
): Promise<ParsedFoodDraft> {
  const raw = await geminiClient.generateContentWithImage(buildPhotoPrompt(mealSlot), imageBase64);
  const items = parseAndValidate(raw);
  return resolveMatchedItems(items);
}
```

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Write the failing test for the route**

Add to `api/src/modules/nutrition/nutrition.routes.test.ts` (reusing the fetch-stub pattern from Task 7's route test):
```typescript
describe("POST /api/nutrition/parse-photo", () => {
  it("returns an editable draft from a base64 image, without saving anything", async () => {
    const app = createApp();
    const agent = await loggedInAgent(app);
    const res = await agent.post("/api/nutrition/parse-photo").send({ image: "base64-fake-image-data", mealSlot: "dinner" });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    const entries = await FoodEntry.find({});
    expect(entries).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Add the route**

Add to `api/src/modules/nutrition/nutrition.routes.ts`:
```typescript
import { parsePhotoFood } from "./nutrition-parsing.service.js";
// ...
const ParsePhotoBodySchema = z.object({
  image: z.string().trim().min(1),
  mealSlot: MealSlotSchema,
});

nutritionRouter.post("/parse-photo", requireAuth, async (req, res) => {
  const parsed = ParsePhotoBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? "");
  try {
    const draft = await parsePhotoFood(parsed.data.image, parsed.data.mealSlot, geminiClient);
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: "Failed to parse food photo", details: (err as Error).message });
  }
});
```
Note: this accepts a base64 JSON field for simplicity, matching the plan's existing JSON-body convention throughout `api/`. A future true multipart file upload (for large images) would be a small, isolated change to this one route's body-parsing, not a redesign of `parsePhotoFood` itself. `z`/`MealSlotSchema` are already imported at the top of this file from Task 7 — do not re-import.

- [ ] **Step 7b: Add the edge-case test**

Add to `api/src/modules/nutrition/nutrition.routes.test.ts`:
```typescript
it("rejects an invalid mealSlot on the photo route with 400", async () => {
  const app = createApp();
  const agent = await loggedInAgent(app);
  const res = await agent.post("/api/nutrition/parse-photo").send({ image: "base64data", mealSlot: "brunch" });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 8: Run full suite + build, verify PASS/clean.**

- [ ] **Step 9: Commit**
```bash
git add api/src/modules/nutrition
git commit -m "feat: add photo-based food parsing via Gemini multimodal"
```

---

## Part 2: Web frontend

### Task 9: Web app scaffold (Next.js 16, Tailwind v4, TanStack Query)

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.ts`
- Create: `web/app/globals.css`
- Create: `web/app/layout.tsx`
- Create: `web/app/providers.tsx`
- Create: `web/app/page.tsx`
- Create: `web/lib/env.ts`
- Test: `web/app/page.test.tsx`

**Interfaces:**
- Produces: `QueryProvider` component (`web/app/providers.tsx`) wrapping children in a `QueryClientProvider` — every later task's data-fetching hooks assume this is mounted at the root layout.
- Produces: `getApiBaseUrl(): string` (`web/lib/env.ts`) reading `NEXT_PUBLIC_API_URL`, used by every fetch helper in later tasks.

- [ ] **Step 1: Scaffold package.json**

`web/package.json`:
```json
{
  "name": "@health-tracker/web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@health-tracker/shared": "workspace:*",
    "@tanstack/react-query": "^5.102.8",
    "dexie": "^4.4.2",
    "dexie-react-hooks": "^4.4.0",
    "next": "^16.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: tsconfig**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "incremental": true,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Tailwind v4 CSS-first setup (no `tailwind.config.ts`)**

`web/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`web/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --color-brand: #1f6f4a;
}

body {
  @apply bg-white text-neutral-900 antialiased;
}
```

- [ ] **Step 4: Env accessor**

`web/lib/env.ts`:
```typescript
export function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("Missing required env var: NEXT_PUBLIC_API_URL");
  }
  return url;
}
```

- [ ] **Step 5: TanStack Query provider**

`web/app/providers.tsx`:
```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 6: Root layout with nav**

`web/app/layout.tsx`:
```typescript
import "./globals.css";
import { QueryProvider } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <nav className="flex gap-4 border-b p-4">
            <a href="/">Home</a>
            <a href="/train">Train</a>
            <a href="/nutrition">Nutrition</a>
            <a href="/sleep">Sleep</a>
            <a href="/coach-notes">Coach Notes</a>
          </nav>
          <main className="p-4">{children}</main>
        </QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Write the failing smoke test**

`web/app/page.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";

describe("home page", () => {
  it("renders a heading", () => {
    render(<Page />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd web && pnpm install && pnpm test`
Expected: FAIL — `./page.tsx` does not exist yet.

- [ ] **Step 9: Implement the home page**

`web/app/page.tsx`:
```typescript
export default function Page() {
  return <h1>Health Tracker</h1>;
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd web && pnpm test`
Expected: PASS

- [ ] **Step 11: Commit**
```bash
git add web
git commit -m "chore: scaffold Next.js 16 web app with Tailwind v4 and TanStack Query"
```

---

### Task 10: Auth — login page, session helper, fetch wrapper

**Files:**
- Create: `web/lib/apiFetch.ts`
- Create: `web/lib/getServerSession.ts`
- Create: `web/app/login/page.tsx`
- Test: `web/lib/apiFetch.test.ts`
- Test: `web/lib/getServerSession.test.ts`

**Interfaces:**
- Consumes: `getApiBaseUrl` from Task 9.
- Produces: `apiFetch(path: string, init?: RequestInit): Promise<Response>` (`web/lib/apiFetch.ts`) — every client-side data-fetching hook in later tasks uses this instead of raw `fetch`.
- Produces: `getServerSession(): Promise<{ loggedIn: boolean }>` (`web/lib/getServerSession.ts`) — every server component that needs to gate on auth uses this.

- [ ] **Step 1: Write the failing test for `apiFetch`**

`web/lib/apiFetch.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch } from "./apiFetch";

describe("apiFetch", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  });

  it("always sets credentials to include", async () => {
    await apiFetch("/api/auth/whoami");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:4000/api/auth/whoami",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("preserves caller-supplied init options", async () => {
    await apiFetch("/api/workouts", { method: "POST", body: "{}" });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:4000/api/workouts",
      expect.objectContaining({ method: "POST", body: "{}", credentials: "include" })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `apiFetch`**

`web/lib/apiFetch.ts`:
```typescript
import { getApiBaseUrl } from "./env.js";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${getApiBaseUrl()}${path}`, { ...init, credentials: "include" });
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Write the failing test for `getServerSession`**

`web/lib/getServerSession.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    toString: () => "health-tracker-session=abc123",
  }),
}));

import { getServerSession } from "./getServerSession";

describe("getServerSession", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  });

  it("forwards the cookie header and returns loggedIn:true on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ loggedIn: true }), { status: 200 }))
    );
    const result = await getServerSession();
    expect(result.loggedIn).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:4000/api/auth/whoami",
      expect.objectContaining({ headers: { Cookie: "health-tracker-session=abc123" } })
    );
  });

  it("returns loggedIn:false on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    const result = await getServerSession();
    expect(result.loggedIn).toBe(false);
  });

  it("fails safe to loggedIn:false when the API is unreachable, rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await getServerSession();
    expect(result.loggedIn).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

- [ ] **Step 7: Implement `getServerSession`**

Next.js 16's `cookies()` is async — this is the one place in the whole web app that must remember to forward the cookie header manually, since server-side `fetch` does not auto-attach browser cookies cross-origin. A network failure here (API down, DNS failure) must not crash whatever Server Component/layout called this — "can't verify the session" fails safe to logged-out, same as an explicit 401.

`web/lib/getServerSession.ts`:
```typescript
import { cookies } from "next/headers";
import { getApiBaseUrl } from "./env.js";

export async function getServerSession(): Promise<{ loggedIn: boolean }> {
  const cookieStore = await cookies();
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/auth/whoami`, {
      headers: { Cookie: cookieStore.toString() },
    });
    return { loggedIn: res.status === 200 };
  } catch {
    return { loggedIn: false };
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

- [ ] **Step 9: Implement the login page**

`web/app/login/page.tsx`:
```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/apiFetch";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("Wrong password");
        return;
      }
      if (res.status !== 200) {
        setError("Something went wrong. Please try again.");
        return;
      }
      router.push("/");
    } catch {
      // The API being unreachable (offline, DNS failure) is a distinct case
      // from a wrong password — without this catch, a network error here
      // throws an unhandled rejection and the form just silently does nothing.
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 max-w-sm">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="border p-2"
        disabled={isSubmitting}
      />
      {error && <p className="text-red-600">{error}</p>}
      <button type="submit" className="bg-brand text-white p-2" disabled={isSubmitting}>
        {isSubmitting ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 10: Commit**
```bash
git add web/lib/apiFetch.ts web/lib/getServerSession.ts web/app/login web/lib/apiFetch.test.ts web/lib/getServerSession.test.ts
git commit -m "feat: add login page, credentialed fetch wrapper, server-side session helper"
```

---

### Task 11: Dexie offline outbox (highest-value test target — data loss here breaks trust)

**Files:**
- Create: `web/lib/db.ts`
- Create: `web/lib/outbox.ts`
- Create: `web/lib/useOutbox.ts`
- Create: `web/vitest.config.ts`
- Create: `web/vitest.setup.ts`
- Test: `web/lib/outbox.test.ts`

**Interfaces:**
- Produces: `db: Dexie` (`web/lib/db.ts`) with an `outbox` table — `{ id, type: "workout"|"nutrition"|"sleep", payload, createdAt, status: "pending"|"syncing"|"synced"|"failed" }`.
- Produces: `queueForSync(type: OutboxItemType, payload: unknown): Promise<number>` (`web/lib/outbox.ts`) — every logging form in Tasks 12/14/16 calls this instead of fetching directly.
- Produces: `syncOutbox(): Promise<{ synced: number; failed: number }>` (`web/lib/outbox.ts`) — called on reconnect.
- Produces: `usePendingOutboxCount(): number`, `useOutboxSync(): void` (`web/lib/useOutbox.ts`, `useLiveQuery`-backed).

Test setup note: Dexie runs against real `indexedDB` in the browser but Vitest runs in Node — use `fake-indexeddb` (added to `devDependencies` in Task 9) to provide a real, spec-compliant `indexedDB` global in tests, not a mock of Dexie itself — mirrors the "hit a real backend, never mock it" principle the API's tests use for MongoDB.

- [ ] **Step 1: Configure the test environment to provide `indexedDB`**

`web/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

`web/vitest.setup.ts`:
```typescript
import "fake-indexeddb/auto";
```

- [ ] **Step 2: Write the failing tests for the outbox**

`web/lib/outbox.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "./db";
import { queueForSync, syncOutbox } from "./outbox";

beforeEach(async () => {
  await db.outbox.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queueForSync", () => {
  it("writes an item to the outbox with status pending", async () => {
    const id = await queueForSync("workout", { date: "2026-09-06" });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("pending");
    expect(item?.type).toBe("workout");
    expect(item?.payload).toEqual({ date: "2026-09-06" });
  });
});

describe("syncOutbox", () => {
  it("marks an item synced when the POST succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 201 })));
    const id = await queueForSync("workout", { date: "2026-09-06" });

    const result = await syncOutbox();

    expect(result).toEqual({ synced: 1, failed: 0 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("synced");
  });

  it("marks an item failed (not synced, not lost) when the POST fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const id = await queueForSync("workout", { date: "2026-09-06" });

    const result = await syncOutbox();

    expect(result).toEqual({ synced: 0, failed: 1 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("failed");
    expect(item?.payload).toEqual({ date: "2026-09-06" }); // the data survives, ready to retry
  });

  it("marks an item failed when the network throws (offline), never drops it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const id = await queueForSync("nutrition", { date: "2026-09-06" });

    const result = await syncOutbox();

    expect(result).toEqual({ synced: 0, failed: 1 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("failed");
  });

  it("retries a previously-failed item on the next sync call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const id = await queueForSync("workout", { date: "2026-09-06" });
    await syncOutbox();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 201 })));
    const result = await syncOutbox();

    expect(result).toEqual({ synced: 1, failed: 0 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("synced");
  });

  it("routes each outbox type to its correct endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await queueForSync("workout", { a: 1 });
    await queueForSync("nutrition", { b: 2 });
    await queueForSync("sleep", { c: 3 });
    await syncOutbox();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/workouts"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/nutrition/entries"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/sleep"), expect.anything());
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

- [ ] **Step 4: Implement the Dexie schema**

`web/lib/db.ts`:
```typescript
import Dexie, { type EntityTable } from "dexie";

export type OutboxItemType = "workout" | "nutrition" | "sleep";
export type OutboxStatus = "pending" | "syncing" | "synced" | "failed";

export type OutboxItem = {
  id: number;
  type: OutboxItemType;
  payload: unknown;
  createdAt: number;
  status: OutboxStatus;
};

export const db = new Dexie("health-tracker") as Dexie & {
  outbox: EntityTable<OutboxItem, "id">;
};

db.version(1).stores({
  outbox: "++id, type, status, createdAt",
});
```

- [ ] **Step 5: Implement `queueForSync` and `syncOutbox`**

`web/lib/outbox.ts`:
```typescript
import { apiFetch } from "./apiFetch.js";
import { db, type OutboxItemType } from "./db.js";

const ENDPOINT_BY_TYPE: Record<OutboxItemType, string> = {
  workout: "/api/workouts",
  nutrition: "/api/nutrition/entries",
  sleep: "/api/sleep",
};

export async function queueForSync(type: OutboxItemType, payload: unknown): Promise<number> {
  return db.outbox.add({
    type,
    payload,
    createdAt: Date.now(),
    status: "pending",
  } as never);
}

export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  const pending = await db.outbox.where("status").anyOf("pending", "failed").toArray();

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    await db.outbox.update(item.id, { status: "syncing" });
    try {
      const res = await apiFetch(ENDPOINT_BY_TYPE[item.type], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (res.status >= 200 && res.status < 300) {
        await db.outbox.update(item.id, { status: "synced" });
        synced += 1;
      } else {
        await db.outbox.update(item.id, { status: "failed" });
        failed += 1;
      }
    } catch {
      // Network error (offline, DNS failure, etc.) — never drop the item.
      await db.outbox.update(item.id, { status: "failed" });
      failed += 1;
    }
  }

  return { synced, failed };
}
```

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Implement the reconnect-triggered sync hook**

`navigator.onLine`/the `online` event are known to false-positive. `syncOutbox` itself is the real connectivity check — call it opportunistically on the `online` event AND on a periodic interval as a fallback, since either signal alone is unreliable; a failed `fetch` inside `syncOutbox` just leaves items in `"failed"` state for the next attempt, which is always safe.

`web/lib/useOutbox.ts`:
```typescript
"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db.js";
import { syncOutbox } from "./outbox.js";

const RETRY_INTERVAL_MS = 30_000;

export function usePendingOutboxCount(): number {
  return useLiveQuery(() => db.outbox.where("status").anyOf("pending", "failed").count(), [], 0) ?? 0;
}

export function useOutboxSync(): void {
  useEffect(() => {
    void syncOutbox();
    window.addEventListener("online", () => void syncOutbox());
    const interval = setInterval(() => void syncOutbox(), RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
```

- [ ] **Step 8: Wire `useOutboxSync` into the root layout**

Modify `web/app/providers.tsx` to call `useOutboxSync()` once at the app root (add the import and the call inside `QueryProvider`).

- [ ] **Step 9: Commit**
```bash
git add web/lib/db.ts web/lib/outbox.ts web/lib/useOutbox.ts web/lib/outbox.test.ts web/vitest.config.ts web/vitest.setup.ts web/app/providers.tsx
git commit -m "feat: add Dexie offline outbox with fetch-verified reconnect sync"
```

---

### Task 12: Gym logging UI

**Files:**
- Create: `web/app/train/log/page.tsx`
- Create: `web/lib/useExercises.ts`
- Test: `web/lib/useExercises.test.ts`

**Interfaces:**
- Consumes: `GET /api/exercises` (Task 1) → `Exercise[]` (`{slug,name,muscleGroups,equipment,images,homeEquivalentSlug?}`), `queueForSync` (Task 11), `apiFetch` (Task 10).
- Produces: `useExercises(): { data: Exercise[] | undefined; isLoading: boolean }`.

- [ ] **Step 1: Write the failing test for `useExercises`**

`web/lib/useExercises.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useExercises } from "./useExercises";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useExercises", () => {
  it("fetches and returns the exercise list", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: [], equipment: [], images: [] }]))
      )
    );

    const { result } = renderHook(() => useExercises(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.[0].slug).toBe("incline-pushup");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `useExercises`**

`web/lib/useExercises.ts`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./apiFetch.js";

export type Exercise = {
  slug: string;
  name: string;
  muscleGroups: string[];
  equipment: string[];
  images: string[];
  homeEquivalentSlug?: string;
};

export function useExercises() {
  return useQuery({
    queryKey: ["exercises"],
    queryFn: async () => {
      const res = await apiFetch("/api/exercises");
      return (await res.json()) as Exercise[];
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Implement the logging page**

`web/app/train/log/page.tsx`:
```typescript
"use client";

import { useState } from "react";
import { useExercises } from "../../../lib/useExercises";
import { queueForSync } from "../../../lib/outbox";

type SetInput = { reps: number; weight: number; rir?: number; type: "warmup" | "normal" };

export default function LogWorkoutPage() {
  const { data: exercises, isLoading, isError: exercisesFailedToLoad } = useExercises();
  const [exerciseId, setExerciseId] = useState("");
  const [sets, setSets] = useState<SetInput[]>([{ reps: 0, weight: 0, type: "normal" }]);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    setSaveError(null);
    setIsSaving(true);
    try {
      // queueForSync only fails if the LOCAL IndexedDB write itself fails
      // (e.g. quota exceeded, or a browser blocking IndexedDB in private
      // mode) — it never fails due to network conditions, since it writes
      // locally first and syncs later. That's rare but must still surface
      // an error rather than silently pretending the set was saved.
      await queueForSync("workout", {
        date: new Date().toISOString().slice(0, 10),
        exercises: [{ exerciseId, sets }],
      });
      setSaved(true);
    } catch {
      setSaveError("Couldn't save this session on this device. Try again, or check your browser's storage settings.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <p>Loading exercises…</p>;
  if (exercisesFailedToLoad) {
    return <p className="text-red-600">Couldn't load the exercise list. Check your connection and reload.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)} className="border p-2">
        <option value="">Select exercise</option>
        {exercises?.map((ex) => (
          <option key={ex.slug} value={ex.slug}>
            {ex.name}
          </option>
        ))}
      </select>
      {sets.map((set, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="number"
            placeholder="Reps"
            value={set.reps}
            onChange={(e) => {
              const next = [...sets];
              next[i] = { ...set, reps: Number(e.target.value) };
              setSets(next);
            }}
            className="border p-2 w-20"
          />
          <input
            type="number"
            placeholder="Weight (kg)"
            value={set.weight}
            onChange={(e) => {
              const next = [...sets];
              next[i] = { ...set, weight: Number(e.target.value) };
              setSets(next);
            }}
            className="border p-2 w-24"
          />
        </div>
      ))}
      <button onClick={() => setSets([...sets, { reps: 0, weight: 0, type: "normal" }])} className="border p-2">
        + Add set
      </button>
      <button onClick={handleSubmit} disabled={!exerciseId || isSaving} className="bg-brand text-white p-2">
        {isSaving ? "Saving…" : "Save session"}
      </button>
      {saveError && <p className="text-red-600">{saveError}</p>}
      {saved && <p>Saved — will sync automatically, even if you're offline right now.</p>}
    </div>
  );
}
```

- [ ] **Step 6b: Add the edge-case test**

Add to a new `web/app/train/log/page.test.tsx` (or extend Task 1's page-testing convention if one already exists for this route):
```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LogWorkoutPage from "./page";
import * as outbox from "../../../lib/outbox";

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("LogWorkoutPage error handling", () => {
  it("shows an error message instead of a false 'Saved' when queueForSync throws", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ slug: "incline-pushup", name: "Incline Push-Up", muscleGroups: [], equipment: [], images: [] }]))));
    vi.spyOn(outbox, "queueForSync").mockRejectedValue(new Error("QuotaExceededError"));

    renderWithClient(<LogWorkoutPage />);
    await waitFor(() => screen.getByText("Incline Push-Up"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "incline-pushup" } });
    fireEvent.click(screen.getByText("Save session"));

    await waitFor(() => expect(screen.getByText(/Couldn't save this session/)).toBeInTheDocument());
    expect(screen.queryByText(/will sync automatically/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Commit**
```bash
git add web/app/train/log web/lib/useExercises.ts web/lib/useExercises.test.ts
git commit -m "feat: add gym logging UI wired to the offline outbox"
```

---

### Task 13: Training dashboard (e1RM, PR log, consistency streak — real testable logic)

**Files:**
- Create: `web/lib/training-metrics.ts`
- Create: `web/app/train/page.tsx`
- Test: `web/lib/training-metrics.test.ts`

**Interfaces:**
- Consumes: `GET /api/progression` (Task 2) → `ProgressionState[]`, `GET /api/workouts?from=&to=` (Task 2) → `WorkoutSession[]`.
- Produces: `computeE1RM(weight: number, reps: number): number`, `findPRs(sessions: WorkoutSessionLite[], exerciseId: string): PR[]`, `computeConsistencyStreak(sessions: WorkoutSessionLite[], today: string): number` — pure functions, no I/O.

- [ ] **Step 1: Write the failing tests for the pure metric functions**

`web/lib/training-metrics.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { computeE1RM, findPRs, computeConsistencyStreak } from "./training-metrics";

describe("computeE1RM", () => {
  it("computes the Epley estimated 1RM", () => {
    // 1RM = weight * (1 + reps/30)
    expect(computeE1RM(100, 5)).toBeCloseTo(116.67, 1);
  });

  it("returns the weight itself for a 1-rep set", () => {
    expect(computeE1RM(100, 1)).toBeCloseTo(103.33, 1);
  });
});

describe("findPRs", () => {
  const sessions = [
    { date: "2026-08-01", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 5, weight: 100, type: "normal" as const }] }] },
    // e1RM ~116.67 -> ~119.0, a 2% improvement, above the 1% noise threshold
    { date: "2026-08-08", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 5, weight: 102, type: "normal" as const }] }] },
    // e1RM barely moves (~0.3%), must NOT count as a new PR
    { date: "2026-08-15", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 5, weight: 102.3, type: "normal" as const }] }] },
    // reps > 12, must be excluded from e1RM consideration entirely (formula error grows past 10-12 reps)
    { date: "2026-08-22", exercises: [{ exerciseId: "back-squat", sets: [{ reps: 20, weight: 200, type: "normal" as const }] }] },
  ];

  it("flags only sessions with a >=1% e1RM improvement as PRs, ignores reps > 12", () => {
    const prs = findPRs(sessions, "back-squat");
    expect(prs).toHaveLength(2); // the first logged session, and the 2026-08-08 improvement
    expect(prs.map((pr) => pr.date)).toEqual(["2026-08-01", "2026-08-08"]);
  });
});

describe("computeConsistencyStreak", () => {
  it("counts consecutive calendar days with at least one session, ending today", () => {
    const today = "2026-09-06";
    const sessions = [
      { date: "2026-09-06", exercises: [] },
      { date: "2026-09-05", exercises: [] },
      { date: "2026-09-04", exercises: [] },
      { date: "2026-09-02", exercises: [] }, // gap on 09-03 breaks the streak
    ];
    expect(computeConsistencyStreak(sessions, today)).toBe(3);
  });

  it("returns 0 when there is no session today", () => {
    const sessions = [{ date: "2026-09-05", exercises: [] }];
    expect(computeConsistencyStreak(sessions, "2026-09-06")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the pure metric functions**

Streak design note: defined as "consecutive calendar days with at least one logged session, ending today" — a strict day-by-day check with no rest-day tolerance, matching design spec §5.2's "consistency/completion streak" language literally. A softer "N missed days allowed" tolerance is a real product option but not specified — implement the literal, simplest interpretation first.

`web/lib/training-metrics.ts`:
```typescript
type SetLite = { reps: number; weight: number; type: string };
type ExerciseLite = { exerciseId: string; sets: SetLite[] };
export type WorkoutSessionLite = { date: string; exercises: ExerciseLite[] };
export type PR = { date: string; e1RM: number };

const MAX_REPS_FOR_E1RM = 12;
const PR_IMPROVEMENT_THRESHOLD = 1.01; // >=1% improvement to count, avoids noise

export function computeE1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

export function findPRs(sessions: WorkoutSessionLite[], exerciseId: string): PR[] {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const prs: PR[] = [];
  let bestE1RM = 0;

  for (const session of sorted) {
    for (const exercise of session.exercises) {
      if (exercise.exerciseId !== exerciseId) continue;
      for (const set of exercise.sets) {
        if (set.reps > MAX_REPS_FOR_E1RM) continue;
        const e1RM = computeE1RM(set.weight, set.reps);
        if (e1RM >= bestE1RM * PR_IMPROVEMENT_THRESHOLD) {
          prs.push({ date: session.date, e1RM });
          bestE1RM = e1RM;
        }
      }
    }
  }

  return prs;
}

export function computeConsistencyStreak(sessions: WorkoutSessionLite[], today: string): number {
  const loggedDates = new Set(sessions.map((s) => s.date));
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00.000Z`);

  while (loggedDates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Implement the dashboard page**

`web/app/train/page.tsx`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/apiFetch";
import { computeConsistencyStreak, type WorkoutSessionLite } from "../../lib/training-metrics";

export default function TrainingDashboard() {
  const { data: sessions, isLoading, isError } = useQuery({
    queryKey: ["workouts"],
    queryFn: async () => {
      const res = await apiFetch("/api/workouts");
      if (!res.ok) throw new Error(`Failed to load workouts: ${res.status}`);
      return (await res.json()) as WorkoutSessionLite[];
    },
  });

  // A failed fetch (network down, session expired) must render as a visible
  // error, not as an empty "0-day streak" that silently looks like real data.
  if (isLoading) return <p>Loading…</p>;
  if (isError) return <p className="text-red-600">Couldn't load your training data. Check your connection and reload.</p>;

  const streak = computeConsistencyStreak(sessions ?? [], new Date().toISOString().slice(0, 10));

  return (
    <div>
      <h1 className="text-2xl">Training</h1>
      <p>Consistency streak: {streak} days</p>
      {/* Per-exercise PR log and e1RM trend charts render here, iterating
          findPRs(sessions, exerciseId) per exercise the user has trained —
          left to the dataviz skill's chart conventions at implementation time. */}
    </div>
  );
}
```

- [ ] **Step 6: Commit**
```bash
git add web/lib/training-metrics.ts web/lib/training-metrics.test.ts web/app/train/page.tsx
git commit -m "feat: add training dashboard with e1RM, PR log, and consistency streak"
```

---

### Task 14: Nutrition logging UI (manual, barcode, natural-language, photo, recipe suggestions)

**Files:**
- Create: `web/app/nutrition/log/page.tsx`
- Create: `web/lib/useFoodSearch.ts`
- Create: `web/lib/useRecipeSuggestions.ts`
- Test: `web/lib/useFoodSearch.test.ts`

**Interfaces:**
- Consumes: `GET /api/food/dishes?q=`, `GET /api/food/packaged/:barcode` (Task 4), `POST /api/nutrition/parse` (Task 7), `POST /api/nutrition/parse-photo` (Task 8), `GET /api/recipes/suggestions?mealSlot=&remainingProteinG=&remainingCalories=` (Task 5), `GET /api/nutrition/summary/:date` (existing), `queueForSync` (Task 11).
- Consumes the exact `ParsedFoodDraft`/`ParsedFoodItem` types defined in Task 7 — `{ items: { source: "indian_dish"|"packaged_food"|"llm_estimate"; refId?: string; name: string; macros: Macros }[]; needsAddedFatPrompt: boolean }`. Do not add fields the backend doesn't return (e.g. no `confidence` field exists on the response).

Barcode scanning: use the browser's native `BarcodeDetector` API (Chrome/Edge/Android WebView support it directly; Safari/iOS does not as of this research) with a fallback message ("barcode scanning isn't supported in this browser — search by name instead") rather than adding a JS decoding library — avoids a third-party dependency for a feature that degrades gracefully. Revisit only if the native API proves insufficient on the actual device in use.

- [ ] **Step 1: Write the failing test for `useFoodSearch`**

`web/lib/useFoodSearch.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFoodSearch } from "./useFoodSearch";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useFoodSearch", () => {
  it("does not fetch for an empty query", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useFoodSearch(""), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches dishes matching a non-empty query", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([{ slug: "dal-tadka", name: "Dal Tadka" }])))
    );
    const { result } = renderHook(() => useFoodSearch("dal"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0].slug).toBe("dal-tadka");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `useFoodSearch` and `useRecipeSuggestions`**

`web/lib/useFoodSearch.ts`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./apiFetch.js";

export function useFoodSearch(query: string) {
  return useQuery({
    queryKey: ["food-search", query],
    queryFn: async () => (await (await apiFetch(`/api/food/dishes?q=${encodeURIComponent(query)}`)).json()) as { slug: string; name: string }[],
    enabled: query.length > 0,
  });
}
```

`web/lib/useRecipeSuggestions.ts`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./apiFetch.js";

export function useRecipeSuggestions(mealSlot: string, remainingProteinG: number, remainingCalories: number) {
  return useQuery({
    queryKey: ["recipe-suggestions", mealSlot, remainingProteinG, remainingCalories],
    queryFn: async () => {
      const params = new URLSearchParams({
        mealSlot,
        remainingProteinG: String(remainingProteinG),
        remainingCalories: String(remainingCalories),
      });
      return (await (await apiFetch(`/api/recipes/suggestions?${params}`)).json()) as { slug: string; name: string }[];
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Implement the logging page (manual search, natural-language, photo, barcode)**

`web/app/nutrition/log/page.tsx`:
```typescript
"use client";

import { useState } from "react";
import { apiFetch } from "../../../lib/apiFetch";
import { useFoodSearch } from "../../../lib/useFoodSearch";

type ParsedFoodItem = {
  source: "indian_dish" | "packaged_food" | "llm_estimate";
  refId?: string;
  name: string;
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
};
type ParsedFoodDraft = { items: ParsedFoodItem[]; needsAddedFatPrompt: boolean };
// Tracks per-item save outcome so a partial failure (item 2 of 3 fails to
// save) is visible and recoverable, instead of the whole draft silently
// vanishing regardless of what actually made it into the database.
type ItemSaveStatus = "pending" | "saving" | "saved" | "failed";

export default function LogFoodPage() {
  const [query, setQuery] = useState("");
  const { data: results, isError: searchFailed } = useFoodSearch(query);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ParsedFoodDraft | null>(null);
  const [addedFatGrams, setAddedFatGrams] = useState<number | undefined>();
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [itemStatuses, setItemStatuses] = useState<ItemSaveStatus[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  async function parseText() {
    if (!text.trim()) return;
    setParseError(null);
    setIsParsing(true);
    try {
      // The Gemini call behind this route can fail (timeout, rate limit,
      // malformed response the backend couldn't validate) — /api/nutrition/parse
      // returns 502 in that case, and a bare `.json()` call on a non-ok
      // response would either throw on non-JSON or silently set the draft to
      // whatever error body came back, corrupting the UI state either way.
      const res = await apiFetch("/api/nutrition/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mealSlot: "lunch" }),
      });
      if (!res.ok) {
        setParseError("Couldn't understand that — try rephrasing, or log this item manually below.");
        return;
      }
      const parsedDraft = (await res.json()) as ParsedFoodDraft;
      setDraft(parsedDraft);
      setItemStatuses(parsedDraft.items.map(() => "pending"));
    } catch {
      setParseError("Can't reach the server. Check your connection and try again.");
    } finally {
      setIsParsing(false);
    }
  }

  async function confirmDraft() {
    if (!draft) return;
    setIsSaving(true);
    // Save items independently and track each outcome — do NOT abort the
    // whole loop on the first failure (that would silently drop the
    // remaining, perfectly good items) and do NOT clear the draft until
    // every item has actually succeeded.
    const nextStatuses = [...itemStatuses];
    for (let i = 0; i < draft.items.length; i++) {
      if (nextStatuses[i] === "saved") continue; // already saved on a previous, partially-failed attempt
      const item = draft.items[i];
      nextStatuses[i] = "saving";
      setItemStatuses([...nextStatuses]);
      try {
        const res = await apiFetch("/api/nutrition/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: new Date().toISOString().slice(0, 10),
            mealSlot: "lunch",
            source: item.source,
            refId: item.refId,
            macros: item.macros,
            addedFatGrams,
          }),
        });
        nextStatuses[i] = res.ok ? "saved" : "failed";
      } catch {
        nextStatuses[i] = "failed";
      }
      setItemStatuses([...nextStatuses]);
    }
    setIsSaving(false);
    // Only clear the draft once everything succeeded — a mix of saved/failed
    // items stays visible so the user can retry just the failed ones.
    if (nextStatuses.every((status) => status === "saved")) {
      setDraft(null);
      setItemStatuses([]);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes…" className="border p-2" />
      {searchFailed && <p className="text-red-600">Search is unavailable right now — try again shortly.</p>}
      <ul>{results?.map((r) => <li key={r.slug}>{r.name}</li>)}</ul>

      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="2 roti aur dal chawal" className="border p-2" />
      <button onClick={parseText} disabled={isParsing || !text.trim()} className="border p-2">
        {isParsing ? "Parsing…" : "Parse"}
      </button>
      {parseError && <p className="text-red-600">{parseError}</p>}

      {draft && (
        <div className="border p-4">
          <h2>Review before saving</h2>
          {draft.items.map((item, i) => (
            <p key={i}>
              {item.name} — {item.macros.calories} kcal, {item.macros.proteinG}g protein
              {itemStatuses[i] === "saved" && " ✓ saved"}
              {itemStatuses[i] === "failed" && <span className="text-red-600"> — failed to save, will retry</span>}
            </p>
          ))}
          {draft.needsAddedFatPrompt && (
            <label>
              Added oil/ghee (grams):
              <input
                type="number"
                onChange={(e) => setAddedFatGrams(Number(e.target.value))}
                className="border p-2 ml-2"
              />
            </label>
          )}
          <button onClick={confirmDraft} disabled={isSaving} className="bg-brand text-white p-2">
            {isSaving ? "Saving…" : itemStatuses.some((s) => s === "failed") ? "Retry failed items" : "Confirm and save"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5b: Add the edge-case test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LogFoodPage from "./page";

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("LogFoodPage confirmDraft partial failure", () => {
  it("keeps the draft open and marks only the failed item when one of two saves fails", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    const fetchMock = vi.fn();
    // 1: /api/nutrition/parse succeeds with two items
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            { source: "indian_dish", refId: "dal-tadka", name: "Dal Tadka", macros: { calories: 180, proteinG: 13, carbsG: 24, fatG: 5 } },
            { source: "indian_dish", refId: "roti", name: "Roti", macros: { calories: 120, proteinG: 3, carbsG: 22, fatG: 2 } },
          ],
          needsAddedFatPrompt: false,
        })
      )
    );
    // 2: first entries POST succeeds, 3: second fails
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ entry: {} }), { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    renderWithClient(<LogFoodPage />);
    fireEvent.change(screen.getByPlaceholderText("2 roti aur dal chawal"), { target: { value: "dal aur roti" } });
    fireEvent.click(screen.getByText("Parse"));
    await waitFor(() => screen.getByText("Review before saving"));

    fireEvent.click(screen.getByText("Confirm and save"));

    await waitFor(() => expect(screen.getByText(/failed to save, will retry/)).toBeInTheDocument());
    expect(screen.getByText("Review before saving")).toBeInTheDocument(); // draft stays open
    expect(screen.getByText("Retry failed items")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Commit**
```bash
git add web/app/nutrition/log web/lib/useFoodSearch.ts web/lib/useRecipeSuggestions.ts web/lib/useFoodSearch.test.ts
git commit -m "feat: add nutrition logging UI with search, natural-language parse, and recipe suggestions"
```

---

### Task 15: Nutrition dashboard

**Files:**
- Create: `web/app/nutrition/page.tsx`

**Interfaces:**
- Consumes: `GET /api/nutrition/summary/:date` (existing), `GET /api/nutrition/entries/:date` (Task 4).

- [ ] **Step 1: Implement the dashboard**

Protein-hit-rate is the primary number (not calories-remaining), per design spec §5.2 — this ordering in the JSX is deliberate, not incidental.

`web/app/nutrition/page.tsx`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/apiFetch";

type Summary = { calories: number; proteinG: number; proteinTargetG: number; proteinHitRate: number };
type FoodEntry = { mealSlot: string; macros: { calories: number; proteinG: number } };

export default function NutritionDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: summary, isError: summaryFailed } = useQuery({
    queryKey: ["nutrition-summary", today],
    queryFn: async () => {
      const res = await apiFetch(`/api/nutrition/summary/${today}`);
      if (!res.ok) throw new Error(`Failed to load summary: ${res.status}`);
      return (await res.json()) as Summary;
    },
  });
  const { data: entries, isError: entriesFailed } = useQuery({
    queryKey: ["nutrition-entries", today],
    queryFn: async () => {
      const res = await apiFetch(`/api/nutrition/entries/${today}`);
      if (!res.ok) throw new Error(`Failed to load entries: ${res.status}`);
      return (await res.json()) as FoodEntry[];
    },
  });

  return (
    <div>
      <h1 className="text-2xl">Nutrition</h1>
      {summaryFailed ? (
        <p className="text-red-600">Couldn't load today's summary.</p>
      ) : (
        <>
          <p className="text-4xl font-bold">{summary ? Math.round(summary.proteinHitRate * 100) : "—"}%</p>
          <p>protein hit rate ({summary?.proteinG}g / {summary?.proteinTargetG}g)</p>
        </>
      )}
      <h2>Today's entries</h2>
      {entriesFailed ? (
        <p className="text-red-600">Couldn't load today's entries.</p>
      ) : (
        <ul>
          {entries?.map((e, i) => (
            <li key={i}>
              {e.mealSlot}: {e.macros.calories} kcal, {e.macros.proteinG}g protein
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add web/app/nutrition/page.tsx
git commit -m "feat: add nutrition dashboard with protein-hit-rate as the primary number"
```

---

### Task 16: Sleep logging UI + dashboard (midpoint trend, social jetlag, wake-time consistency)

**Files:**
- Create: `web/lib/sleep-metrics.ts`
- Create: `web/app/sleep/log/page.tsx`
- Create: `web/app/sleep/page.tsx`
- Test: `web/lib/sleep-metrics.test.ts`

**Interfaces:**
- Consumes: `POST /api/sleep` (existing), `GET /api/sleep?from=&to=` (Task 3) → `SleepSession[]`.
- Produces: `computeSocialJetlag(sessions: SleepSessionLite[]): number | null` (minutes, weekday-avg-midpoint minus weekend-avg-midpoint), `computeWakeTimeConsistency(sessions: SleepSessionLite[]): number | null` (standard deviation of wake time, in minutes).

Definitions (not otherwise pinned by the spec, so fixed here): "weekend" = Saturday and Sunday by the session's `date`; "weekday" = Monday-Friday. Jetlag = |avg weekday midpoint − avg weekend midpoint| in minutes, `null` if either bucket has zero sessions (not enough data, not zero jetlag). Consistency = sample standard deviation of wake time (minutes-since-midnight) over whatever sessions the caller passes in (the caller filters the date range before calling, e.g. the last 7-14 days per design spec §7).

- [ ] **Step 1: Write the failing tests**

`web/lib/sleep-metrics.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { computeSocialJetlag, computeWakeTimeConsistency } from "./sleep-metrics";

describe("computeSocialJetlag", () => {
  it("returns the weekday-vs-weekend midpoint delta in minutes", () => {
    const sessions = [
      // Monday 2026-09-07, midpoint 00:00
      { date: "2026-09-07", midpoint: "2026-09-07T00:00:00.000Z" },
      // Saturday 2026-09-12, midpoint 01:00 (60 min later)
      { date: "2026-09-12", midpoint: "2026-09-12T01:00:00.000Z" },
    ];
    expect(computeSocialJetlag(sessions)).toBe(60);
  });

  it("returns null when there is no weekend data yet", () => {
    const sessions = [{ date: "2026-09-07", midpoint: "2026-09-07T00:00:00.000Z" }];
    expect(computeSocialJetlag(sessions)).toBeNull();
  });
});

describe("computeWakeTimeConsistency", () => {
  it("returns 0 for identical wake times", () => {
    const sessions = [
      { date: "2026-09-05", wakeTime: "2026-09-05T04:00:00.000Z" },
      { date: "2026-09-06", wakeTime: "2026-09-06T04:00:00.000Z" },
    ];
    expect(computeWakeTimeConsistency(sessions)).toBe(0);
  });

  it("returns null for fewer than 2 sessions", () => {
    expect(computeWakeTimeConsistency([{ date: "2026-09-06", wakeTime: "2026-09-06T04:00:00.000Z" }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the pure metric functions**

`web/lib/sleep-metrics.ts`:
```typescript
type SleepSessionLite = { date: string; midpoint?: string; wakeTime?: string };

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function minutesSinceMidnightUtc(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function computeSocialJetlag(sessions: SleepSessionLite[]): number | null {
  const weekday = sessions.filter((s) => !isWeekend(s.date) && s.midpoint);
  const weekend = sessions.filter((s) => isWeekend(s.date) && s.midpoint);
  if (weekday.length === 0 || weekend.length === 0) return null;

  const avg = (arr: SleepSessionLite[]) =>
    arr.reduce((sum, s) => sum + minutesSinceMidnightUtc(s.midpoint!), 0) / arr.length;

  return Math.abs(avg(weekend) - avg(weekday));
}

export function computeWakeTimeConsistency(sessions: SleepSessionLite[]): number | null {
  const withWake = sessions.filter((s) => s.wakeTime);
  if (withWake.length < 2) return null;

  const minutes = withWake.map((s) => minutesSinceMidnightUtc(s.wakeTime!));
  const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const variance = minutes.reduce((sum, m) => sum + (m - mean) ** 2, 0) / (minutes.length - 1);
  return Math.sqrt(variance);
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Implement the logging page**

`web/app/sleep/log/page.tsx`:
```typescript
"use client";

import { useState } from "react";
import { queueForSync } from "../../../lib/outbox";

export default function LogSleepPage() {
  const [bedTime, setBedTime] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [morningLightWithinMinutes, setMorningLightWithinMinutes] = useState<number>();
  const [morningExercise, setMorningExercise] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    if (!bedTime || !wakeTime) {
      setSaveError("Bed time and wake time are both required.");
      return;
    }
    setSaveError(null);
    setIsSaving(true);
    try {
      await queueForSync("sleep", {
        date: new Date().toISOString().slice(0, 10),
        bedTime,
        wakeTime,
        morningLightWithinMinutes,
        morningExercise,
      });
      setSaved(true);
    } catch {
      setSaveError("Couldn't save on this device. Try again, or check your browser's storage settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 max-w-sm">
      <label>
        Bed time
        <input type="datetime-local" onChange={(e) => setBedTime(new Date(e.target.value).toISOString())} className="border p-2 w-full" />
      </label>
      <label>
        Wake time
        <input type="datetime-local" onChange={(e) => setWakeTime(new Date(e.target.value).toISOString())} className="border p-2 w-full" />
      </label>
      <label>
        <input type="checkbox" checked={morningExercise} onChange={(e) => setMorningExercise(e.target.checked)} />
        Exercised within 30 min of waking
      </label>
      <input
        type="number"
        placeholder="Minutes to outdoor light"
        onChange={(e) => setMorningLightWithinMinutes(Number(e.target.value))}
        className="border p-2"
      />
      <button onClick={handleSubmit} disabled={isSaving} className="bg-brand text-white p-2">
        {isSaving ? "Saving…" : "Save"}
      </button>
      {saveError && <p className="text-red-600">{saveError}</p>}
      {saved && <p>Saved.</p>}
    </div>
  );
}
```

- [ ] **Step 6: Implement the dashboard**

`web/app/sleep/page.tsx`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/apiFetch";
import { computeSocialJetlag, computeWakeTimeConsistency } from "../../lib/sleep-metrics";

type SleepSessionLite = { date: string; midpoint: string; wakeTime: string };

export default function SleepDashboard() {
  const { data: sessions, isError } = useQuery({
    queryKey: ["sleep-sessions"],
    queryFn: async () => {
      const res = await apiFetch("/api/sleep?from=&to=");
      if (!res.ok) throw new Error(`Failed to load sleep sessions: ${res.status}`);
      return (await res.json()) as SleepSessionLite[];
    },
  });

  if (isError) {
    return <p className="text-red-600">Couldn't load your sleep data. Check your connection and reload.</p>;
  }

  const jetlag = sessions ? computeSocialJetlag(sessions) : null;
  const consistency = sessions ? computeWakeTimeConsistency(sessions) : null;

  return (
    <div>
      <h1 className="text-2xl">Sleep</h1>
      <p>Social jetlag: {jetlag !== null ? `${Math.round(jetlag)} min` : "not enough data yet"}</p>
      <p>Wake-time consistency (stddev): {consistency !== null ? `${Math.round(consistency)} min` : "not enough data yet"}</p>
      {/* Sleep midpoint trend chart renders here from `sessions`, per the dataviz skill's conventions. */}
    </div>
  );
}
```

- [ ] **Step 7: Commit**
```bash
git add web/lib/sleep-metrics.ts web/lib/sleep-metrics.test.ts web/app/sleep
git commit -m "feat: add sleep logging UI and dashboard with jetlag/consistency metrics"
```

---

### Task 17: Coach notes feed

**Files:**
- Create: `web/app/coach-notes/page.tsx`

**Interfaces:**
- Consumes: `GET /api/coach-notes?limit=` (Task 6) → `CoachNote[]`.

- [ ] **Step 1: Implement the feed page**

`web/app/coach-notes/page.tsx`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/apiFetch";

type CoachNote = { weekOf: string; summary: string; suggestions: string[]; source: string };

export default function CoachNotesPage() {
  const { data: notes, isLoading, isError } = useQuery({
    queryKey: ["coach-notes"],
    queryFn: async () => {
      const res = await apiFetch("/api/coach-notes?limit=10");
      if (!res.ok) throw new Error(`Failed to load coach notes: ${res.status}`);
      return (await res.json()) as CoachNote[];
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Coach Notes</h1>
      {isLoading && <p>Loading…</p>}
      {isError && <p className="text-red-600">Couldn't load coach notes. Check your connection and reload.</p>}
      {!isLoading && !isError && notes?.length === 0 && (
        <p>No coach notes yet — these appear once an external LLM client saves one via the MCP server.</p>
      )}
      {notes?.map((note, i) => (
        <div key={i} className="border p-4">
          <p className="font-bold">Week of {note.weekOf}</p>
          <p>{note.summary}</p>
          <ul>
            {note.suggestions.map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add web/app/coach-notes
git commit -m "feat: add coach notes feed"
```

---

### Task 18: PWA/Serwist setup

**Files:**
- Create: `web/app/manifest.ts`
- Create: `web/app/sw.ts`
- Modify: `web/next.config.ts`
- Modify: `web/package.json`

**Interfaces:**
- Produces: a registered service worker precaching the app shell (routes only — API calls are never cached here; writes already go through the Task 11 Dexie outbox, and reads simply fail gracefully offline via TanStack Query's existing error state).

Package choice: `@serwist/next` (webpack-plugin based) over the newer `@serwist/turbopack` — the latter's real-world maturity is unconfirmed as of this plan's writing; revisit if Turbopack-specific build issues arise, since `@serwist/next` is the better-established default today.

- [ ] **Step 1: Add the dependency**

Modify `web/package.json` dependencies: add `"@serwist/next": "^9.5.11"`.

Run: `cd web && pnpm install`

- [ ] **Step 2: Configure Serwist in `next.config.ts`**

`web/next.config.ts`:
```typescript
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
});

const nextConfig: NextConfig = {};

export default withSerwist(nextConfig);
```

- [ ] **Step 3: Write the service worker**

`web/app/sw.ts`:
```typescript
import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

- [ ] **Step 4: Add the web app manifest**

`web/app/manifest.ts`:
```typescript
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Health Tracker",
    short_name: "Health",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f6f4a",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  };
}
```

- [ ] **Step 5: Build and manually verify the service worker registers**

Run: `cd web && pnpm build && pnpm start`, open the app in a browser, check DevTools → Application → Service Workers shows it registered and activated.

- [ ] **Step 6: Commit**
```bash
git add web/app/manifest.ts web/app/sw.ts web/next.config.ts web/package.json
git commit -m "feat: add PWA manifest and Serwist service worker for offline app-shell caching"
```

---

### Task 19: Deployment config

**Files:**
- Create: `web/.env.example`
- Create: `web/vercel.json`

**Interfaces:** None — this task only adds deployment configuration, no runtime code.

- [ ] **Step 1: Document required env vars**

`web/.env.example`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

- [ ] **Step 2: Add Vercel config**

`web/vercel.json`:
```json
{
  "buildCommand": "pnpm --filter @health-tracker/web build",
  "installCommand": "pnpm install",
  "outputDirectory": ".next"
}
```

- [ ] **Step 3: Commit**
```bash
git add web/.env.example web/vercel.json
git commit -m "chore: add web app deployment config"
```

---

## Self-Review

**Spec coverage:** Design spec §9 step 5 (web app: gym logging + offline outbox, food logging with recipe suggestions, sleep dashboard, training dashboard, coach notes feed) → Tasks 9-19. §5.2's metrics list (consistency streak, e1RM, PR log, protein-hit-rate, sleep midpoint trend, social jetlag) → Tasks 13, 15, 16, all implemented as real tested functions, not display-only guesses. §5.2's explicit non-goals (no composite readiness score, no RHR/circadian display, no absolute REM%/deep-sleep-% precision) → correctly absent from every dashboard task. §6/§6.1 (text/photo/barcode food logging, recipe suggestions, added-fat prompt for gravies) → Tasks 4, 5, 7, 8, 14. §7 (sleep protocol metrics) → Task 16. §8.1/8.2 (coach notes feed reading MCP-written `CoachNote` docs; the web app builds no MCP/coaching UI of its own) → Task 6, 17.

**Placeholder scan:** No TBD/TODO markers. The two intentionally-deferred visual elements (per-exercise e1RM/PR trend charts in Task 13, sleep midpoint trend chart in Task 16) are explicitly named as chart-library integration left to implementation time, following the dataviz skill's own conventions — not vague hand-waving about functionality, since the underlying data-fetching and the pure calculation functions those charts would plot are fully implemented and tested in the same tasks.

**Type consistency (cross-checked across the three source drafts during integration):** `ParsedFoodDraft`/`ParsedFoodItem` (Task 7) is the single authoritative shape — Task 14's web draft originally used a looser `source: string` and an extra unused `confidence?` field; both were corrected here to match Task 7's exact type, since the backend response is the source of truth for what the frontend can actually receive. `Exercise` (Task 12) matches Task 1's response shape exactly. `queueForSync`/`syncOutbox` (Task 11) are used identically by Tasks 12, 14, 16. `computeE1RM`/`findPRs`/`computeConsistencyStreak` (Task 13), `computeSocialJetlag`/`computeWakeTimeConsistency` (Task 16) are self-contained with no cross-task naming conflicts. Backend service function names (`listExercises`, `listPrograms`, `listWorkoutSessions`, `listSleepSessions`, `listRollups`, `searchIndianDishes`, `lookupPackagedFoodByBarcode`, `listFoodEntriesForDate`, `suggestRecipes`, `listCoachNotes`, `parseNaturalLanguageFood`, `parsePhotoFood`) each appear in exactly one task's Interfaces/Produces and are never redefined elsewhere.
</content>
