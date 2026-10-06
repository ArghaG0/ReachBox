import { spawn, type ChildProcess } from "node:child_process";
import { expect, it } from "vitest";
import { queueFixture } from "../helpers/queueFixture.js";

function launch(env: Record<string, string | undefined>, args = ["backend/dist/worker.js"]) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout!.on("data", (data: Buffer) => { output += data.toString(); });
  child.stderr!.on("data", (data: Buffer) => { output += data.toString(); });
  return { child, output: () => output };
}

async function kill(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGKILL"); });
}

it("recovers a worker killed after claiming and does not resend after another restart", async () => {
  const f = await queueFixture({
    STALE_CLAIM_MS: 3000, SMTP_SEND_TIMEOUT_MS: 1500, SMTP_SOCKET_TIMEOUT_MS: 1000,
    WORKER_LOCK_DURATION_MS: 1000, WORKER_STALLED_INTERVAL_MS: 1000,
  });
  const env = { ...process.env, ...Object.fromEntries(Object.entries(f.env).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])) };
  let current: ReturnType<typeof launch> | undefined;
  try {
    const row = await f.schedule();
    current = launch(env, ["--import", "tsx", "tests/helpers/crash-worker.ts"]);
    await expect.poll(current.output, { timeout: 10000 }).toContain("crash_worker_ready");
    await expect.poll(current.output, { timeout: 10000 }).toContain("claim_acquired");
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("sending");
    await kill(current.child);
    current = launch(env);
    await expect.poll(current.output, { timeout: 10000 }).toContain("worker_ready");
    await expect.poll(async () => (await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).status, { timeout: 15000 }).toBe("sent");
    expect(f.smtp.messages).toHaveLength(1);
    await kill(current.child);
    current = launch(env);
    await expect.poll(current.output, { timeout: 10000 }).toContain("worker_ready");
    expect(f.smtp.messages).toHaveLength(1);
    expect((await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(2);
  } finally { await kill(current?.child); await f.close(); }
});

it("boot restores a committed campaign never dispatched to Redis", async () => {
  const f = await queueFixture();
  const env = { ...process.env, ...Object.fromEntries(Object.entries(f.env).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])) };
  let current: ReturnType<typeof launch> | undefined;
  try {
    const row = await f.schedule(false);
    current = launch(env);
    await expect.poll(current.output, { timeout: 10000 }).toContain("reconciliation_complete");
    await expect.poll(async () => (await f.db.prisma.email.findUniqueOrThrow({ where: { id: row.id } })).status, { timeout: 10000 }).toBe("sent");
    expect(f.smtp.messages).toHaveLength(1);
  } finally { await kill(current?.child); await f.close(); }
});