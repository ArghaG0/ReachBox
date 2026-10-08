import request from "supertest";
import { expect, it, vi } from "vitest";
import { createApp } from "../../backend/src/app.js";
import { queueFixture } from "../helpers/queueFixture.js";

it("protects all dashboard subroutes, serves the authenticated UI/API, and preserves session auth", async () => {
  const f = await queueFixture({ BULL_BOARD_USER: "operator", BULL_BOARD_PASS: "test:password" });
  try {
    await f.schedule(true, new Date(Date.now() + 3600000));
    const app = createApp({ env: f.env, schedule: vi.fn(), queue: f.queue });
    for (const path of ["/admin/queues", "/admin/queues/", "/admin/queues/api/queues", "/admin/queues/static/main.js"]) {
      const denied = await request(app).get(path);
      expect(denied.status).toBe(401);
      expect(denied.headers["www-authenticate"]).toBe('Basic realm="Bull Board"');
      expect((await request(app).get(path).auth("operator", "wrong")).status).toBe(401);
      expect((await request(app).get(path).auth("wrong", "test:password")).status).toBe(401);
    }
    const ui = await request(app).get("/admin/queues/").auth("operator", "test:password");
    expect(ui.status).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
    const api = await request(app).get("/admin/queues/api/queues").auth("operator", "test:password");
    expect(api.status).toBe(200);
    expect(api.body.queues).toEqual(expect.arrayContaining([expect.objectContaining({ name: f.env.EMAIL_QUEUE_NAME })]));
    expect((await request(app).post("/admin/queues/api/queues/pause")).status).toBe(401);
    expect((await request(app).options("/admin/queues/api/queues").set("Origin", f.env.FRONTEND_URL).set("Access-Control-Request-Method", "POST")).status).toBe(401);
    expect((await request(app).post("/api/emails/schedule").auth("operator", "test:password").send({})).status).toBe(401);
  } finally { await f.close(); }
});

it("fails closed for missing or empty dashboard credentials", async () => {
  const f = await queueFixture();
  try {
    for (const pair of [
      { BULL_BOARD_USER: undefined, BULL_BOARD_PASS: "password" },
      { BULL_BOARD_USER: "operator", BULL_BOARD_PASS: undefined },
      { BULL_BOARD_USER: "", BULL_BOARD_PASS: "" },
    ]) {
      const app = createApp({ env: { ...f.env, ...pair }, schedule: vi.fn(), queue: f.queue });
      for (const path of ["/admin/queues/", "/admin/queues/api/queues"]) {
        expect((await request(app).get(path).auth("operator", "password")).status).toBe(503);
      }
    }
  } finally { await f.close(); }
});
