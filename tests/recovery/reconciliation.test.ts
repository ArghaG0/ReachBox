import { expect, it, vi } from "vitest";
import { Worker, UnrecoverableError } from "bullmq";
import { reconcileEmails, createReconciler } from "../../backend/src/services/reconciliation.js";
import { transportJobId } from "../../backend/src/queue/jobIdentity.js";
import { queueFixture } from "../helpers/queueFixture.js";

it("restores missing jobs once, resets stale claims, and preserves fresh claims and sent records", async () => {
  const f = await queueFixture({ RECONCILIATION_BATCH_SIZE: 1 });
  try {
    const missing = await f.schedule(false, new Date(Date.now() + 60000));
    const stale = await f.schedule(false);
    const fresh = await f.schedule(false);
    const sent = await f.schedule(false);
    await f.db.prisma.email.update({ where: { id: stale.id }, data: { status: "sending", attempts: 1, updatedAt: new Date(Date.now() - f.env.STALE_CLAIM_MS - 1000) } });
    await f.db.prisma.email.update({ where: { id: fresh.id }, data: { status: "sending", attempts: 1 } });
    await f.db.prisma.email.update({ where: { id: sent.id }, data: { status: "sent", sentAt: new Date() } });
    await Promise.all([reconcileEmails(f.db.prisma, f.queue, f.env), reconcileEmails(f.db.prisma, f.queue, f.env)]);
    expect(await f.queue.getJob(transportJobId(missing.id))).toBeDefined();
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("scheduled");
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("sending");
    expect(await f.queue.getJob(transportJobId(sent.id))).toBeUndefined();
    const freshJob = (await f.queue.getJob(transportJobId(fresh.id)))!;
    expect(await freshJob.getState()).toBe("delayed");
    expect(await f.queue.getJobCounts("wait", "delayed")).toEqual({ wait: 1, delayed: 2 });
  } finally { await f.close(); }
});

it("does not reset a stale-looking claim with a live BullMQ lock", async () => {
  const f = await queueFixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    const row = await f.schedule();
    const send = vi.fn().mockImplementation(async () => { await gate; return { messageId: "live", previewUrl: null }; });
    const job = (await f.queue.getJob(transportJobId(row.id)))!;
    const completion = job.waitUntilFinished(f.events, 10000);
    f.start(send);
    await expect.poll(() => send.mock.calls.length).toBe(1);
    await f.db.prisma.email.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - f.env.STALE_CLAIM_MS - 1) } });
    expect((await reconcileEmails(f.db.prisma, f.queue, f.env)).reset).toBe(0);
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("sending");
    release();
    await completion;
  } finally { release(); await f.close(); }
});

it.each(["completed", "failed"] as const)("repairs a scheduled row behind a retained %s job", async (state) => {
  const f = await queueFixture({ JOB_ATTEMPTS: 1 });
  try {
    const row = await f.schedule();
    const job = (await f.queue.getJob(transportJobId(row.id)))!;
    const send = vi.fn().mockImplementation(async () => {
      if (state === "failed") throw new Error("SMTP failure");
      return { messageId: "done", previewUrl: null };
    });
    const done = job.waitUntilFinished(f.events, 10000).catch(() => undefined);
    const worker = f.start(send);
    await done;
    await worker.pause();
    await f.db.prisma.email.update({ where: { id: row.id }, data: { status: "scheduled", failedAttempts: 0 } });
    await reconcileEmails(f.db.prisma, f.queue, f.env);
    expect(await job.getState()).toBe("waiting");
    expect(send).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
});

it("preserves a consumed failure budget when the queue entry is lost", async () => {
  const f = await queueFixture();
  try {
    const row = await f.schedule(false);
    await f.db.prisma.email.update({ where: { id: row.id }, data: { failedAttempts: 3, error: "persisted failure" } });
    await reconcileEmails(f.db.prisma, f.queue, f.env);
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("failed");
    expect(await f.queue.getJob(transportJobId(row.id))).toBeUndefined();
  } finally { await f.close(); }
});

it("serializes reconciliation requests and repeats when an event arrives during a scan", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const scan = vi.fn().mockImplementationOnce(() => gate).mockResolvedValue(undefined);
  const run = createReconciler(scan);
  const first = run();
  const second = run();
  release();
  await Promise.all([first, second]);
  expect(scan).toHaveBeenCalledTimes(2);
});

it("uses a one-off delayed job to revisit a fresh abandoned claim", async () => {
  const f = await queueFixture({ STALE_CLAIM_MS: 1500, SMTP_SEND_TIMEOUT_MS: 500, SMTP_SOCKET_TIMEOUT_MS: 300 });
  try {
    const row = await f.schedule(false);
    const claimedAt = new Date();
    await f.db.prisma.email.update({ where: { id: row.id }, data: { status: "sending", attempts: 1, updatedAt: claimedAt } });
    await reconcileEmails(f.db.prisma, f.queue, f.env);
    const send = vi.fn().mockImplementation(async () => {
      expect(Date.now()).toBeGreaterThanOrEqual(claimedAt.getTime() + f.env.STALE_CLAIM_MS);
      return { messageId: "recovered-fresh", previewUrl: null };
    });
    const job = (await f.queue.getJob(transportJobId(row.id)))!;
    const done = job.waitUntilFinished(f.events, 10000);
    f.start(send);
    await done;
    expect(send).toHaveBeenCalledTimes(1);
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).failedAttempts).toBe(0);
  } finally { await f.close(); }
});

it("finalizes a sending row when BullMQ exhausts its stalled-job budget", async () => {
  const f = await queueFixture();
  let worker: Worker<{ emailId: string }, void> | undefined;
  try {
    const row = await f.schedule();
    const job = (await f.queue.getJob(transportJobId(row.id)))!;
    const done = job.waitUntilFinished(f.events, 10000).catch(() => undefined);
    worker = new Worker<{ emailId: string }, void>(f.env.EMAIL_QUEUE_NAME, async () => {
      await f.db.prisma.email.update({ where: { id: row.id }, data: { status: "sending", attempts: 1 } });
      throw new UnrecoverableError("job stalled more than allowable limit");
    }, { connection: f.workerRedis, prefix: f.env.QUEUE_PREFIX });
    await done;
    await reconcileEmails(f.db.prisma, f.queue, f.env);
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("failed");
    expect(await job.getState()).toBe("failed");
  } finally { await worker?.close(); await f.close(); }
});
