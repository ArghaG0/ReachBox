import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const positiveInt = z.coerce.number().int().positive().safe();
const optionalText = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: positiveInt.max(65535),
  FRONTEND_URL: z.string().url(),
  BACKEND_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(["true", "false"]).transform((value) => value === "true"),
  DATABASE_URL: z.string().url().refine((url) => /^postgres(ql)?:/.test(url), "Must use PostgreSQL"),
  REDIS_URL: z.string().url().refine((url) => /^rediss?:/.test(url), "Must use Redis"),
  ELASTICSEARCH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  GOOGLE_REDIRECT_URI: optionalUrl,
  SLACK_CLIENT_ID: optionalText,
  SLACK_CLIENT_SECRET: optionalText,
  SLACK_REDIRECT_URI: optionalUrl,
  BULL_BOARD_USER: optionalText,
  BULL_BOARD_PASS: optionalText,
  WORKER_CONCURRENCY: positiveInt,
  MIN_SEND_DELAY_MS: positiveInt,
  MAX_EMAILS_PER_HOUR_PER_SENDER: positiveInt.max(2147483647),
  EMAIL_QUEUE_NAME: z.string().regex(/^[\w-]+$/),
  QUEUE_PREFIX: z.string().regex(/^[\w-]+$/),
  QUEUE_BULK_SIZE: positiveInt.max(1000),
  JOB_ATTEMPTS: positiveInt,
  JOB_BACKOFF_MS: positiveInt,
  COMPLETED_JOB_RETENTION_SECONDS: positiveInt,
  MAX_RECIPIENTS: positiveInt.max(5000),
  MAX_SUBJECT_CHARS: positiveInt,
  MAX_BODY_CHARS: positiveInt,
  HTTP_BODY_LIMIT_BYTES: positiveInt,
  DATABASE_TRANSACTION_TIMEOUT_MS: positiveInt,
  REDIS_CONNECT_TIMEOUT_MS: positiveInt,
  REDIS_COMMAND_TIMEOUT_MS: positiveInt,
  SMTP_CONNECTION_TIMEOUT_MS: positiveInt,
  SMTP_GREETING_TIMEOUT_MS: positiveInt,
  SMTP_SOCKET_TIMEOUT_MS: positiveInt,
  STALE_CLAIM_MS: positiveInt,
  SMTP_SEND_TIMEOUT_MS: positiveInt.default(60000),
  WORKER_LOCK_DURATION_MS: positiveInt.default(30000),
  WORKER_STALLED_INTERVAL_MS: positiveInt.default(30000),
  WORKER_MAX_STALLED_COUNT: positiveInt.default(2),
  RECONCILIATION_BATCH_SIZE: positiveInt.max(1000).default(200),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(90000),
  RATE_KEY_TTL_SECONDS: positiveInt,
  RATE_WINDOW_MS: positiveInt.default(3600000),
  RATE_KEY_PREFIX: z.string().regex(/^[\w-]+$/).default("rate"),
  SLACK_DEBOUNCE_SECONDS: positiveInt,
  SEED_SENDER_COUNT: positiveInt.min(2),
  SEED_USER_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().uuid().optional()),
}).superRefine((env, ctx) => {
  if (env.RATE_KEY_TTL_SECONDS * 1000 < env.RATE_WINDOW_MS) {
    ctx.addIssue({ code: "custom", path: ["RATE_KEY_TTL_SECONDS"], message: "Must cover at least one rate window" });
  }
  if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
    ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "Production requires secure cookies" });
  }
  for (const name of ["FRONTEND_URL", "BACKEND_URL"] as const) {
    const url = new URL(env[name]);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      ctx.addIssue({ code: "custom", path: [name], message: "Must be an HTTP(S) origin without a path or credentials" });
    }
  }
  if (env.SLACK_REDIRECT_URI && !env.SLACK_REDIRECT_URI.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["SLACK_REDIRECT_URI"], message: "Slack requires an HTTPS redirect URI" });
  }
  if (env.SMTP_SOCKET_TIMEOUT_MS >= env.STALE_CLAIM_MS) {
    ctx.addIssue({ code: "custom", path: ["SMTP_SOCKET_TIMEOUT_MS"], message: "Must be below the planned stale claim threshold" });
  }
  if (env.SMTP_SEND_TIMEOUT_MS >= env.STALE_CLAIM_MS) {
    ctx.addIssue({ code: "custom", path: ["SMTP_SEND_TIMEOUT_MS"], message: "Must be below the stale claim threshold" });
  }
  if (env.SHUTDOWN_TIMEOUT_MS <= env.SMTP_SEND_TIMEOUT_MS) {
    ctx.addIssue({ code: "custom", path: ["SHUTDOWN_TIMEOUT_MS"], message: "Must exceed the SMTP send timeout" });
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return result.data;
}
