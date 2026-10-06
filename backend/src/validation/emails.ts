import { z } from "zod";
import type { Env } from "../config/env.js";

export function scheduleSchema(env: Env) {
  return z.object({
    senderId: z.string().uuid(),
    subject: z.string().trim().min(1).max(env.MAX_SUBJECT_CHARS).refine((s) => !/[\r\n]/.test(s), "Subject must be a single line"),
    bodyHtml: z.string().trim().min(1).max(env.MAX_BODY_CHARS)
      .refine((s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim().length > 0, "Email body cannot be empty"),
    recipients: z.array(z.string()).min(1).max(env.MAX_RECIPIENTS).transform((items) =>
      [...new Set(items.map((item) => item.trim().toLowerCase()).filter((item) => z.string().email().safeParse(item).success))]
    ).refine((items) => items.length > 0, "At least one valid recipient is required"),
    startAt: z.string().datetime({ offset: true }).nullish(),
    delaySeconds: z.number().finite().nonnegative(),
    hourlyLimit: z.number().int().min(1).max(2147483647).default(env.MAX_EMAILS_PER_HOUR_PER_SENDER),
  });
}
export type ScheduleInput = z.infer<ReturnType<typeof scheduleSchema>>;
