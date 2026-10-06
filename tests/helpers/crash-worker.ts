import { loadEnv } from "../../backend/src/config/env.js";
import { createPrisma } from "../../backend/src/db/prisma.js";
import { createRedis } from "../../backend/src/redis/connection.js";
import { createEmailWorker } from "../../backend/src/queue/emailWorker.js";

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
const redis = createRedis(env, "worker");
const worker = createEmailWorker(env, redis, prisma, async () => {
  console.log("claim_acquired");
  await new Promise(() => {});
  return { messageId: "unreachable", previewUrl: null };
});
worker.on("error", () => {});
await worker.waitUntilReady();
console.log("crash_worker_ready");