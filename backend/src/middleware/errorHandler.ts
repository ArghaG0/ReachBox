import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
  } else if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ") });
  } else if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large" });
  } else if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Invalid JSON" });
  } else {
    console.error(JSON.stringify({ event: "request_failed", type: error instanceof Error ? error.name : "unknown" }));
    res.status(500).json({ error: "Internal server error" });
  }
};
