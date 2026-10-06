import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { canonicalJobId } from "../queue/jobIdentity.js";
import type { ScheduledJob } from "../queue/emailQueue.js";
import { scheduleSchema } from "../validation/emails.js";

export interface ScheduleResult {
  campaignId: string;
  total: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
}

export function createScheduler(deps: {
  prisma: PrismaClient;
  env: Env;
  enqueue: (emails: ScheduledJob[]) => Promise<void>;
  now?: () => number;
  logDispatchFailure?: (campaignId: string) => void;
}) {
  return async (userId: string, body: unknown): Promise<ScheduleResult> => {
    const input = scheduleSchema(deps.env).parse(body);
    const now = (deps.now ?? Date.now)();
    const start = Math.max(input.startAt ? Date.parse(input.startAt) : now, now);
    const last = start + (input.recipients.length - 1) * input.delaySeconds * 1000;
    if (!Number.isFinite(last) || !Number.isFinite(new Date(last).getTime())) {
      throw new HttpError(400, "Schedule exceeds the supported date range");
    }
    const campaignId = randomUUID();
    const emails = input.recipients.map((toEmail, index) => {
      const id = randomUUID();
      return {
        id, campaignId, userId, senderId: input.senderId,
        toEmail, subject: input.subject, bodyHtml: input.bodyHtml,
        status: "scheduled" as const, jobId: canonicalJobId(id),
        scheduledAt: new Date(start + index * input.delaySeconds * 1000),
      };
    });
    await deps.prisma.$transaction(async (tx) => {
      const sender = await tx.sender.findFirst({ where: { id: input.senderId, userId }, select: { id: true } });
      if (!sender) throw new HttpError(404, "Sender not found");
      await tx.campaign.create({ data: {
        id: campaignId, userId, senderId: input.senderId, subject: input.subject,
        bodyHtml: input.bodyHtml, startAt: new Date(start), delaySeconds: input.delaySeconds,
        hourlyLimit: input.hourlyLimit, total: emails.length,
      } });
      for (let offset = 0; offset < emails.length; offset += deps.env.QUEUE_BULK_SIZE) {
        await tx.email.createMany({ data: emails.slice(offset, offset + deps.env.QUEUE_BULK_SIZE) });
      }
    }, { timeout: deps.env.DATABASE_TRANSACTION_TIMEOUT_MS });

    try {
      await deps.enqueue(emails);
    } catch {
      (deps.logDispatchFailure ?? ((id) => console.error(JSON.stringify({ event: "campaign_dispatch_pending", campaignId: id }))))(campaignId);
    }
    return {
      campaignId, total: emails.length,
      firstScheduledAt: emails[0]!.scheduledAt.toISOString(),
      lastScheduledAt: emails[emails.length - 1]!.scheduledAt.toISOString(),
    };
  };
}
