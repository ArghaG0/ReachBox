import nodemailer from "nodemailer";
import type { PrismaClient } from "@prisma/client";

export async function ensureEtherealSenders(
  prisma: PrismaClient,
  userId: string,
  desiredCount: number,
  createAccount = () => nodemailer.createTestAccount(),
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error("Seed user does not exist. Select an existing user's UUID; no synthetic Google identity is created.");
  const existing = await prisma.sender.count({ where: { userId, smtpHost: "smtp.ethereal.email" } });
  for (let count = existing; count < desiredCount; count++) {
    // Disable Nodemailer's default account cache in the seed entrypoint so that
    // two calls create two distinct SMTP identities.
    const account = await createAccount();
    await prisma.sender.create({ data: {
      userId, email: account.user, smtpHost: account.smtp.host,
      smtpPort: account.smtp.port, smtpUser: account.user, smtpPass: account.pass,
    } });
  }
  return prisma.sender.findMany({ where: { userId }, select: { id: true, email: true } });
}
