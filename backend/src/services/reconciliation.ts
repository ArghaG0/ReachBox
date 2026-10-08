import type { PrismaClient } from "@prisma/client";
import type { Env } from "../config/env.js";
import { createEmailProducer, type EmailQueue } from "../queue/emailQueue.js";
import { transportIdFromCanonical } from "../queue/jobIdentity.js";
import { claimFilter } from "./emailState.js";

export async function reconcileEmails(prisma: PrismaClient, queue: EmailQueue, env: Env) {
  const enqueue = createEmailProducer(queue, env);
  const redis = await queue.client;
  let cursor: string | undefined;
  const result = { scanned: 0, restored: 0, reset: 0, failed: 0 };
  while (true) {
    const rows = await prisma.email.findMany({
      where: { status: { in: ["scheduled", "sending"] } },
      orderBy: { id: "asc" }, take: env.RECONCILIATION_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      result.scanned++;
      const jobId = transportIdFromCanonical(row.jobId);
      const job = await queue.getJob(jobId);
      const state = job ? await job.getState() : "unknown";
      if (state === "active" && await redis.get(queue.toKey(jobId + ":lock"))) continue;
      if (state === "failed" && job?.failedReason.includes("stalled more than allowable limit")) {
        const changed = await prisma.email.updateMany({
          where: { id: row.id, status: row.status, claimVersion: row.claimVersion, updatedAt: row.updatedAt },
          data: { status: "failed", error: job.failedReason },
        });
        result.failed += changed.count;
        continue;
      }
      const fresh = row.status === "sending" && row.updatedAt.getTime() + env.STALE_CLAIM_MS > Date.now();
      if (fresh) {
        if (!job || state === "unknown") {
          await enqueue([{ ...row, scheduledAt: new Date(Math.max(row.scheduledAt.getTime(), row.updatedAt.getTime() + env.STALE_CLAIM_MS)) }]);
          result.restored++;
        } else if (state === "completed" || state === "failed") {
          try { await job.retry(state, { resetAttemptsMade: true }); }
          catch (error) { if (await job.getState() === state) throw error; }
        }
        continue;
      }
      if (row.failedAttempts >= env.JOB_ATTEMPTS) {
        const changed = await prisma.email.updateMany({
          where: { id: row.id, status: row.status, claimVersion: row.claimVersion, updatedAt: row.updatedAt },
          data: { status: "failed", error: row.error ?? job?.failedReason ?? "SMTP retry budget exhausted" },
        });
        result.failed += changed.count;
        continue;
      }
      if (row.status === "sending") {
        const changed = await prisma.email.updateMany({
          where: { ...claimFilter(row.id, row.claimVersion), updatedAt: row.updatedAt },
          data: { status: "scheduled" },
        });
        if (!changed.count) continue;
        result.reset++;
      }
      if (!job || state === "unknown") {
        await enqueue([row]);
        result.restored++;
      } else if (state === "completed" || state === "failed") {
        try {
          await job.retry(state, { resetAttemptsMade: true });
          result.restored++;
        } catch (error) {
          if (await job.getState() === state) throw error;
        }
      }
    }
    cursor = rows[rows.length - 1]!.id;
  }
  return result;
}

export function createReconciler(run: () => Promise<unknown>) {
  let pending = false;
  let running: Promise<void> | undefined;
  return () => {
    pending = true;
    running ??= (async () => {
      try {
        while (pending) { pending = false; await run(); }
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
}
