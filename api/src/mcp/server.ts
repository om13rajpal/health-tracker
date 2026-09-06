import type { Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { z } from "zod";
import { WorkoutSessionInputSchema, FoodEntryInputSchema, SleepSessionInputSchema } from "@health-tracker/shared";
import { getWeeklyDigest, saveCoachNote } from "./tools.js";
import { getDailyMacroSummary, logFoodEntry, listFoodEntriesForDate } from "../modules/nutrition/nutrition.service.js";
import {
  listWorkoutSessions,
  logWorkoutSession,
  updateProgressionTarget,
} from "../modules/workouts/workouts.service.js";
import { listSleepSessions, logSleepSession } from "../modules/sleep/sleep.service.js";
import { listRollups } from "../modules/rollups/rollups.service.js";
import { ProgressionState } from "../models/ProgressionState.js";
import { OAuthClient } from "../models/OAuthClient.js";
import { oauthServerProvider } from "../modules/oauth/oauthProvider.js";
import { getPublicBaseUrl } from "../lib/publicUrl.js";
import type { WriteAttribution } from "../lib/writeAttribution.js";

// Every registered tool receives this as its second argument. Its authInfo
// carries whatever verifyAccessToken returned for the caller's bearer token —
// the OAuth flow's clientId for a real Claude/ChatGPT connection, or the
// fixed label the static MCP_ACCESS_TOKEN path returns.
type ToolContext = { authInfo?: { clientId?: string } };

// "ChatGPT", "Claude" — whatever name the client gave itself at registration
// (see the register.js DCR flow, client_name), not the client_id itself,
// which is a UUID nobody wants to see on Today's dashboard.
async function attributionFor(extra: ToolContext): Promise<WriteAttribution | undefined> {
  const clientId = extra.authInfo?.clientId;
  if (!clientId) return undefined;
  if (clientId === "static-bearer-token") return { loggedVia: "mcp", loggedByClient: "a script" };
  const client = await OAuthClient.findOne({ clientId }).lean();
  const name = (client?.data as { client_name?: string } | undefined)?.client_name;
  return { loggedVia: "mcp", loggedByClient: name ?? "an AI assistant" };
}

const DateRangeShape = {
  from: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 30 days ago."),
  to: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
};

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "health-tracker", version: "0.0.1" });

  // ---------------------------------------------------------------- reads --

  server.registerTool(
    "get_weekly_digest",
    {
      description: "Get a summary of workouts logged, total protein, and sleep sessions logged for a given week",
      inputSchema: { weekOf: z.string().describe("ISO date (YYYY-MM-DD) of the Monday starting the week") },
    },
    async ({ weekOf }) => {
      const digest = await getWeeklyDigest(weekOf);
      return { content: [{ type: "text", text: JSON.stringify(digest) }] };
    }
  );

  server.registerTool(
    "get_nutrition_summary",
    {
      description: "Get the daily macro summary (calories, protein, carbs, fat, protein target) for a given date",
      inputSchema: { date: z.string().describe("ISO date (YYYY-MM-DD)") },
    },
    async ({ date }) => {
      const summary = await getDailyMacroSummary(date);
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    }
  );

  server.registerTool(
    "get_food_entries",
    {
      description: "Get every individual food entry logged for a given date, with per-item macros",
      inputSchema: { date: z.string().describe("ISO date (YYYY-MM-DD)") },
    },
    async ({ date }) => {
      const entries = await listFoodEntriesForDate(date);
      return { content: [{ type: "text", text: JSON.stringify(entries) }] };
    }
  );

  server.registerTool(
    "get_workouts",
    {
      description: "Get logged workout sessions in a date range, with every exercise, set, rep and weight",
      inputSchema: DateRangeShape,
    },
    async ({ from, to }) => {
      const sessions = await listWorkoutSessions(from, to);
      return { content: [{ type: "text", text: JSON.stringify(sessions) }] };
    }
  );

  server.registerTool(
    "get_sleep_sessions",
    {
      description: "Get logged sleep sessions in a date range, with bed time, wake time, midpoint and stages",
      inputSchema: DateRangeShape,
    },
    async ({ from, to }) => {
      const sessions = await listSleepSessions(from, to);
      return { content: [{ type: "text", text: JSON.stringify(sessions) }] };
    }
  );

  server.registerTool(
    "get_rollups",
    {
      description: "Get daily totals in a date range: steps, resting heart rate, weight, active/total calories",
      inputSchema: DateRangeShape,
    },
    async ({ from, to }) => {
      const rollups = await listRollups(from, to);
      return { content: [{ type: "text", text: JSON.stringify(rollups) }] };
    }
  );

  server.registerTool(
    "get_progression",
    {
      description:
        "Get the current training programme: per-exercise targets (load, rep range, phase) and progress toward the next increase",
      inputSchema: {},
    },
    async () => {
      const states = await ProgressionState.find({}).lean();
      return { content: [{ type: "text", text: JSON.stringify(states) }] };
    }
  );

  // --------------------------------------------------------------- writes --
  // Each write tool validates against the exact same Zod schema the web
  // app's own POST route uses, then calls the exact same service function —
  // so an AI-authored entry goes through the same progression-engine and
  // macro-total logic a human logging it through the form would, with no
  // separate, looser code path. Every write is tagged via attributionFor()
  // above so it is visibly distinguishable in the app from something logged
  // by hand, never presented as if the person did it themselves.

  server.registerTool(
    "log_workout",
    {
      description:
        "Log a completed workout session — exercises, sets, reps, weight and reps-in-reserve. Feeds the automatic progression engine the same way logging it in the app would.",
      inputSchema: WorkoutSessionInputSchema.shape,
    },
    async (input, extra) => {
      const attribution = await attributionFor(extra);
      const { session, progressionResults } = await logWorkoutSession(input, attribution);
      return { content: [{ type: "text", text: JSON.stringify({ session, progressionResults }) }] };
    }
  );

  server.registerTool(
    "log_food",
    {
      description: "Log a single food entry for a meal, with its macros",
      inputSchema: FoodEntryInputSchema.shape,
    },
    async (input, extra) => {
      const attribution = await attributionFor(extra);
      const entry = await logFoodEntry(input, attribution);
      return { content: [{ type: "text", text: JSON.stringify(entry) }] };
    }
  );

  server.registerTool(
    "log_sleep",
    {
      description: "Log a night's sleep — bed time, wake time, and morning light/exercise. Replaces any existing entry for the same date.",
      inputSchema: SleepSessionInputSchema.shape,
    },
    async (input, extra) => {
      const attribution = await attributionFor(extra);
      const session = await logSleepSession(input, attribution);
      return { content: [{ type: "text", text: JSON.stringify(session) }] };
    }
  );

  server.registerTool(
    "update_progression",
    {
      description:
        "Set a new training target for one exercise — load, rep range, or phase. This is how a new routine or programme change is applied; it does not touch the engine's own miss/deload counters.",
      inputSchema: {
        exerciseId: z.string().describe("Exercise slug, e.g. back-squat"),
        phase: z.enum(["bodyweight", "barbell"]).optional(),
        level: z.number().int().min(0).optional(),
        loadKg: z.number().min(0).optional(),
        increment: z.number().min(0).optional(),
        repRangeLow: z.number().int().min(1).optional(),
        repRangeHigh: z.number().int().min(1).optional(),
      },
    },
    async ({ exerciseId, ...patch }) => {
      const state = await updateProgressionTarget(exerciseId, patch);
      return { content: [{ type: "text", text: JSON.stringify(state) }] };
    }
  );

  server.registerTool(
    "save_coach_note",
    {
      description: "Save a coach note for a given week — a summary and suggestions, shown on the Coach page",
      inputSchema: {
        weekOf: z.string(),
        summary: z.string(),
        suggestions: z.array(z.string()),
        source: z.enum(["vendor_scheduled_task", "mcp_session"]),
        llmModel: z.string().optional(),
      },
    },
    async (input) => {
      const note = await saveCoachNote(input);
      return { content: [{ type: "text", text: JSON.stringify({ saved: true, id: note.id }) }] };
    }
  );

  return server;
}

export function mountMcpServer(app: Express) {
  // Accepts two credential kinds through one check: a token minted by the
  // OAuth flow (what Claude/ChatGPT's native connector UI uses), or the
  // long-lived MCP_ACCESS_TOKEN env var (what the mcp-remote bridge and this
  // app's own test suite use). oauthServerProvider.verifyAccessToken checks
  // the static token first, then falls back to the database.
  //
  // resourceMetadataUrl is what turns up in the WWW-Authenticate header on a
  // 401 — it's how Claude/ChatGPT discover where to start the OAuth flow the
  // first time they hit this endpoint with no token at all.
  app.post(
    "/mcp",
    requireBearerAuth({
      verifier: oauthServerProvider,
      requiredScopes: ["mcp"],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL("/mcp", getPublicBaseUrl())),
    }),
    async (req, res) => {
      const server = buildMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }
  );
}
