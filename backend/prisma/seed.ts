import { loadEnv } from "../src/config/env.js";
import { createPrisma } from "../src/db/prisma.js";

// Nodemailer otherwise reuses one cached Ethereal account during this process.
process.env.ETHEREAL_CACHE = "no";
const { ensureEtherealSenders } = await import("../src/services/senders.js");
const env = loadEnv();
if (!env.SEED_USER_ID) throw new Error("Set SEED_USER_ID to the UUID of an existing user before seeding.");
const prisma = createPrisma(env.DATABASE_URL);
try {
  const senders = await ensureEtherealSenders(prisma, env.SEED_USER_ID, env.SEED_SENDER_COUNT);
  console.log(JSON.stringify({ userId: env.SEED_USER_ID, senders }));
} finally {
  await prisma.$disconnect();
}
