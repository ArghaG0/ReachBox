import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import { transportIdFromCanonical } from "./jobIdentity.js";

export interface EmailJobData { emailId: string }
export interface ScheduledJob { id: string; jobId: string; scheduledAt: Date }

export function createEmailQueue(env: Env, connection: Redis) {
  return new Queue<EmailJobData>(env.EMAIL_QUEUE_NAME, { connection, prefix: env.QUEUE_PREFIX });
}
export type EmailQueue = ReturnType<typeof createEmailQueue>;

export function createEmailProducer(queue: Pick<EmailQueue, "addBulk">, env: Env, now = Date.now) {
  return async (emails: ScheduledJob[]): Promise<void> => {
    for (let offset = 0; offset < emails.length; offset += env.QUEUE_BULK_SIZE) {
      const timestamp = now();
      await queue.addBulk(emails.slice(offset, offset + env.QUEUE_BULK_SIZE).map((email) => ({
        name: "send-email",
        data: { emailId: email.id },
        opts: {
          jobId: transportIdFromCanonical(email.jobId),
          delay: Math.max(0, email.scheduledAt.getTime() - timestamp),
          attempts: env.JOB_ATTEMPTS,
          backoff: { type: "exponential", delay: env.JOB_BACKOFF_MS },
          removeOnComplete: { age: env.COMPLETED_JOB_RETENTION_SECONDS },
          removeOnFail: false,
        },
      })));
    }
  };
}
