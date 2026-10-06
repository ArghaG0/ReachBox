import { expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../backend/src/app.js";
import { testEnv } from "../helpers/env.js";

it("fails closed without an injected authenticated identity", async () => {
  const schedule = vi.fn();
  const response = await request(createApp({ env: testEnv(), schedule })).post("/api/emails/schedule").send({ userId: "spoofed" });
  expect(response.status).toBe(401);
  expect(response.body).toEqual({ error: "Unauthorized" });
  expect(schedule).not.toHaveBeenCalled();
});

it("returns the existing frontend schedule shape and credentialed CORS", async () => {
  const result = { campaignId: "campaign", total: 2, firstScheduledAt: "2026-10-07T10:00:00.000Z", lastScheduledAt: "2026-10-07T10:00:05.000Z" };
  const schedule = vi.fn().mockResolvedValue(result);
  const app = createApp({ env: testEnv(), schedule, authenticate: (_req, res, next) => { res.locals.userId = "owner"; next(); } });
  const response = await request(app).post("/api/emails/schedule").set("Origin", "http://localhost:5173").send({ subject: "Hello" });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(result);
  expect(response.headers["access-control-allow-credentials"]).toBe("true");
  expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  expect(schedule).toHaveBeenCalledWith("owner", { subject: "Hello" });
});

it("handles preflight before auth and returns JSON for malformed/oversized bodies", async () => {
  const app = createApp({ env: testEnv({ HTTP_BODY_LIMIT_BYTES: 20 }), schedule: vi.fn(), authenticate: (_req, res, next) => { res.locals.userId = "owner"; next(); } });
  expect((await request(app).options("/api/emails/schedule").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST")).status).toBe(204);
  const malformed = await request(app).post("/api/emails/schedule").set("Content-Type", "application/json").send("{");
  expect(malformed.status).toBe(400);
  expect(malformed.body).toEqual({ error: "Invalid JSON" });
  expect((await request(app).post("/api/emails/schedule").send({ text: "a".repeat(30) })).status).toBe(413);
});
