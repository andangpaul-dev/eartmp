-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Faculty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "institutionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Faculty_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Faculty" ("code", "createdAt", "deletedAt", "id", "name", "updatedAt") SELECT "code", "createdAt", "deletedAt", "id", "name", "updatedAt" FROM "Faculty";
DROP TABLE "Faculty";
ALTER TABLE "new_Faculty" RENAME TO "Faculty";
CREATE INDEX "Faculty_institutionId_idx" ON "Faculty"("institutionId");
CREATE TABLE "new_Institution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "motto" TEXT,
    "accreditationNo" TEXT,
    "address" TEXT,
    "telephone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoPath" TEXT,
    "sealPath" TEXT,
    "registrarSignPath" TEXT,
    "calendarType" TEXT NOT NULL DEFAULT 'SEMESTER',
    "transcriptNumberRule" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);
INSERT INTO "new_Institution" ("accreditationNo", "address", "calendarType", "createdAt", "deletedAt", "email", "id", "logoPath", "motto", "name", "registrarSignPath", "sealPath", "telephone", "transcriptNumberRule", "updatedAt", "website") SELECT "accreditationNo", "address", "calendarType", "createdAt", "deletedAt", "email", "id", "logoPath", "motto", "name", "registrarSignPath", "sealPath", "telephone", "transcriptNumberRule", "updatedAt", "website" FROM "Institution";
DROP TABLE "Institution";
ALTER TABLE "new_Institution" RENAME TO "Institution";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: designate the earliest institution as the default, and attach all
-- pre-existing faculties to it (so single-institution installs keep working and
-- transcripts still resolve the default institution).
UPDATE "Institution" SET "isDefault" = true WHERE "id" = (SELECT "id" FROM "Institution" WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1);
UPDATE "Faculty" SET "institutionId" = (SELECT "id" FROM "Institution" WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1) WHERE "institutionId" IS NULL;
