import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { envSchema, type Env } from "../../backend/src/config/env.js";

export function testEnv(overrides: Partial<Env> = {}): Env {
  return envSchema.parse({
    ...parse(readFileSync(new URL("../../backend/.env.example", import.meta.url))),
    NODE_ENV: "test", ...overrides,
  });
}
