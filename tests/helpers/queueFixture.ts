import { randomUUID } from "node:crypto";
import { QueueEvents } from "bullmq";
import type { Env } from "../../backend/src/config/env.js";
import type { SendEmail } from "../../backend/src/services/mailer.js";
import { createRedis } from "../../backend/src/redis/connection.js";
import { createEmailQueue, createEmailProducer } from "../../backend/src/queue/emailQueue.js";
import { createEmailWorker } from "../../backend/src/queue/emailWorker.js";
import { createScheduler } from "../../backend/src/services/scheduler.js";
import { createTestDatabase, createOwner } from "./database.js";
import { startSmtp } from "./smtp.js";
import { testEnv } from "./env.js";

export async function queueFixture(overrides: Partial<Env> = {}) {
  const db = await createTestDatabase();
  const smtp = await startSmtp();
  const env = testEnv({
    DATABASE_URL: db.databaseUrl, REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379",
    QUEUE_PREFIX: "test-" + randomUUID(), JOB_BACKOFF_MS: 100, ...overrides,
  });
  const producerRedis = createRedis(env, "producer");
  const workerRedis = createRedis(env, "worker");
  const queue = createEmailQueue(env, producerRedis);
  const events = new QueueEvents(env.EMAIL_QUEUE_NAME, { connection: workerRedis, prefix: env.QUEUE_PREFIX });
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
  const owner = await createOwner(db.prisma);
  const sender = await db.prisma.sender.create({ data: {
    userId: owner.id, email: "sender@example.test", smtpHost: "127.0.0.1", smtpPort: smtp.port, smtpUser: "test", smtpPass: "test",
  } });
  const workers: ReturnType<typeof createEmailWorker>[] = [];
  const enqueue = createEmailProducer(queue, env);
  return {
    db, smtp, env, queue, events, producerRedis, workerRedis, enqueue,
    start(send: SendEmail) {
      const worker = createEmailWorker(env, workerRedis, db.prisma, send);
      worker.on("error", () => {});
      workers.push(worker);
      return worker;
    },
    async schedule(dispatch = true, scheduledAt: Date | null = null) {
      const result = await createScheduler({ prisma: db.prisma, env, enqueue: dispatch ? enqueue : async () => {} })(owner.id, {
        senderId: sender.id, subject: "Recovery", bodyHtml: "<p>Recovery verification</p>",
        recipients: [randomUUID() + "@example.test"], startAt: scheduledAt?.toISOString() ?? null, delaySeconds: 0, hourlyLimit: 3,
      });
      return db.prisma.email.findFirstOrThrow({ where: { campaignId: result.campaignId } });
    },
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      producerRedis.disconnect();
      workerRedis.disconnect();
      await smtp.close();
      await db.close();
    },
  };
}