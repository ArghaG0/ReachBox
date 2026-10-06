import { describe, expect, it } from "vitest";
import { envSchema } from "../../backend/src/config/env.js";
import { scheduleSchema } from "../../backend/src/validation/emails.js";
import { canonicalJobId, transportIdFromCanonical } from "../../backend/src/queue/jobIdentity.js";
import { testEnv } from "../helpers/env.js";

const senderId = "d3124589-1781-4d26-93de-8c4e90f4338a";
const payload = { senderId, subject: "Hello", bodyHtml: "<p>Hi</p>", recipients: ["a@example.com"], delaySeconds: 0 };

describe("configuration and schedule validation", () => {
  it("rejects missing tuning and unsafe production cookie settings", () => {
    expect(envSchema.safeParse({}).success).toBe(false);
    expect(() => testEnv({ WORKER_CONCURRENCY: 0 })).toThrow();
    expect(() => testEnv({ MAX_RECIPIENTS: 5001 })).toThrow();
    expect(() => testEnv({ NODE_ENV: "production" })).toThrow();
  });
  it("normalizes recipients, drops invalid addresses, and retains order", () => {
    const input = scheduleSchema(testEnv()).parse({ ...payload, recipients: [" A@Example.com ", "bad", "a@example.com", "b@example.com"] });
    expect(input.recipients).toEqual(["a@example.com", "b@example.com"]);
    expect(input.hourlyLimit).toBe(200);
  });
  it.each([
    { recipients: ["invalid"] }, { recipients: Array(5001).fill("a@example.com") },
    { delaySeconds: -1 }, { delaySeconds: Infinity }, { hourlyLimit: 0 },
    { hourlyLimit: 1.5 }, { subject: "Hello\r\nBcc: hidden@example.com" },
    { bodyHtml: "<p>&nbsp;</p>" }, { startAt: "not-a-date" },
  ])("rejects invalid input %j", (invalid) => {
    expect(scheduleSchema(testEnv()).safeParse({ ...payload, ...invalid }).success).toBe(false);
  });
  it("maps the approved canonical key without losing the UUID", () => {
    expect(transportIdFromCanonical(canonicalJobId(senderId))).toBe(`email-${senderId}`);
    expect(() => transportIdFromCanonical("arbitrary-key")).toThrow();
  });
});
