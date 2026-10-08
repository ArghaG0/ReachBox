import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import type { SendEmail } from "../services/mailer.js";
import { claimEmail, claimFilter } from "../services/emailState.js";
import type { EmailJobData } from "./emailQueue.js";
import { transportJobId } from "./jobIdentity.js";
import { createRateLimiter, type HourlyLimitInput, type HourlyLimitResult } from "./rateLimiter.js";

export type WorkerHooks = {
  checkHourlyLimit?: (input: HourlyLimitInput) => Promise<HourlyLimitResult>;
  onRateLimited?: (event: { senderId: string; limit: number; retryAt: number }) => void | Promise<void>;
  onEmailChanged?: (emailId: string) => void | Promise<void>;
};

async function sideEffect(event: string, action: () => void | Promise<void>) {
  try { await action(); }
  catch { console.error(JSON.stringify({ event: "email_hook_failed", hook: event })); }
}

async function delay(job: Job<EmailJobData>, timestamp: number, token?: string): Promise<never> {
  await job.moveToDelayed(timestamp, token);
  throw new DelayedError();
}

export function createEmailProcessor(prisma: PrismaClient, send: SendEmail, env: Env, connection: Redis, hooks: WorkerHooks = {}) {
  const checkHourlyLimit = hooks.checkHourlyLimit ?? createRateLimiter(connection, env);
  const changed = (id: string) => sideEffect("onEmailChanged", () => hooks.onEmailChanged?.(id));
  return async (job: Job<EmailJobData>, token?: string) => {
    if (job.id !== transportJobId(job.data.emailId)) throw new UnrecoverableError("Email job identity mismatch");
    const ownsLock = async () => Boolean(token) && await connection.get(job.queueQualifiedName + ":" + job.id + ":lock") === token;
    if (!await ownsLock()) throw new Error("Email job lock lost");
    let email = await prisma.email.findUniqueOrThrow({ where: { id: job.data.emailId } });
    if (email.status === "sent" || email.status === "failed") return;
    const now = Date.now();
    if (email.status === "sending") {
      const eligibleAt = email.updatedAt.getTime() + env.STALE_CLAIM_MS;
      if (eligibleAt > now) return delay(job, eligibleAt, token);
      await prisma.email.updateMany({
        where: { ...claimFilter(email.id, email.claimVersion), updatedAt: email.updatedAt },
        data: { status: "scheduled" },
      });
    }
    const claim = await claimEmail(prisma, email.id, new Date());
    if (!claim) {
      email = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
      if (email.status === "sent" || email.status === "failed") return;
      return delay(job, Math.max(email.scheduledAt.getTime(), email.updatedAt.getTime() + env.STALE_CLAIM_MS), token);
    }
    const where = claimFilter(claim.id, claim.claimVersion);
    const defer = async (retryAt: number, limited?: { senderId: string; limit: number }) => {
      const restored = await prisma.email.updateMany({ where, data: {
        status: "scheduled", scheduledAt: new Date(retryAt), attempts: { decrement: 1 },
      } });
      if (!restored.count) throw new Error("Email claim lost before deferral");
      await changed(claim.id);
      if (limited) await sideEffect("onRateLimited", () => hooks.onRateLimited?.({ ...limited, retryAt }));
      return delay(job, retryAt, token);
    };
    if (claim.scheduledAt.getTime() > Date.now()) return defer(claim.scheduledAt.getTime());
    if (claim.failedAttempts >= env.JOB_ATTEMPTS) {
      await prisma.email.updateMany({ where, data: { status: "failed", error: claim.error ?? "SMTP retry budget exhausted" } });
      await changed(claim.id);
      throw new UnrecoverableError("SMTP retry budget exhausted");
    }
    const loaded = await prisma.email.findUniqueOrThrow({ where: { id: claim.id }, include: { sender: true, campaign: true } });
    if (loaded.status !== "sending" || loaded.claimVersion !== claim.claimVersion) throw new Error("Email claim lost before SMTP");
    if (loaded.userId !== loaded.sender.userId || loaded.userId !== loaded.campaign.userId || loaded.senderId !== loaded.campaign.senderId) {
      await prisma.email.updateMany({ where, data: { status: "failed", error: "Email ownership mismatch" } });
      await changed(claim.id);
      throw new UnrecoverableError("Email ownership mismatch");
    }
    if (!await ownsLock()) throw new Error("Email job lock lost before SMTP");
    const limit = loaded.campaign.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    let admission;
    try {
      admission = await checkHourlyLimit({ senderId: loaded.senderId, limit });
    } catch (error) {
      await prisma.email.updateMany({ where, data: { status: "scheduled", attempts: { decrement: 1 } } });
      await changed(claim.id);
      throw error;
    }
    if (!admission.allowed) return defer(admission.retryAt, { senderId: loaded.senderId, limit });
    await changed(claim.id);
    if (!await ownsLock()) throw new Error("Email job lock lost before SMTP");
    let result;
    try {
      result = await send(loaded);
    } catch (error) {
      if (error instanceof DelayedError) throw error;
      const failures = claim.failedAttempts + 1;
      const terminal = failures >= env.JOB_ATTEMPTS;
      const reason = error instanceof Error ? error.message : "SMTP send failed";
      await prisma.email.updateMany({ where, data: {
        status: terminal ? "failed" : "scheduled",
        failedAttempts: failures, error: reason,
        scheduledAt: terminal ? claim.scheduledAt : new Date(Date.now() + env.JOB_BACKOFF_MS * 2 ** (failures - 1)),
      } });
      await changed(claim.id);
      if (terminal) throw new UnrecoverableError(reason);
      throw new Error(reason);
    }
    if (!await ownsLock()) throw new Error("Email job lock lost after SMTP");
    await prisma.email.updateMany({ where, data: {
      status: "sent", sentAt: new Date(), messageId: result.messageId,
      previewUrl: result.previewUrl, error: null,
    } });
    await changed(claim.id);
  };
}

export function createEmailWorker(env: Env, connection: Redis, prisma: PrismaClient, send: SendEmail, autorun = true, hooks: WorkerHooks = {}) {
  return new Worker<EmailJobData>(env.EMAIL_QUEUE_NAME, createEmailProcessor(prisma, send, env, connection, hooks), {
    connection, prefix: env.QUEUE_PREFIX, concurrency: env.WORKER_CONCURRENCY,
    // This limiter paces job starts queue-wide across workers, not SMTP completion times.
    limiter: { max: 1, duration: env.MIN_SEND_DELAY_MS },
    autorun, lockDuration: env.WORKER_LOCK_DURATION_MS,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS, maxStalledCount: env.WORKER_MAX_STALLED_COUNT,
  });
}
