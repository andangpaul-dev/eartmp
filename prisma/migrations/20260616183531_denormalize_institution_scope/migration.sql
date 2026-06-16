-- AlterTable
ALTER TABLE "Course" ADD COLUMN "institutionId" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "institutionId" TEXT;

-- AlterTable
ALTER TABLE "Programme" ADD COLUMN "institutionId" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN "institutionId" TEXT;

-- AlterTable
ALTER TABLE "SubDepartment" ADD COLUMN "institutionId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "institutionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "deletedAt", "email", "fullName", "id", "isActive", "lastLoginAt", "passwordHash", "roleId", "updatedAt", "username") SELECT "createdAt", "deletedAt", "email", "fullName", "id", "isActive", "lastLoginAt", "passwordHash", "roleId", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_roleId_idx" ON "User"("roleId");
CREATE INDEX "User_institutionId_idx" ON "User"("institutionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Course_institutionId_idx" ON "Course"("institutionId");

-- CreateIndex
CREATE INDEX "Department_institutionId_idx" ON "Department"("institutionId");

-- CreateIndex
CREATE INDEX "Programme_institutionId_idx" ON "Programme"("institutionId");

-- CreateIndex
CREATE INDEX "Student_institutionId_idx" ON "Student"("institutionId");

-- CreateIndex
CREATE INDEX "SubDepartment_institutionId_idx" ON "SubDepartment"("institutionId");

-- Backfill: cascade institutionId down the academic tree from the faculty.
-- Order matters (Department first, then its children). Users stay NULL (global).
UPDATE "Department" SET "institutionId" = (SELECT f."institutionId" FROM "Faculty" f WHERE f."id" = "Department"."facultyId") WHERE "institutionId" IS NULL;
UPDATE "SubDepartment" SET "institutionId" = (SELECT d."institutionId" FROM "Department" d WHERE d."id" = "SubDepartment"."departmentId") WHERE "institutionId" IS NULL;
UPDATE "Programme" SET "institutionId" = (SELECT d."institutionId" FROM "Department" d WHERE d."id" = "Programme"."departmentId") WHERE "institutionId" IS NULL;
UPDATE "Course" SET "institutionId" = COALESCE(
  (SELECT d."institutionId" FROM "Department" d WHERE d."id" = "Course"."departmentId"),
  (SELECT sd."institutionId" FROM "SubDepartment" sd WHERE sd."id" = "Course"."subDepartmentId"),
  (SELECT p."institutionId" FROM "Programme" p WHERE p."id" = "Course"."programmeId")
) WHERE "institutionId" IS NULL;
UPDATE "Student" SET "institutionId" = COALESCE(
  (SELECT f."institutionId" FROM "Faculty" f WHERE f."id" = "Student"."facultyId"),
  (SELECT d."institutionId" FROM "Department" d WHERE d."id" = "Student"."departmentId"),
  (SELECT p."institutionId" FROM "Programme" p WHERE p."id" = "Student"."programmeId")
) WHERE "institutionId" IS NULL;

-- Fallback: any row still unresolved (e.g. an unassigned faculty) gets the
-- default institution so nothing is left tenant-less.
UPDATE "Department" SET "institutionId" = (SELECT id FROM "Institution" WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1) WHERE "institutionId" IS NULL;
UPDATE "SubDepartment" SET "institutionId" = (SELECT id FROM "Institution" WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1) WHERE "institutionId" IS NULL;
UPDATE "Programme" SET "institutionId" = (SELECT id FROM "Institution" WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1) WHERE "institutionId" IS NULL;
UPDATE "Course" SET "institutionId" = (SELECT id FROM "Institution" WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1) WHERE "institutionId" IS NULL;
UPDATE "Student" SET "institutionId" = (SELECT id FROM "Institution" WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1) WHERE "institutionId" IS NULL;
