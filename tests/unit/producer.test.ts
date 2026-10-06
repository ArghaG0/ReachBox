import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createEmailProducer } from "../../backend/src/queue/emailQueue.js";
import { canonicalJobId } from "../../backend/src/queue/jobIdentity.js";
import { testEnv } from "../helpers/env.js";

it("chunks 1,001 jobs and recomputes nonnegative delays with stable IDs and tiny payloads", async () => {
  const addBulk = vi.fn().mockResolvedValue([]);
  const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000).mockReturnValueOnce(3000);
  const rows = Array.from({ length: 1001 }, () => {
    const id = randomUUID();
    return { id, jobId: canonicalJobId(id), scheduledAt: new Date(1500) };
  });
  await createEmailProducer({ addBulk }, testEnv(), now)(rows);
  expect(addBulk.mock.calls.map(([jobs]) => jobs.length)).toEqual([500, 500, 1]);
  expect(addBulk.mock.calls[0]![0][0]).toEqual({
    name: "send-email", data: { emailId: rows[0]!.id },
    opts: {
      jobId: `email-${rows[0]!.id}`, delay: 500, attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 3600 }, removeOnFail: false,
    },
  });
  expect(addBulk.mock.calls[2]![0][0].opts.delay).toBe(0);
});
