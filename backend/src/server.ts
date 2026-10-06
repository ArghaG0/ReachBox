import { loadEnv } from "./config/env.js";
import { createPrisma } from "./db/prisma.js";
import { createRedis } from "./redis/connection.js";
import { createEmailQueue, createEmailProducer } from "./queue/emailQueue.js";
import { createScheduler } from "./services/scheduler.js";
import { createApp } from "./app.js";

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
await prisma.$connect();
const redis = createRedis(env, "producer");
const queue = createEmailQueue(env, redis);
queue.on("error", () => console.error(JSON.stringify({ event: "queue_error" })));
const schedule = createScheduler({ prisma, env, enqueue: createEmailProducer(queue, env) });
const server = createApp({ env, schedule }).listen(env.PORT, () => {
  console.log(JSON.stringify({ event: "api_ready", port: env.PORT, auth: "closed_until_phase_8" }));
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await queue.close();
  redis.disconnect();
  await prisma.$disconnect();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void stop().catch(() => { process.exitCode = 1; }); });
}
