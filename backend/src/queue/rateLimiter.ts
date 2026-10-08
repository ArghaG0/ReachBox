import { readFileSync } from "node:fs";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";

const script = readFileSync(new URL("./lua/hourlyLimit.lua", import.meta.url), "utf8");

export function calculateHourlyLimit(count: number, windowStart: number, limit: number, windowMs: number, minDelayMs: number) {
  const nextWindowStart = windowStart + windowMs;
  const overflowIndex = count - limit - 1;
  return {
    allowed: count <= limit, count, windowStart, nextWindowStart, overflowIndex,
    retryAt: nextWindowStart + overflowIndex * minDelayMs,
  };
}

export type HourlyLimitInput = { senderId: string; limit?: number; nowMs?: number };
export type HourlyLimitResult = ReturnType<typeof calculateHourlyLimit>;

export function createRateLimiter(redis: Redis, env: Env) {
  return async function checkHourlyLimit({ senderId, limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER, nowMs }: HourlyLimitInput): Promise<HourlyLimitResult> {
    if (!senderId || !Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid hourly limit input");
    if (nowMs !== undefined && (env.NODE_ENV !== "test" || !Number.isSafeInteger(nowMs) || nowMs < 0)) {
      throw new Error("Clock overrides are restricted to tests with nonnegative integer timestamps");
    }
    const [count, windowStart] = await redis.eval(
      script, 0, senderId, limit, env.RATE_WINDOW_MS, env.RATE_KEY_TTL_SECONDS, env.RATE_KEY_PREFIX, nowMs ?? "",
    ) as [number, number];
    return calculateHourlyLimit(count, windowStart, limit, env.RATE_WINDOW_MS, env.MIN_SEND_DELAY_MS);
  };
}
