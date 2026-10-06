import { Redis } from "ioredis";
import type { Env } from "../config/env.js";

export function createRedis(env: Env, role: "producer" | "worker"): Redis {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: role === "worker" ? null : 1,
    enableOfflineQueue: role === "worker",
    connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    ...(role === "producer" ? { commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS } : {}),
  });
  redis.on("error", () => console.error(JSON.stringify({ event: "redis_error", role })));
  return redis;
}
