import { Worker } from "bullmq";
import { expect, it, vi } from "vitest";
import { createEmailProcessor } from "../../backend/src/queue/emailWorker.js";
import { createRateLimiter } from "../../backend/src/queue/rateLimiter.js";
import { transportJobId } from "../../backend/src/queue/jobIdentity.js";
import type { EmailJobData } from "../../backend/src/queue/emailQueue.js";
import { claimEmail } from "../../backend/src/services/emailState.js";
import { reconcileEmails } from "../../backend/src/services/reconciliation.js";
import { queueFixture } from "../helpers/queueFixture.js";

it.each([1, 2])("sends three and defers seven with exact offsets and intact budgets using %i workers", async (workers) => {
  const f = await queueFixture();
  try {
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push(await f.schedule(false));
    const send = vi.fn().mockResolvedValue({ messageId: "sent", previewUrl: null });
    const check = createRateLimiter(f.workerRedis, f.env);
    const windowMs = f.env.RATE_WINDOW_MS;
    let nowMs = Math.floor(Date.now() / windowMs) * windowMs + windowMs;
    const nextWindow = nowMs + windowMs;
    const onRateLimited = vi.fn().mockRejectedValue(new Error("Slack unavailable"));
    const onEmailChanged = vi.fn().mockRejectedValue(new Error("Search unavailable"));
    for (let i = 0; i < workers; i++) f.start(send, {
      checkHourlyLimit: (input) => check({ ...input, nowMs }), onRateLimited, onEmailChanged,
    });
    await f.enqueue(rows);
    await vi.waitFor(async () => {
      expect(await f.queue.getJobCounts("completed", "delayed")).toMatchObject({ completed: 3, delayed: 7 });
    }, { timeout: 10000 });
    expect(send).toHaveBeenCalledTimes(3);
    const deferred = await f.db.prisma.email.findMany({ where: { status: "scheduled" }, orderBy: { scheduledAt: "asc" } });
    expect(deferred).toHaveLength(7);
    for (const [i, row] of deferred.entries()) {
      expect(row.scheduledAt.getTime()).toBe(nextWindow + i * f.env.MIN_SEND_DELAY_MS);
      expect(row).toMatchObject({ attempts: 0, failedAttempts: 0, claimVersion: 1 });
      const job = (await f.queue.getJob(transportJobId(row.id)))!;
      expect(await job.getState()).toBe("delayed");
      expect(job.attemptsMade).toBe(0);
      const score = await f.producerRedis.zscore(f.queue.toKey("delayed"), job.id!);
      expect(Math.floor(Number(score) / 4096)).toBe(row.scheduledAt.getTime());
    }
    expect(onRateLimited).toHaveBeenCalledTimes(7);
    expect(onEmailChanged).toHaveBeenCalled();
    for (let window = 0; window < 3; window++) {
      nowMs += windowMs;
      const remaining = await f.db.prisma.email.findMany({ where: { status: "scheduled" } });
      await f.db.prisma.email.updateMany({ where: { status: "scheduled" }, data: { scheduledAt: new Date() } });
      for (const row of remaining) await (await f.queue.getJob(transportJobId(row.id)))!.promote();
      await vi.waitFor(async () => {
        expect(await f.queue.getJobCounts("completed", "delayed")).toMatchObject({ completed: Math.min(6 + window * 3, 10), delayed: Math.max(4 - window * 3, 0) });
      }, { timeout: 10000 });
    }
    expect(send).toHaveBeenCalledTimes(10);
    expect(await f.db.prisma.email.count({ where: { status: "sent", attempts: 1, failedAttempts: 0 } })).toBe(10);
  } finally { await f.close(); }
});

it("paces six job starts across two workers at approximately 500ms or more", async () => {
  const f = await queueFixture({ MIN_SEND_DELAY_MS: 500 });
  try {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(await f.schedule(false, null, 100));
    const starts: number[] = [];
    const send = vi.fn().mockResolvedValue({ messageId: "paced", previewUrl: null });
    for (let i = 0; i < 2; i++) f.start(send).on("active", () => starts.push(performance.now()));
    await f.enqueue(rows);
    await vi.waitFor(async () => { expect(await f.queue.getCompletedCount()).toBe(6); }, { timeout: 10000 });
    expect(starts).toHaveLength(6);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(450);
    expect(send).toHaveBeenCalledTimes(6);
  } finally { await f.close(); }
});

it("repairs a DB deferral committed before moveToDelayed fails", async () => {
  const f = await queueFixture();
  const manual = new Worker<EmailJobData>(f.env.EMAIL_QUEUE_NAME, null, { connection: f.workerRedis, prefix: f.env.QUEUE_PREFIX, autorun: false });
  try {
    const row = await f.schedule();
    const job = (await manual.getNextJob("test-lock"))!;
    const check = createRateLimiter(f.workerRedis, f.env);
    const nowMs = Math.floor(Date.now() / f.env.RATE_WINDOW_MS) * f.env.RATE_WINDOW_MS;
    for (let i = 0; i < 3; i++) await check({ senderId: row.senderId, limit: 3, nowMs });
    const send = vi.fn();
    const originalMove = vi.spyOn(job, "moveToDelayed").mockRejectedValueOnce(new Error("injected Redis transition failure"));
    await expect(createEmailProcessor(f.db.prisma, send, f.env, f.workerRedis, {
      checkHourlyLimit: (input) => check({ ...input, nowMs }),
    })(job, "test-lock")).rejects.toThrow("injected Redis transition failure");
    originalMove.mockRestore();
    const persisted = await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } });
    expect(persisted).toMatchObject({ status: "scheduled", attempts: 0, failedAttempts: 0 });
    expect(persisted.scheduledAt.getTime()).toBe(nowMs + f.env.RATE_WINDOW_MS);
    await job.moveToFailed(new Error("interrupted transition"), "test-lock", true);
    await manual.close();
    await reconcileEmails(f.db.prisma, f.queue, f.env);
    f.start(send);
    await vi.waitFor(async () => {
      const restored = (await f.queue.getJob(job.id!))!;
      expect(await restored.getState()).toBe("delayed");
      const score = await f.producerRedis.zscore(f.queue.toKey("delayed"), restored.id!);
      expect(Math.floor(Number(score) / 4096)).toBe(persisted.scheduledAt.getTime());
    }, { timeout: 10000 });
    expect(send).not.toHaveBeenCalled();
    expect(await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ attempts: 0, failedAttempts: 0 });
  } finally { await manual.close(); await f.close(); }
});

it("does not let a deferring worker overwrite a newer claim with the same attempt count", async () => {
  const f = await queueFixture();
  const manual = new Worker<EmailJobData>(f.env.EMAIL_QUEUE_NAME, null, { connection: f.workerRedis, prefix: f.env.QUEUE_PREFIX, autorun: false });
  try {
    const row = await f.schedule();
    const job = (await manual.getNextJob("fence-lock"))!;
    const send = vi.fn();
    let newerVersion: number | undefined;
    await expect(createEmailProcessor(f.db.prisma, send, f.env, f.workerRedis, {
      checkHourlyLimit: async () => {
        await f.db.prisma.email.update({ where: { id: row.id }, data: { status: "scheduled", attempts: { decrement: 1 } } });
        newerVersion = (await claimEmail(f.db.prisma, row.id, new Date()))!.claimVersion;
        return { allowed: false, count: 4, windowStart: 0, nextWindowStart: 3600000, overflowIndex: 0, retryAt: Date.now() + 3600000 };
      },
    })(job, "fence-lock")).rejects.toThrow("claim lost before deferral");
    expect(await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "sending", attempts: 1, claimVersion: newerVersion, scheduledAt: row.scheduledAt });
    expect(send).not.toHaveBeenCalled();
  } finally { await manual.close(); await f.close(); }
});
