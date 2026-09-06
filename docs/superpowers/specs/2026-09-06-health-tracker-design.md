# Personal Health Tracker — Design Spec

**Status:** Approved for implementation planning
**Owner:** Om Rajpal (single user, personal tool)
**Date:** 2026-09-06

## 1. Purpose and scope

A personal, single-user health tracker covering four domains that are currently
disconnected: strength training (with exercise recommendations), nutrition/macro
logging, Apple Health sync (workouts, sleep, steps, heart rate), and sleep/wake
schedule correction. Built as a real engineering project (proper architecture,
testing, caching) rather than a weekend script, but scoped to one user — no
multi-tenancy, no commercial concerns beyond respecting third-party data
licenses.

This is not a phased rollout. Every domain below is in scope for the same
build. The only ordering that exists is the mechanical dependency chain
(schema before endpoint, endpoint before UI) described in §9.

## 2. User context (why the design makes the choices it makes)

The user is 21, male, ~179cm, ~90–95kg, belly-dominant fat distribution,
lives in Hisar, Haryana, India. Vegetarian plus eggs and fried chicken. No
injuries, no medical conditions, occasional mild joint discomfort. Former
state-level athletics champion (sprinting), trained with weights for 2–3
months roughly 3–4 years ago, currently fully detrained. No gym access yet
(hostel, ~4 months until moving to own accommodation near a new job). Loves
dancing. Wants to train 7 days/week (some form of movement every day, not
lifting every day). Currently has Delayed Sleep-Wake Phase Disorder (sleeps
~5:30am, wakes ~noon). Already owns MuscleBlaze whey and creatine. Has a
pan, a pressure cooker, and an induction cooktop in the hostel room — real
cooking is possible, not just raw/boiled no-cook food.

Design consequences that follow directly from this profile:

- **Body recomposition (simultaneous fat loss + muscle gain) is the correct
  target, not a compromise.** This is the population (untrained, higher body
  fat) where recomposition is best supported by evidence. Targets are tuned
  for this, not a generic cut or bulk.
- **Trend-based weight and progress display, never single daily readings.**
  Daily scale weight is noise; the app must smooth it.
- **Exercise selection must default to accessible variations** (no
  gym-day-one assumptions like pull-ups or floor push-ups) and escalate via
  the progression engine, not assume a starting point.
- **Home/no-equipment program first, gym program is a mode switch**, not a
  separate app — the same progression state machine drives both.
- **Nutrition targets are protein-first**, not calorie-restriction-first,
  because protein is the lever that makes recomposition work and because
  restriction-first tracking is the most common reason diet apps get
  abandoned.
- **Indian home-cooked food is the primary nutrition case**, not a fallback —
  commercial food APIs are inadequate for this (see §6).
- **Sleep correction is a first-class feature**, not an afterthought pulled
  from Apple Health — it is diagnosed (DSWPD) and has its own protocol and
  metrics (see §7).
- **Consistency/adherence metrics are shown as prominently as performance
  metrics.** The user's stated primary risk is quitting, not
  under-training or under-eating precisely.

## 3. Non-goals

- No multi-user support, no team/social features.
- No attempt to build a commercial product. Third-party data licensing
  (Open Food Facts' ODbL) is still respected because it's good practice and
  keeps the option open, but no monetization is planned.
- No native Android app. iPhone + Apple Watch only (confirmed hardware).
- No attempt to make Apple Health sync real-time. Background delivery is
  OS-throttled; the design accepts near-real-time-when-active,
  multi-hour-worst-case-on-battery as a hard platform constraint.

## 4. System architecture

Monorepo, pnpm workspace, deliberately mirroring the user's existing
`finance-tracker` project's proven structure and conventions rather than
introducing new patterns to maintain solo.

```
health-tracker/
├── api/          Express 5 + Mongoose 9 + Zod + TypeScript (ESM), node-cron
├── web/          Next.js 16 (App Router) + TanStack Query + Tailwind +
│                 Serwist (PWA) + Dexie (IndexedDB offline outbox)
├── ios/          Swift/SwiftUI HealthKit bridge app (minimal UI)
└── shared/       Zod schemas / TS types shared by api + web; mirrored as
                  Swift Codable models in ios/ (kept in sync by hand — no
                  codegen initially, revisit if drift becomes a problem)
```

### 4.1 Stack decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Backend framework | Express 5 | Matches the user's existing finance-tracker exactly. A hypothetical throughput edge from Fastify is irrelevant at one-user scale and not worth a second framework to maintain. |
| ORM/ODM | Mongoose 9 | Same reasoning; also avoids Prisma, whose MongoDB support regressed in its v7 rewrite (legacy v6.19 required, no committed parity date as of research date). |
| Job scheduling | `node-cron`, no queue | The only async work is nightly rollups and weekly progression checks — fixed-schedule jobs, not job-queue workloads. Redis/BullMQ would be infrastructure for a problem that doesn't exist yet. `api/src/jobs/` exposes one small interface (`enqueue`/`schedule`) so BullMQ can be substituted later without touching call sites, if async LLM photo-parsing ever justifies it. |
| Frontend | Next.js 16 (App Router) | Current stable, matches finance-tracker's Next.js lineage. |
| Offline gym logging | Dexie (IndexedDB) outbox + Serwist PWA | iOS Safari has no Background Sync API — the real requirement ("don't lose a set typed on bad gym wifi") is a local-first-write problem solved by writing to IndexedDB immediately and replaying on reconnect, not a background-sync problem. A separate React Native/Expo app would double the maintenance surface to solve a problem already solved this way. |
| iOS bridge app | Native Swift/SwiftUI | Its entire job is `HKObserverQuery` + background delivery + `HKHealthStore.save()` for write-back. These are thin, direct OS APIs; reaching them through a React Native JS bridge (e.g. `@kingstinct/react-native-healthkit`) adds a dependency and a known-flakier background-delivery path for no benefit, since the app has almost no UI. |
| Auth | `iron-session` (signed/encrypted httpOnly cookie) | Single hardcoded user. Auth.js is in maintenance mode; Lucia is deprecated (its own maintainer now recommends hand-rolled sessions); Clerk solves a multi-user problem this app doesn't have. One env-stored password, constant-time comparison, rate-limited login route, `secure`/`sameSite=lax` cookie. |
| Database (dev) | Local MongoDB (already running via Homebrew) | Zero setup cost, matches finance-tracker's dev workflow. |
| Database (prod, when ready to deploy) | MongoDB Atlas M0 (free tier), separate project from finance-tracker | Health data volume is ~10–30MB/year — M0's 512MB is a decade-plus of headroom. Separate project/cluster from the finance tracker for credential and blast-radius isolation; still $0. |
| Deployment | Vercel (web, Hobby tier) + Render (api) | Matches finance-tracker's existing, already-debugged deploy pipeline (including its fork-based Render watch quirk, documented in that repo's CLAUDE.md) — reuse the pattern verbatim. |

### 4.2 Data flow: Apple Health sync

```
Apple Watch/iPhone sensors
  → HealthKit (on-device only — Apple has no server-side HealthKit API)
  → ios/ bridge app: HKObserverQuery + enableBackgroundDelivery
  → POST /api/health-events  (JWT/device-token authenticated)
  → ingestion adapter (normalizes payload → internal schema)
  → HealthSample / SleepSession / WorkoutSession (Mongo)
  → nightly rollup job → DailyRollup
```

The ingestion adapter is the one deliberately isolated seam in this design:
it is the only code that knows the shape of data coming from the current
sync source. If the sync source ever changes, only the adapter changes.
Nothing downstream — models, rollup jobs, API responses, UI — needs to know
or care what produced the normalized event.

Write-back (logging a workout or weight entry in the web app so it appears
in Apple Health) goes the same path in reverse: web app → API →
`POST /api/health-events/pending-writes` queued as a small polling
endpoint the iOS app checks on each foreground/background wake, which then
calls `HKHealthStore.save()`.

Background delivery latency is OS-controlled and cannot be engineered
around — accept near-instant while charging/active, multi-hour worst case
on battery. The UI must never imply real-time sync.

## 5. Data model

Mongoose models, one per file, under `api/src/models/`, following the
finance-tracker's existing convention.

| Model | Storage shape | Notes |
|---|---|---|
| `User` | Single document | One user. No multi-tenant fields. |
| `HealthSample` | **MongoDB time-series collection** (`timeField: "timestamp"`, `metaField: "metric"`) | Raw high-frequency points: heart rate, steps, active energy. Never manually bucketed — native time-series collections already bucket internally. |
| `DailyRollup` | Plain document, one per calendar day | Precomputed: total steps, sleep midpoint, resting HR, active/total calories, weight (if logged). Modeled directly on finance-tracker's `MonthlySummary` + `monthlyRollup.worker.ts` pattern, computed by a nightly `node-cron` job. |
| `SleepSession` | Plain document, one per night | Bed time, wake time, HealthKit stage breakdown (`inBed`/`awake`/`asleepCore`/`asleepDeep`/`asleepREM`), computed sleep midpoint, social-jetlag delta vs. 7-day weekday average. |
| `Exercise` | Plain document, seeded once | Seeded from `yuhonas/free-exercise-db` (876 exercises, public domain): name, muscle groups, equipment, images, and home-equivalent variant links (e.g. barbell bench press ↔ floor/incline push-up) added by hand for the exercises the home program uses. |
| `ProgramTemplate` | Plain document, seed data | Describes a program as data: phase (`bodyweight` \| `barbell`), exercises with rep ranges, dance/walk/run schedule slots. Home-Start Weeks 1–4 and the Gym Transition template are both seeded this way — changing the program is a data edit, not a deploy. |
| `ProgressionState` | Plain document, one per (user, exercise) pair | Drives the progression state machine (see §5.1): current level/load, consecutive-hits/misses counters, phase. |
| `WorkoutSession` | Plain document, embedded sets | `{ date, exercises: [{ exerciseId, sets: [{ reps, weight, rir, type: "warmup"|"normal"|"dropset"|"failure"|"amrap" }] }], readiness: { sleepHours, soreness, motivation } }`. Schema modeled on Hevy's public API set-type enum. |
| `IndianDish` | Plain document, seeded once | Seeded from the Indian Nutrient Databank (1,014 cooked dishes, per-serving macros) and IFCT 2017 (528 ingredient-level foods). This is the primary nutrition lookup table — see §6. |
| `PackagedFood` | Plain document, **own collection, never merged into `IndianDish`** | Open Food Facts data (barcode lookups, ~22,855 Indian products). Kept isolated because OFF is ODbL-licensed (share-alike) — merging it into a canonical table would obligate releasing the merged table under the same license. Irrelevant for personal use today, but costs nothing to keep clean and preserves the option to release this project later. |
| `FoodEntry` | Plain document, one per logged item | `{ date, mealSlot, source: "indian_dish"|"packaged_food"|"llm_estimate", refId?, macros, addedFatGrams? }`. `addedFatGrams` exists because oil/ghee is invisible in photo-based estimation and accounts for 30–50% of calorie variance in Indian gravies — the logging flow asks for it explicitly on gravy-type dishes rather than guessing. |
| `CoachNote` | Plain document, one per coaching session (scheduled or ad hoc) | `{ weekOf, digest: {...}, llmModel?, summary, suggestions: string[], source: "vendor_scheduled_task"|"mcp_session" }`. Written via the MCP server's `save_coach_note` tool by whichever LLM client called it — a vendor's own scheduled task (§8.3) or an on-demand chat (§8.2). Gives LLM-generated advice a permanent home in the app instead of disappearing into a chat transcript — see §8. |
| `Recipe` | Plain document, seeded + user-addable | `{ name, ingredients: [{ ifctRefId?, name, grams }], steps: string[], equipment: ("pan"|"pressure_cooker"|"induction")[], prepMinutes, macros, tags }`. Seeded with a curated set of tasty, high-protein, hostel-cookable Indian recipes matching the user's actual equipment (see §6.1). Macros computed at seed time from `IndianDish`/IFCT ingredient data, not re-estimated per serving. |

### 5.1 Progression engine (pseudocode, from research, to be implemented as-is)

Two modes sharing one shape (accumulate hits → advance; accumulate misses →
regress/deload), so the bodyweight→gym transition in month 2–3 is a mode
switch on `ProgressionState`, not a rebuild.

**Bodyweight phase — double progression:**
- Hit the top of the prescribed rep range, on all sets, at self-reported
  RIR ≤ 3, for 2 consecutive sessions → advance to the next harder
  variation.
- Any set below the bottom of the rep range for 3 consecutive sessions →
  regress one level.
- Anything in between (including a skipped session) → repeat the same
  level next time. No penalty for a single bad day.

**Barbell phase — linear load progression:**
- All prescribed reps hit → add fixed increment (+2.5kg upper body,
  +5kg squat/deadlift) next session.
- Reps missed → repeat same load, increment a miss counter.
- 3 consecutive misses → deload 10%, reset miss counter.

**Cross-cutting:**
- A daily subjective readiness input (`sleepHours`, `soreness 1–5`,
  `motivation 1–5`) adjusts *that day's target RIR* upward (stop further
  from failure) on a bad day — it never cancels or skips the session.
- A calendar-based deload runs automatically every 6 weeks regardless of
  performance, since 7-day/week training with inconsistent sleep can
  silently accumulate fatigue without ever technically "failing" a
  session.
- A skipped session changes no state at all. This is deliberate: the
  user's primary risk is quitting, and the algorithm must never punish
  missing a day in a way that discourages coming back.

### 5.2 Metrics: what to compute and show, what to skip

**Show prominently:** consistency/completion streak, hard sets per muscle
group per week, e1RM trend per main lift (Epley formula, computed only
from sets ≤10–12 reps — the formula's error grows past that), PR log with
a ≥1% e1RM threshold to avoid noise, sleep midpoint trend, social jetlag
score, protein-hit-rate (not calories-remaining) as the primary daily
nutrition number.

**Explicitly do not build:** a proprietary composite "readiness/recovery"
score (HRV/ACWR-style — weak validity in non-elite consumer contexts, and
ACWR specifically has documented methodological problems); RHR-nadir or
wrist-temperature as a "circadian phase" measurement (no consumer-device
validation study exists for either); absolute REM%/Deep-sleep-% precision
from Apple Watch (stage-level agreement with polysomnography is only
50–72% — trust sleep timing from the watch, not stage percentages).

## 6. Nutrition data sourcing

Commercial food APIs were evaluated and rejected for this use case:
Nutritionix removed its free/hobby tier entirely in 2026; Spoonacular's
terms restrict caching most data to one hour, incompatible with a
persistent food diary; Edamam's free tier is now vestigial and personal
non-commercial only; FatSecret's Indian dataset sits behind a paid Premier
tier, with free tiers restricted to US data. USDA FoodData Central and
Open Food Facts are free with no such restrictions but have negligible or
US-centric Indian dish coverage (USDA returns zero results for "sabzi").

**Chosen approach — seed local data, no ongoing API dependency for the
primary use case:**

- **`IndianDish`**: seeded once from the Indian Nutrient Databank (1,014
  cooked recipes, per-serving) and IFCT 2017 (528 ingredient-level foods,
  official ICMR-NIN data). Both are usable without licensing concern for a
  private, non-redistributed personal tool.
- **`PackagedFood`**: seeded from an Open Food Facts bulk export
  (~22,855 India-tagged products), refreshed periodically. Used for
  barcode scanning of packaged/junk food. Kept in its own collection per
  the ODbL note in §5.
- **Natural-language logging**: user's existing `GEMINI_API_KEY` parses
  free text ("2 roti aur dal chawal") against `IndianDish` first, falling
  back to `PackagedFood` then USDA generic entries. Modeled on the same
  "call an LLM, normalize, cache" shape as the finance-tracker's
  `merchant-llm-cleanup.ts`.
- **Photo logging**: same LLM pipeline, multimodal input. Expected error
  is real (~30–40% MAPE in published estimates) — the UI always shows
  parsed output as editable before saving, never commits an unreviewed
  estimate. For dishes tagged as gravies/curries, the flow explicitly asks
  about added oil/ghee rather than trusting the photo.

### 6.1 Recipe suggestions

The user has a pan, a pressure cooker, and an induction cooktop in the
hostel — real cooking, not just raw/no-cook logging. A separate
`Recipe` model (§5) is seeded with high-protein Indian recipes achievable
with exactly this equipment (sauté, shallow-fry, pressure-cook, boil — no
oven, no elaborate setup assumed): soya chunk masala, egg bhurji/curry,
dal tadka, paneer bhurji, vegetable stir-fry, besan chilla, etc. Seed
content is LLM-authored (Gemini, reusing the existing key) for variety and
then macro-corrected against `IndianDish`/IFCT ingredient data rather than
trusting the LLM's own macro estimate — taste and technique from the LLM,
nutrition numbers from the verified data source.

A lightweight suggestion function — same shape as the exercise
recommendation engine, not a separate system — filters `Recipe` by the
day's remaining protein/calorie budget and meal slot and returns ranked
matches. This directly targets the plan's #3 highest-ROI behavior change
(having a pre-decided, appealing answer ready instead of relying on
willpower against a 2am junk craving).

## 7. Sleep correction protocol

Diagnosis: Delayed Sleep-Wake Phase Disorder (consistent with ICSD-3
criteria — long-standing, ≥3 months, normal sleep quality when allowed to
sleep on the delayed schedule). Chronotherapy (progressively delaying
further around the clock) is explicitly excluded from the design — it has
a documented case of inducing non-24-hour free-running rhythm and is no
longer recommended by AASM.

**Protocol the app supports (~12–16 week horizon, matching the ~4-month
window before the user's schedule change is forced externally):**

- Fixed wake time, advanced ~20–30 minutes every 4–5 days, **including
  weekends** — weekend drift (social jetlag) is the single highest-risk
  failure mode for someone in this age group per the research, so the app
  treats weekday/weekend wake-time variance as a first-class tracked
  metric, not an afterthought.
- Morning outdoor light exposure logging (simple: did you get outside
  within ~30 minutes of waking, for how long) — Hisar's outdoor lux
  reliably exceeds clinical light-box standards, so no hardware purchase
  is needed or recommended.
- Morning exercise slot is protected in the training schedule (§2) partly
  *because* it doubles as a phase-advancing circadian signal, not only for
  fitness.
- Evening light dimming reminder in the last 2–3 hours before target
  bedtime.
- Melatonin logging is supported as an optional field (dose, time taken)
  but the app does not gate anything on it — true low-dose melatonin
  (0.5–1mg) is prescription-only in India at researched doses, so light +
  fixed wake time + morning exercise must work as a complete protocol on
  their own.

**Metrics shown:** sleep midpoint trend (primary), social jetlag score
(weekday vs. weekend midpoint delta), 7–14 day wake-time consistency
(standard deviation), morning-light and morning-exercise-timing compliance
logs, subjective morning energy rating (1–5, self-reported — wearables
cannot measure this and it's the original presenting complaint).

## 8. LLM coaching interface

The user wants an LLM (Claude, GPT, Gemini, etc.) to be able to review
progress and give suggestions — both on demand and automatically on a
weekly cadence — **without this codebase making any direct LLM API call**
(explicit user requirement: no `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`
coaching call from our own backend). Both mechanisms below live entirely
in the app's MCP surface; the "automatic" half runs on the LLM vendor's
own product infrastructure, not ours.

### 8.1 The MCP server (shared by both mechanisms)

`api/src/mcp/` mounts an MCP server on the existing Express app via the
Streamable HTTP transport, at `/mcp`, authenticated with a long-lived
personal access token distinct from the web session cookie (generated
once, pasted into whichever client config below). Read-only tools
(pre-aggregated, not raw dumps): `get_weekly_digest`,
`get_training_progress`, `get_nutrition_summary`, `get_sleep_summary`,
`list_recent_workouts`, `list_recent_meals`. One write tool,
`save_coach_note`, lets the calling LLM persist its conclusions into
`CoachNote` so a session's insight has a permanent home in the app
instead of only existing in that chat's transcript.

### 8.2 On demand: open a chat, any time

Add the MCP server URL + token to Claude or ChatGPT's connector settings
and ask about progress whenever. Verified current state (checked directly
against both vendors' help centers, 2026-09-06):

- **Claude**: custom remote MCP connectors work on the **Free plan**
  (limited to one custom connector) — [Claude Help Center, "Get started
  with custom connectors using remote MCP"]. This is the more reliable
  free path for on-demand use.
- **ChatGPT**: custom MCP apps are a real, existing feature ("Building
  your own app" in [OpenAI Help Center, "Apps in ChatGPT"] — build with
  MCP, connect ChatGPT to your own tools). Plan-gating for *building/
  connecting* a custom app specifically for personal (non-workspace)
  accounts is not spelled out as paid-only in the documentation.

### 8.3 Automatic: a weekly task, configured on the LLM vendor's side

No cron job in this codebase calls an LLM. Instead, the user configures a
recurring task directly in a vendor's own scheduling product, pointed at
the MCP server from §8.1, instructed to pull `get_weekly_digest` and call
`save_coach_note` with its findings. Verified current state:

- **ChatGPT Scheduled Tasks went free in August 2026** [OpenAI Help
  Center, "Scheduled tasks in ChatGPT"]: Free/Go get 3 active tasks,
  recurring no more than once/day, delivered in flexible windows (not
  exact times) — sufficient for a weekly digest. **Caveat:** the
  documentation's worked examples of a scheduled task using a connected
  app/tool are Gmail/Slack/GitHub, under *event-triggered* tasks, which
  explicitly require a paid plan (Plus/Pro/Business/Enterprise/Edu) and
  are unavailable on Free/Go. Plain time-based scheduled tasks (the free
  kind) are documented to "use supported apps... when available for your
  account," which plausibly extends to a connected custom MCP app, but no
  example confirms this exact combination. **Recommended first thing to
  try** — free, and the closest documented match to what's needed.
- **Claude (Cowork) scheduled/recurring tasks require a paid plan**
  (Pro/Max/Team/Enterprise) [Claude Help Center, "Schedule recurring
  tasks in Claude Cowork"] — even though Claude's MCP connector itself is
  free. Only relevant here if the user is already paying for Claude Pro
  or above.

**Practical instruction (not app code, a one-time setup step the user
performs):** try a ChatGPT free Scheduled Task against the MCP server
first, since it's the only currently-free path on either vendor; fall
back to Claude Cowork only if already on a paid Claude plan. If neither
free option reliably reaches the custom MCP tool in practice, the
fallback is manual — open the on-demand chat (§8.2) once a week — which
costs nothing and still uses the same MCP server unchanged.

## 9. Build sequence

Not phases with deferred features — a dependency-ordered build of the
single system described above.

1. Monorepo scaffold (`api`/`web`/`ios`/`shared`), shared Zod schemas.
2. Mongoose models (§5) + seed scripts: `free-exercise-db` → `Exercise`;
   INDB + IFCT 2017 → `IndianDish`; Open Food Facts export →
   `PackagedFood`; hand-authored `ProgramTemplate` documents for the home
   program and gym-transition program from the training research;
   LLM-authored, macro-corrected `Recipe` seed set (§6.1).
3. API: `iron-session` auth, `/api/health-events` ingestion endpoint +
   adapter, workout/nutrition/sleep CRUD routes, the progression engine
   (§5.1), recipe suggestion function, nightly rollup `node-cron` job,
   MCP server with its read tools and `save_coach_note` write tool
   (§8.1).
4. iOS bridge app: HealthKit read authorization, `HKObserverQuery` +
   background delivery, POST to the ingestion endpoint, write-back queue
   consumer, minimal status UI (last sync time, per-metric toggle).
5. Web app (built as one unit, not staged): gym logging UI with the Dexie
   offline outbox, food logging (text/photo/barcode) with recipe
   suggestions, sleep dashboard, training dashboard (progression state,
   PRs, consistency streak), nutrition dashboard (protein-hit-rate
   first), coach notes feed.

## 10. Testing strategy

Matches finance-tracker's existing setup: Vitest + `mongodb-memory-server`
+ supertest for the API (unit tests for the progression state machine are
high-value given its branching logic; integration tests for the ingestion
adapter and rollup job). Web: component tests for the offline outbox
(simulate offline write → reconnect → replay) since data loss there is the
one UI failure mode that would actually break trust in the app.

## 11. Open items / explicitly deferred decisions

None deferred as "future phases" — but these items require the user's own
action outside the codebase before certain features are usable:

- **Apple Developer Program enrollment ($99/yr)** is required for the
  Swift bridge app's background-delivery entitlement to run reliably
  beyond a 7-day free-signing window. This is a user action, not an
  engineering task.
- **Melatonin**, if the user wants it as part of the sleep protocol,
  requires a doctor's prescription in India at the researched effective
  dose. The app supports logging it either way; it does not depend on it.
- **Configuring the weekly automated coach (§8.3)** is a one-time manual
  step in the user's ChatGPT or Claude account settings (adding the MCP
  server URL + personal access token as a connector, then creating a
  recurring task there) — not something this codebase can provision for
  the user, since it lives entirely in the vendor's own product. Whether
  a free-tier scheduled task actually reaches a custom MCP tool in
  practice (as opposed to just being documented as plausible) should be
  verified by trying it once the MCP server is live, per the caveats in
  §8.3.
