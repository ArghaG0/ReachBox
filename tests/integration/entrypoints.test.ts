import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase, createOwner } from "../helpers/database.js";
import { startSmtp } from "../helpers/smtp.js";
import { testEnv } from "../helpers/env.js";
import { createRedis } from "../../backend/src/redis/connection.js";
import { createEmailQueue, createEmailProducer } from "../../backend/src/queue/emailQueue.js";
import { createScheduler } from "../../backend/src/services/scheduler.js";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function ready(child: ChildProcess, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 15000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Process exited before ${event}: ${code}`)); });
    child.stdout!.on("data", (data: Buffer) => {
      output += data.toString();
      if (output.includes(event)) { clearTimeout(timeout); resolve(); }
    });
  });
}

async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill(); });
}

it("starts API and worker independently; only the worker consumes queued mail", async () => {
  const db = await createTestDatabase();
  const smtp = await startSmtp();
  const env = testEnv({ DATABASE_URL: db.databaseUrl, REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379", PORT: await availablePort(), QUEUE_PREFIX: `test-${randomUUID()}` });
  const connection = createRedis(env, "producer");
  const queue = createEmailQueue(env, connection);
  let api: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  try {
    await queue.waitUntilReady();
    const user = await createOwner(db.prisma);
    const sender = await db.prisma.sender.create({ data: { userId: user.id, email: "sender@example.test", smtpHost: "127.0.0.1", smtpPort: smtp.port, smtpUser: "test", smtpPass: "test" } });
    const childEnv = { ...process.env, ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])) };
    api = spawn(process.execPath, ["backend/dist/server.js"], { env: childEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    await ready(api, "api_ready");
    expect((await fetch(`http://localhost:${env.PORT}/health`)).status).toBe(200);
    expect((await fetch(`http://localhost:${env.PORT}/api/emails/schedule`, { method: "POST" })).status).toBe(401);
    const result = await createScheduler({ prisma: db.prisma, env, enqueue: createEmailProducer(queue, env) })(user.id, {
      senderId: sender.id, subject: "Separate process", bodyHtml: "<p>Worker entrypoint</p>", recipients: ["recipient@example.test"], delaySeconds: 0, hourlyLimit: 3,
    });
    expect(await queue.getWorkers()).toHaveLength(0);
    expect(smtp.messages).toHaveLength(0);
    worker = spawn(process.execPath, ["backend/dist/worker.js"], { env: childEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    await ready(worker, "worker_ready");
    await expect.poll(async () => db.prisma.email.count({ where: { campaignId: result.campaignId, status: "sent" } }), { timeout: 10000 }).toBe(1);
    expect(smtp.messages).toHaveLength(1);
  } finally {
    await stop(worker);
    await stop(api);
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
    await smtp.close();
    await db.close();
  }
});
