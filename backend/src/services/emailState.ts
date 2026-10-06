import type { PrismaClient } from "@prisma/client";

export async function claimEmail(prisma: PrismaClient, id: string, now: Date) {
  const rows = await prisma.email.updateManyAndReturn({
    where: { id, status: "scheduled", scheduledAt: { lte: now } },
    data: { status: "sending", attempts: { increment: 1 }, updatedAt: now },
  });
  return rows[0] ?? null;
}

export function claimFilter(id: string, attempts: number) {
  return { id, status: "sending" as const, attempts };
}