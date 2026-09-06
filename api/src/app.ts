import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import compression from "compression";
import { authRouter } from "./modules/auth/auth.routes.js";
import { healthEventsRouter } from "./modules/health-events/health-events.routes.js";
import { workoutsRouter } from "./modules/workouts/workouts.routes.js";
import { progressionRouter } from "./modules/workouts/progression.routes.js";
import { nutritionRouter } from "./modules/nutrition/nutrition.routes.js";
import { sleepRouter } from "./modules/sleep/sleep.routes.js";
import { rollupsRouter } from "./modules/rollups/rollups.routes.js";
import { referenceDataRouter } from "./modules/reference-data/reference-data.routes.js";
import { foodRouter } from "./modules/food/food.routes.js";
import { recipesRouter } from "./modules/recipes/recipes.routes.js";
import { coachNotesRouter } from "./modules/coach-notes/coach-notes.routes.js";
import { mountMcpServer } from "./mcp/server.js";
import { jsonErrorHandler } from "./lib/errorHandler.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { oauthServerProvider } from "./modules/oauth/oauthProvider.js";
import { getPublicBaseUrl } from "./lib/publicUrl.js";

export function createApp() {
  const app = express();
  // Twelve weeks of rollups is the largest response the dashboard asks for and
  // it gzips to roughly a fifth of its size, which is the difference between
  // instant and noticeable on gym wifi.
  app.use(compression());
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  // Personal health data must never sit in a shared cache. Everything under
  // /api is no-store by default; the two static reference routes opt back in
  // below, since the exercise and programme catalogues are seeded and public.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });

  const publiclyCacheable = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    next();
  };
  app.use("/api/exercises", publiclyCacheable);
  app.use("/api/programs", publiclyCacheable);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // A full OAuth 2.1 authorization server (RFC 8414 metadata, RFC 7591
  // dynamic client registration, authorization-code+PKCE, refresh rotation)
  // in front of the MCP endpoint below. This exists because Claude.ai/Desktop
  // and ChatGPT's own "add custom connector" screens both only accept OAuth —
  // neither has a field for a static bearer token — so a real connector adds
  // one of these AI vendors' servers as an OAuth client, not this app's code.
  // Mounted at the app root, not under /api: the OAuth spec requires
  // /.well-known/oauth-authorization-server and /authorize, /token, /register
  // to live at the root of this origin, unprefixed.
  app.use(
    mcpAuthRouter({
      provider: oauthServerProvider,
      issuerUrl: new URL(getPublicBaseUrl()),
      resourceServerUrl: new URL("/mcp", getPublicBaseUrl()),
      resourceName: "Ledger",
      scopesSupported: ["mcp"],
    })
  );

  app.use("/api/auth", authRouter);
  app.use("/api/health-events", healthEventsRouter);
  app.use("/api/workouts", workoutsRouter);
  app.use("/api/progression", progressionRouter);
  app.use("/api/nutrition", nutritionRouter);
  app.use("/api/sleep", sleepRouter);
  app.use("/api/rollups", rollupsRouter);
  app.use("/api/food", foodRouter);
  app.use("/api/recipes", recipesRouter);
  app.use("/api/coach-notes", coachNotesRouter);
  app.use("/api", referenceDataRouter);

  mountMcpServer(app);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(jsonErrorHandler);

  return app;
}
