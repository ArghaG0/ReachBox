import { randomUUID } from "node:crypto";
import { createPrisma } from "../../backend/src/db/prisma.js";
import { testEnv } from "./env.js";

export async function createTestDatabase() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? testEnv().DATABASE_URL);
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  url.searchParams.set("schema", "public");
  const admin = createPrisma(url.toString());
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set("schema", schema);
  const prisma = createPrisma(url.toString());
  const { readFile, readdir } = await import("node:fs/promises");
  const migrations = new URL("../../backend/prisma/migrations/", import.meta.url);
  try {
    for (const folder of (await readdir(migrations, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const sql = await readFile(new URL(folder.name + "/migration.sql", migrations), "utf8");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
        await prisma.$executeRawUnsafe(statement);
      }
    }
  } catch (error) {
    await prisma.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
    throw error;
  }
  return {
    prisma,
    databaseUrl: url.toString(),
    async close() {
      await prisma.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.$disconnect();
    },
  };
}

export async function createOwner(prisma: ReturnType<typeof createPrisma>) {
  const id = randomUUID();
  return prisma.user.create({ data: { id, googleId: `test-${id}`, email: `${id}@example.test`, name: "Integration test" } });
}
