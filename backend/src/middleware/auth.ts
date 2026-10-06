import type { RequestHandler } from "express";

// Phase 8 supplies the verified session. No header, environment variable, or
// request body can select an owner in the running API in the meantime.
export const requireAuth: RequestHandler = (_req, res) => {
  res.status(401).json({ error: "Unauthorized" });
};

declare global {
  namespace Express {
    interface Locals { userId?: string }
  }
}
