import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../backend/src/app.js";
import { createScheduler } from "../../backend/src/services/scheduler.js";
import { createTestDatabase, createOwner } from "../helpers/database.js";
import { testEnv } from "../helpers/env.js";

describe("scheduling against PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let userId: string;
  let senderId: string;
  const now = Date.parse("2026-10-07T10:00:00.000Z");
  const base = { subject: "Hello", bodyHtml: "<p>Body</p>", recipients: ["a@example.com"], startAt: null, delaySeconds: 5, hourlyLimit: 3 };
  beforeAll(async () => {
    db = await createTestDatabase();
    userId = (await createOwner(db.prisma)).id;
    senderId = (await db.prisma.sender.create({ data: {
      userId, email: "sender@example.test", smtpHost: "localhost", smtpPort: 2525, smtpUser: "test", smtpPass: "test",
    } })).id;
  });
  afterAll(async () => { await db?.close(); });

  it("returns the frontend DTO and persists normalized rows in one campaign", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const schedule = createScheduler({ prisma: db.prisma, env: testEnv(), enqueue, now: () => now });
    const app = createApp({ env: testEnv(), schedule, authenticate: (_req, res, next) => { res.locals.userId = userId; next(); } });
    const response = await request(app).post("/api/emails/schedule").send({ ...base, senderId, recipients: [" A@Example.com ", "bad", "a@example.com", "b@example.com"], startAt: "2020-01-01T00:00:00.000Z" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ campaignId: expect.any(String), total: 2, firstScheduledAt: new Date(now).toISOString(), lastScheduledAt: new Date(now + 5000).toISOString() });
    const rows = await db.prisma.email.findMany({ where: { campaignId: response.body.campaignId }, orderBy: { scheduledAt: "asc" } });
    expect(rows.map((row) => row.toEmail)).toEqual(["a@example.com", "b@example.com"]);
    expect(rows.every((row) => row.jobId === `email:${row.id}` && row.status === "scheduled")).toBe(true);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("rejects another owner's sender without writing or enqueueing", async () => {
    const enqueue = vi.fn();
    const other = await createOwner(db.prisma);
    const schedule = createScheduler({ prisma: db.prisma, env: testEnv(), enqueue });
    await expect(schedule(other.id, { ...base, senderId })).rejects.toMatchObject({ status: 404 });
    expect(await db.prisma.campaign.count({ where: { userId: other.id } })).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rolls the campaign back if inserting recipients fails", async () => {
    const enqueue = vi.fn();
    await db.prisma.$executeRawUnsafe(`ALTER TABLE "Email" ADD CONSTRAINT "test_reject_recipient" CHECK ("toEmail" <> 'reject@example.com')`);
    const count = await db.prisma.campaign.count();
    try {
      await expect(createScheduler({ prisma: db.prisma, env: testEnv(), enqueue })(userId, { ...base, senderId, recipients: ["reject@example.com"] })).rejects.toThrow();
      expect(await db.prisma.campaign.count()).toBe(count);
      expect(enqueue).not.toHaveBeenCalled();
    } finally {
      await db.prisma.$executeRawUnsafe(`ALTER TABLE "Email" DROP CONSTRAINT "test_reject_recipient"`);
    }
  });

  it("retains durable acceptance after a Redis dispatch failure", async () => {
    const logDispatchFailure = vi.fn();
    const schedule = createScheduler({ prisma: db.prisma, env: testEnv(), enqueue: vi.fn().mockRejectedValue(new Error("Redis down")), logDispatchFailure });
    const result = await schedule(userId, { ...base, senderId });
    expect(result.total).toBe(1);
    expect(await db.prisma.email.count({ where: { campaignId: result.campaignId, status: "scheduled" } })).toBe(1);
    expect(logDispatchFailure).toHaveBeenCalledWith(result.campaignId);
  });

  it("rejects dates that would overflow before beginning the transaction", async () => {
    const schedule = createScheduler({ prisma: db.prisma, env: testEnv(), enqueue: vi.fn() });
    await expect(schedule(userId, { ...base, senderId, recipients: ["a@example.com", "b@example.com"], delaySeconds: Number.MAX_VALUE })).rejects.toMatchObject({ status: 400 });
  });
});
