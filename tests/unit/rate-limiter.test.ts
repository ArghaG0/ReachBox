import { expect, it } from "vitest";
import { calculateHourlyLimit, createRateLimiter } from "../../backend/src/queue/rateLimiter.js";
import type { Redis } from "ioredis";
import { testEnv } from "../helpers/env.js";

it("calculates exact next-window overflow offsets at the hour boundary", () => {
  expect(calculateHourlyLimit(3, 3600000, 3, 3600000, 2000).allowed).toBe(true);
  expect(calculateHourlyLimit(4, 3600000, 3, 3600000, 2000)).toMatchObject({ allowed: false, overflowIndex: 0, retryAt: 7200000 });
  expect(calculateHourlyLimit(10, 3600000, 3, 3600000, 2000)).toMatchObject({ overflowIndex: 6, retryAt: 7212000 });
});

it("rejects clock overrides outside tests before accessing Redis", async () => {
  const checkHourlyLimit = createRateLimiter({} as Redis, testEnv({ NODE_ENV: "development" }));
  await expect(checkHourlyLimit({ senderId: "sender", limit: 3, nowMs: 0 })).rejects.toThrow("restricted to tests");
});
