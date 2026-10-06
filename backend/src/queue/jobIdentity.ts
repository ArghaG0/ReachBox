import { z } from "zod";

const uuid = z.string().uuid();
export const canonicalJobId = (emailId: string): string => `email:${uuid.parse(emailId)}`;
export const transportJobId = (emailId: string): string => `email-${uuid.parse(emailId)}`;
export function emailIdFromCanonical(jobId: string): string {
  if (!jobId.startsWith("email:")) throw new Error("Invalid canonical job ID");
  return uuid.parse(jobId.slice(6));
}
export function transportIdFromCanonical(jobId: string): string {
  return transportJobId(emailIdFromCanonical(jobId));
}
