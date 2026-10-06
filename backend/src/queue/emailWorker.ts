import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import type { SendEmail } from "../services/mailer.js";
import { claimEmail, claimFilter } from "../services/emailState.js";
import type { EmailJobData } from "./emailQueue.js";
import { transportJobId } from "./jobIdentity.js";

async function delay(job: Job<EmailJobData>, timestamp: number, token?: string): Promise<never> {
  await job.moveToDelayed(timestamp, token);
  throw new DelayedError();
}

export function createEmailProcessor(prisma: PrismaClient, send: SendEmail, env: Env, connection: Redis) {
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
        where: { ...claimFilter(email.id, email.attempts), updatedAt: email.updatedAt },
        data: { status: "scheduled" },
      });
    }
    if (email.scheduledAt.getTime() > now) return delay(job, email.scheduledAt.getTime(), token);
    const claim = await claimEmail(prisma, email.id, new Date());
    if (!claim) {
      email = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
      if (email.status === "sent" || email.status === "failed") return;
      return delay(job, Math.max(email.scheduledAt.getTime(), email.updatedAt.getTime() + env.STALE_CLAIM_MS), token);
    }
    const where = claimFilter(claim.id, claim.attempts);
    if (claim.failedAttempts >= env.JOB_ATTEMPTS) {
      await prisma.email.updateMany({ where, data: { status: "failed", error: claim.error ?? "SMTP retry budget exhausted" } });
      throw new UnrecoverableError("SMTP retry budget exhausted");
    }
    const loaded = await prisma.email.findUniqueOrThrow({ where: { id: claim.id }, include: { sender: true, campaign: true } });
    if (loaded.status !== "sending" || loaded.attempts !== claim.attempts) throw new Error("Email claim lost before SMTP");
    if (loaded.userId !== loaded.sender.userId || loaded.userId !== loaded.campaign.userId || loaded.senderId !== loaded.campaign.senderId) {
      await prisma.email.updateMany({ where, data: { status: "failed", error: "Email ownership mismatch" } });
      throw new UnrecoverableError("Email ownership mismatch");
    }
    if (!await ownsLock()) throw new Error("Email job lock lost before SMTP");
    let result;
    try {
      result = await send(loaded);
    } catch (error) {
      const failures = claim.failedAttempts + 1;
      const terminal = failures >= env.JOB_ATTEMPTS;
      const reason = error instanceof Error ? error.message : "SMTP send failed";
      await prisma.email.updateMany({ where, data: {
        status: terminal ? "failed" : "scheduled",
        failedAttempts: failures, error: reason,
        scheduledAt: terminal ? claim.scheduledAt : new Date(Date.now() + env.JOB_BACKOFF_MS * 2 ** (failures - 1)),
      } });
      if (terminal) throw new UnrecoverableError(reason);
      throw new Error(reason);
    }
    if (!await ownsLock()) throw new Error("Email job lock lost after SMTP");
    await prisma.email.updateMany({ where, data: {
      status: "sent", sentAt: new Date(), messageId: result.messageId,
      previewUrl: result.previewUrl, error: null,
    } });
  };
}

export function createEmailWorker(env: Env, connection: Redis, prisma: PrismaClient, send: SendEmail, autorun = true) {
  return new Worker<EmailJobData>(env.EMAIL_QUEUE_NAME, createEmailProcessor(prisma, send, env, connection), {
    connection, prefix: env.QUEUE_PREFIX, concurrency: env.WORKER_CONCURRENCY,
    autorun, lockDuration: env.WORKER_LOCK_DURATION_MS,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS, maxStalledCount: env.WORKER_MAX_STALLED_COUNT,
  });
}
