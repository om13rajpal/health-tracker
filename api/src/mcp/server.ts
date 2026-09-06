import type { Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { z } from "zod";
import { getWeeklyDigest, saveCoachNote } from "./tools.js";
import { getDailyMacroSummary } from "../modules/nutrition/nutrition.service.js";
import { oauthServerProvider } from "../modules/oauth/oauthProvider.js";
import { getPublicBaseUrl } from "../lib/publicUrl.js";

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "health-tracker", version: "0.0.1" });

  server.registerTool(
    "get_weekly_digest",
    {
      description: "Get the weekly digest of workouts, nutrition, and sleep",
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
      description: "Get the daily macro summary for a given date",
      inputSchema: { date: z.string().describe("ISO date (YYYY-MM-DD)") },
    },
    async ({ date }) => {
      const summary = await getDailyMacroSummary(date);
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    }
  );

  server.registerTool(
    "save_coach_note",
    {
      description: "Save a coach note for a given week",
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
  // OAuth flow above (what Claude/ChatGPT's native connector UI uses), or the
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
