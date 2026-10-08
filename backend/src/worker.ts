import { loadEnv } from "./config/env.js";
import { createPrisma } from "./db/prisma.js";
import { createRedis } from "./redis/connection.js";
import { createEmailWorker } from "./queue/emailWorker.js";
import { createEmailQueue } from "./queue/emailQueue.js";
import { createMailer } from "./services/mailer.js";
import { createReconciler, reconcileEmails } from "./services/reconciliation.js";

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
await prisma.$connect();
const redis = createRedis(env, "worker");
const queue = createEmailQueue(env, redis);
const worker = createEmailWorker(env, redis, prisma, createMailer(env), false);
const reconcile = createReconciler(async () => {
  const result = await reconcileEmails(prisma, queue, env);
  console.log(JSON.stringify({ event: "reconciliation_complete", ...result }));
});
let stopping = false;
const requestReconciliation = () => {
  if (!stopping) void reconcile().catch(() => {
    console.error(JSON.stringify({ event: "reconciliation_failed" }));
    void stop(1).catch(() => process.exit(1));
  });
};
queue.on("error", () => console.error(JSON.stringify({ event: "queue_error" })));
worker.on("error", () => console.error(JSON.stringify({ event: "worker_error" })));
worker.on("failed", () => requestReconciliation());
await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
redis.on("ready", requestReconciliation);
try {
  await reconcile();
  void worker.run().catch(() => { void stop(1).catch(() => process.exit(1)); });
  console.log(JSON.stringify({ event: "worker_ready", phase: 4, concurrency: env.WORKER_CONCURRENCY, minSendDelayMs: env.MIN_SEND_DELAY_MS }));
} catch {
  await stop(1);
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  redis.off("ready", requestReconciliation);
  const deadline = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
  deadline.unref();
  try {
    await worker.close();
    await reconcile();
    await queue.close();
    redis.disconnect();
    await prisma.$disconnect();
    process.exitCode = code;
  } finally {
    clearTimeout(deadline);
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void stop().catch(() => process.exit(1)); });
}
