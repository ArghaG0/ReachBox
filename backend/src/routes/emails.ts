import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import type { ScheduleResult } from "../services/scheduler.js";

export type Schedule = (userId: string, body: unknown) => Promise<ScheduleResult>;
export function emailRoutes(schedule: Schedule) {
  const router = Router();
  router.post("/schedule", async (req, res) => {
    if (!res.locals.userId) throw new HttpError(401, "Unauthorized");
    res.status(201).json(await schedule(res.locals.userId, req.body));
  });
  return router;
}
