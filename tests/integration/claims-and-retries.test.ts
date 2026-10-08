import { expect, it, vi } from "vitest";
import { claimEmail, claimFilter } from "../../backend/src/services/emailState.js";
import { reconcileEmails } from "../../backend/src/services/reconciliation.js";
import { transportJobId } from "../../backend/src/queue/jobIdentity.js";
import { queueFixture } from "../helpers/queueFixture.js";

it("allows one of 30 concurrent database claims and fences an older claim", async () => {
  const f = await queueFixture();
  try {
    const row = await f.schedule(false);
    const claims = await Promise.all(Array.from({ length: 30 }, () => claimEmail(f.db.prisma, row.id, new Date())));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    await f.db.prisma.email.update({ where: { id: row.id }, data: { status: "scheduled", attempts: { decrement: 1 } } });
    const second = await claimEmail(f.db.prisma, row.id, new Date());
    const stale = await f.db.prisma.email.updateMany({ where: claimFilter(row.id, first.claimVersion), data: { status: "sent" } });
    expect(stale.count).toBe(0);
    expect(second!.attempts).toBe(first.attempts);
    expect(second!.claimVersion).toBe(first.claimVersion + 1);
  } finally { await f.close(); }
});

it("restores scheduled status on a transient SMTP failure and retries successfully", async () => {
  const f = await queueFixture({ JOB_BACKOFF_MS: 300 });
  try {
    const row = await f.schedule();
    const send = vi.fn().mockRejectedValueOnce(new Error("temporary SMTP error")).mockResolvedValue({ messageId: "sent-id", previewUrl: "https://ethereal.email/message/test" });
    const job = (await f.queue.getJob(transportJobId(row.id)))!;
    const completion = job.waitUntilFinished(f.events, 10000);
    let retryStatus: string | undefined;
    const worker = f.start(send);
    worker.on("failed", () => {
      void f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } }).then((email) => { retryStatus = email.status; });
    });
    await completion;
    const sent = await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } });
    expect(retryStatus).toBe("scheduled");
    expect(sent).toMatchObject({ status: "sent", attempts: 2, failedAttempts: 1, messageId: "sent-id", error: null });
    expect(sent.sentAt).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  } finally { await f.close(); }
});

it("persists terminal failure and does not reset the SMTP budget during reconciliation", async () => {
  const f = await queueFixture();
  try {
    const row = await f.schedule();
    const send = vi.fn().mockRejectedValue(new Error("SMTP unavailable"));
    const job = (await f.queue.getJob(transportJobId(row.id)))!;
    const completion = job.waitUntilFinished(f.events, 10000);
    const failed = expect(completion).rejects.toThrow("SMTP unavailable");
    f.start(send);
    await failed;
    expect(await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "failed", failedAttempts: 3, error: "SMTP unavailable" });
    expect(await job.getState()).toBe("failed");
    await reconcileEmails(f.db.prisma, f.queue, f.env);
    expect(send).toHaveBeenCalledTimes(3);
    expect(await job.getState()).toBe("failed");
  } finally { await f.close(); }
});

it("runs two workers and skips replay even after the completed queue entry was removed", async () => {
  const f = await queueFixture();
  try {
    const row = await f.schedule();
    const send = vi.fn().mockResolvedValue({ messageId: "once", previewUrl: null });
    let job = (await f.queue.getJob(transportJobId(row.id)))!;
    const first = job.waitUntilFinished(f.events, 10000);
    f.start(send);
    f.start(send);
    await first;
    await job.remove();
    await f.enqueue([row]);
    job = (await f.queue.getJob(transportJobId(row.id)))!;
    await job.waitUntilFinished(f.events, 10000);
    expect(send).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
});

it("respects a persisted future timestamp even when the queue delay is stale", async () => {
  const f = await queueFixture();
  try {
    const row = await f.schedule();
    const due = Date.now() + 500;
    await f.db.prisma.email.update({ where: { id: row.id }, data: { scheduledAt: new Date(due) } });
    const send = vi.fn().mockImplementation(async () => {
      expect(Date.now()).toBeGreaterThanOrEqual(due);
      return { messageId: "later", previewUrl: null };
    });
    const job = (await f.queue.getJob(transportJobId(row.id)))!;
    const done = job.waitUntilFinished(f.events, 10000);
    f.start(send);
    await done;
    const stored = await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.attempts).toBe(1);
    expect(stored.failedAttempts).toBe(0);
    expect((await f.queue.getJob(job.id!))!.attemptsMade).toBe(1);
  } finally { await f.close(); }
});
