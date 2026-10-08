import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Env } from "../config/env.js";
import type { EmailQueue } from "../queue/emailQueue.js";

const hash = (value: string) => createHash("sha256").update(value).digest();

export function boardAuth(env: Env): RequestHandler {
  return (req, res, next) => {
    if (!env.BULL_BOARD_USER || !env.BULL_BOARD_PASS) {
      res.status(503).json({ error: "Queue dashboard credentials are not configured" });
      return;
    }
    const authorization = req.get("authorization") ?? "";
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    const credentials = match ? Buffer.from(match[1]!, "base64").toString("utf8") : "";
    const separator = credentials.indexOf(":");
    const user = separator < 0 ? "" : credentials.slice(0, separator);
    const password = separator < 0 ? "" : credentials.slice(separator + 1);
    const validUser = timingSafeEqual(hash(user), hash(env.BULL_BOARD_USER));
    const validPassword = timingSafeEqual(hash(password), hash(env.BULL_BOARD_PASS));
    if (!match || separator < 0 || !validUser || !validPassword) {
      res.set("WWW-Authenticate", 'Basic realm="Bull Board"').status(401).json({ error: "Queue dashboard authentication required" });
      return;
    }
    next();
  };
}

export function adminRoutes(queue: EmailQueue, env: Env) {
  const adapter = new ExpressAdapter();
  adapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(queue)], serverAdapter: adapter });
  const router = Router();
  router.use(boardAuth(env));
  router.use(adapter.getRouter());
  return router;
}
