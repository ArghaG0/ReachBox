import type { PrismaClient } from "@prisma/client";

export async function claimEmail(prisma: PrismaClient, id: string, now: Date) {
  const rows = await prisma.email.updateManyAndReturn({
    where: { id, status: "scheduled" },
    data: { status: "sending", attempts: { increment: 1 }, claimVersion: { increment: 1 }, updatedAt: now },
  });
  return rows[0] ?? null;
}

export function claimFilter(id: string, claimVersion: number) {
  return { id, status: "sending" as const, claimVersion };
}
