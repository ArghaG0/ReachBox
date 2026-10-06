import express, { type RequestHandler } from "express";
import cors from "cors";
import type { Env } from "./config/env.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { emailRoutes, type Schedule } from "./routes/emails.js";

export function createApp(deps: {
  env: Env;
  schedule: Schedule;
  // Composition-only injection for tests; server.ts never supplies a bypass.
  authenticate?: RequestHandler;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: new URL(deps.env.FRONTEND_URL).origin, credentials: true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", deps.authenticate ?? requireAuth);
  app.use(express.json({ limit: deps.env.HTTP_BODY_LIMIT_BYTES }));
  app.use("/api/emails", emailRoutes(deps.schedule));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
