import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createRedis } from "../../backend/src/redis/connection.js";
import { createRateLimiter } from "../../backend/src/queue/rateLimiter.js";
import { testEnv } from "../helpers/env.js";

it("atomically counts concurrent calls, isolates senders, expires keys, and resets at boundaries", async () => {
  const env = testEnv({ REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379", RATE_KEY_PREFIX: "test-rate-" + randomUUID() });
  const redis = createRedis(env, "producer");
  const checkHourlyLimit = createRateLimiter(redis, env);
  const keys = ["a:3600000", "b:3600000", "a:7200000"].map((suffix) => env.RATE_KEY_PREFIX + ":" + suffix);
  try {
    const results = await Promise.all(Array.from({ length: 50 }, () => checkHourlyLimit({ senderId: "a", limit: 10, nowMs: 7199999 })));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    const denied = results.filter((r) => !r.allowed).sort((a, b) => a.overflowIndex - b.overflowIndex);
    expect(denied.map((r) => r.overflowIndex)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    for (const result of denied) expect(result.retryAt).toBe(7200000 + result.overflowIndex * env.MIN_SEND_DELAY_MS);
    expect(await redis.ttl(keys[0]!)).toBeGreaterThan(env.RATE_KEY_TTL_SECONDS - 10);
    expect(await redis.ttl(keys[0]!)).toBeLessThanOrEqual(env.RATE_KEY_TTL_SECONDS);
    await redis.expire(keys[0]!, 3600);
    await checkHourlyLimit({ senderId: "a", limit: 10, nowMs: 7199999 });
    expect(await redis.ttl(keys[0]!)).toBeLessThanOrEqual(3600);
    expect(await checkHourlyLimit({ senderId: "b", limit: 10, nowMs: 7199999 })).toMatchObject({ count: 1, allowed: true });
    expect(await checkHourlyLimit({ senderId: "a", limit: 10, nowMs: 7200000 })).toMatchObject({ count: 1, windowStart: 7200000, allowed: true });
  } finally {
    await redis.del(...keys);
    redis.disconnect();
  }
});

it("uses Redis TIME when no override is supplied", async () => {
  const env = testEnv({ REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379", RATE_KEY_PREFIX: "test-time-" + randomUUID() });
  const redis = createRedis(env, "producer");
  let key: string | undefined;
  try {
    const before = await redis.time();
    const result = await createRateLimiter(redis, env)({ senderId: "sender" });
    key = `${env.RATE_KEY_PREFIX}:sender:${result.windowStart}`;
    const after = await redis.time();
    expect(result.windowStart).toBeGreaterThanOrEqual(Math.floor(Number(before[0]) * 1000 / env.RATE_WINDOW_MS) * env.RATE_WINDOW_MS);
    expect(result.windowStart).toBeLessThanOrEqual(Math.floor(Number(after[0]) * 1000 / env.RATE_WINDOW_MS) * env.RATE_WINDOW_MS);
    expect(result.count).toBe(1);
  } finally {
    if (key) await redis.del(key);
    redis.disconnect();
  }
});
