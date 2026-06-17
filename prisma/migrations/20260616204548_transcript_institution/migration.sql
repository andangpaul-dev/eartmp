-- AlterTable
ALTER TABLE "Transcript" ADD COLUMN "institutionId" TEXT;

-- CreateIndex
CREATE INDEX "Transcript_institutionId_idx" ON "Transcript"("institutionId");

-- Backfill: a transcript belongs to its student's institution; fall back to the
-- default institution so historical transcripts stay scoped.
UPDATE "Transcript" SET "institutionId" = (SELECT s."institutionId" FROM "Student" s WHERE s."id" = "Transcript"."studentId") WHERE "institutionId" IS NULL;
UPDATE "Transcript" SET "institutionId" = (SELECT id FROM "Institution" WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1) WHERE "institutionId" IS NULL;
