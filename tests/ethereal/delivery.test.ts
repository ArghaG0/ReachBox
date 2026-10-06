import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { QueueEvents } from "bullmq";
import { createRedis } from "../../backend/src/redis/connection.js";
import { createEmailQueue, createEmailProducer } from "../../backend/src/queue/emailQueue.js";
import { createEmailWorker } from "../../backend/src/queue/emailWorker.js";
import { transportJobId } from "../../backend/src/queue/jobIdentity.js";
import { createScheduler } from "../../backend/src/services/scheduler.js";
import { createMailer } from "../../backend/src/services/mailer.js";
import { ensureEtherealSenders } from "../../backend/src/services/senders.js";
import { createTestDatabase, createOwner } from "../helpers/database.js";
import { testEnv } from "../helpers/env.js";

// Explicit opt-in command only. Ethereal captures these messages; it does not
// deliver to the synthetic recipient or any real person's inbox.
it("seeds two distinct Ethereal senders, reruns safely, and obtains a real preview", async () => {
  const db = await createTestDatabase();
  const env = testEnv({ QUEUE_PREFIX: `test-${randomUUID()}`, REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379" });
  const producerRedis = createRedis(env, "producer");
  const workerRedis = createRedis(env, "worker");
  const queue = createEmailQueue(env, producerRedis);
  const events = new QueueEvents(env.EMAIL_QUEUE_NAME, { connection: workerRedis, prefix: env.QUEUE_PREFIX });
  let worker: ReturnType<typeof createEmailWorker> | undefined;
  try {
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
    const user = await createOwner(db.prisma);
    const senders = await ensureEtherealSenders(db.prisma, user.id, 2);
    expect(senders).toHaveLength(2);
    expect(new Set(senders.map((sender) => sender.email)).size).toBe(2);
    expect(await ensureEtherealSenders(db.prisma, user.id, 2)).toHaveLength(2);
    const result = await createScheduler({ prisma: db.prisma, env, enqueue: createEmailProducer(queue, env) })(user.id, {
      senderId: senders[0]!.id, subject: "ReachBox Phase 2 verification", bodyHtml: "<p>Captured by Ethereal only.</p>",
      recipients: ["phase2@example.test"], startAt: null, delaySeconds: 0, hourlyLimit: 3,
    });
    const email = await db.prisma.email.findFirstOrThrow({ where: { campaignId: result.campaignId } });
    const job = await queue.getJob(transportJobId(email.id));
    const completion = job!.waitUntilFinished(events, 60000);
    worker = createEmailWorker(env, workerRedis, db.prisma, createMailer(env));
    await completion;
    const sent = await db.prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(sent.status).toBe("sent");
    expect(sent.previewUrl).toMatch(/^https:\/\/ethereal\.email\/message\//);
    expect(sent.messageId).toBeTruthy();
    console.log(JSON.stringify({ event: "ethereal_smoke_passed", previewUrl: sent.previewUrl }));
  } finally {
    await worker?.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    producerRedis.disconnect();
    workerRedis.disconnect();
    await db.close();
  }
});
