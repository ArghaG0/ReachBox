import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { QueueEvents } from "bullmq";
import { createRedis } from "../../backend/src/redis/connection.js";
import { createEmailQueue, createEmailProducer } from "../../backend/src/queue/emailQueue.js";
import { createEmailWorker } from "../../backend/src/queue/emailWorker.js";
import { transportJobId } from "../../backend/src/queue/jobIdentity.js";
import { createScheduler } from "../../backend/src/services/scheduler.js";
import { createMailer } from "../../backend/src/services/mailer.js";
import { createTestDatabase, createOwner } from "../helpers/database.js";
import { startSmtp } from "../helpers/smtp.js";
import { testEnv } from "../helpers/env.js";

const env = testEnv({ QUEUE_PREFIX: `test-${randomUUID()}`, REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379", JOB_BACKOFF_MS: 20 });
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let smtp: Awaited<ReturnType<typeof startSmtp>>;
let userId: string;
let senderId: string;
const producerRedis = createRedis(env, "producer");
const workerRedis = createRedis(env, "worker");
const queue = createEmailQueue(env, producerRedis);
const events = new QueueEvents(env.EMAIL_QUEUE_NAME, { connection: workerRedis, prefix: env.QUEUE_PREFIX });
let worker: ReturnType<typeof createEmailWorker> | undefined;

beforeAll(async () => {
  db = await createTestDatabase();
  smtp = await startSmtp();
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
  userId = (await createOwner(db.prisma)).id;
  senderId = (await db.prisma.sender.create({ data: {
    userId, email: "sender@example.test", smtpHost: "127.0.0.1", smtpPort: smtp.port, smtpUser: "test", smtpPass: "test",
  } })).id;
});

afterAll(async () => {
  await worker?.close();
  await events.close();
  await queue.obliterate({ force: true }); // random test prefix only
  await queue.close();
  producerRedis.disconnect();
  workerRedis.disconnect();
  await smtp?.close();
  await db?.close();
});

it("enqueues 1,001 persistent delayed jobs with deterministic deduplication", async () => {
  const schedule = createScheduler({ prisma: db.prisma, env, enqueue: createEmailProducer(queue, env) });
  const startAt = new Date(Date.now() + 3600000).toISOString();
  const result = await schedule(userId, {
    senderId, subject: "Bulk", bodyHtml: "<p>Bulk body</p>",
    recipients: Array.from({ length: 1001 }, (_, i) => `load${i}@example.test`), startAt, delaySeconds: 0, hourlyLimit: 3,
  });
  const rows = await db.prisma.email.findMany({ where: { campaignId: result.campaignId } });
  expect(result.total).toBe(1001);
  expect(await queue.getDelayedCount()).toBe(1001);
  await createEmailProducer(queue, env)(rows);
  expect(await queue.getDelayedCount()).toBe(1001);
  const job = await queue.getJob(transportJobId(rows[0]!.id));
  expect(job?.data).toEqual({ emailId: rows[0]!.id });
  expect(job?.opts.attempts).toBe(3);
  expect(job?.opts.removeOnFail).toBe(false);
});

it("delivers through a real local SMTP socket and persists the sent result", async () => {
  const schedule = createScheduler({ prisma: db.prisma, env, enqueue: createEmailProducer(queue, env) });
  const start = Date.now() + 500;
  const result = await schedule(userId, {
    senderId, subject: "SMTP integration", bodyHtml: "<p>Hello from the queue</p>",
    recipients: ["recipient@example.test"], startAt: new Date(start).toISOString(), delaySeconds: 0, hourlyLimit: 3,
  });
  const row = await db.prisma.email.findFirstOrThrow({ where: { campaignId: result.campaignId } });
  const job = await queue.getJob(transportJobId(row.id));
  const completion = job!.waitUntilFinished(events, 10000);
  worker = createEmailWorker(env, workerRedis, db.prisma, createMailer(env));
  await completion;
  const sent = await db.prisma.email.findUniqueOrThrow({ where: { id: row.id } });
  expect(sent.status).toBe("sent");
  expect(sent.attempts).toBe(1);
  expect(sent.sentAt!.getTime()).toBeGreaterThanOrEqual(start);
  expect(sent.messageId).toBe(`<email-${row.id}@reachbox.local>`);
  expect(sent.previewUrl).toBeNull(); // Local SMTP is not Ethereal.
  expect(smtp.messages).toHaveLength(1);
  expect(smtp.messages[0]).toContain("Hello from the queue");
});
