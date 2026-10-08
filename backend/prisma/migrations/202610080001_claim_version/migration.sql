ALTER TABLE "Email" ADD COLUMN "claimVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "Email" SET "claimVersion" = "attempts";
