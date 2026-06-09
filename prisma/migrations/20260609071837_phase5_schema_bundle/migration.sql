-- DropIndex
DROP INDEX "AcademicSession_name_key";

-- DropIndex
DROP INDEX "Course_code_key";

-- DropIndex
DROP INDEX "Department_code_key";

-- DropIndex
DROP INDEX "Faculty_code_key";

-- DropIndex
DROP INDEX "Programme_code_key";

-- CreateTable
CREATE TABLE "StudentEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "fromSession" TEXT NOT NULL,
    "toSession" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "StudentEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StudentEnrollment_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StudentEnrollment_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "componentScores" TEXT NOT NULL,
    "finalScore" REAL,
    "grade" TEXT,
    "gradePoint" REAL,
    "creditsEarned" INTEGER,
    "gradeScaleId" TEXT,
    "assessmentConfigId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Result_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Result_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Result_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Result" ("componentScores", "courseId", "createdAt", "creditsEarned", "deletedAt", "finalScore", "grade", "gradePoint", "id", "isLocked", "semesterId", "studentId", "updatedAt") SELECT "componentScores", "courseId", "createdAt", "creditsEarned", "deletedAt", "finalScore", "grade", "gradePoint", "id", "isLocked", "semesterId", "studentId", "updatedAt" FROM "Result";
DROP TABLE "Result";
ALTER TABLE "new_Result" RENAME TO "Result";
CREATE INDEX "Result_studentId_semesterId_idx" ON "Result"("studentId", "semesterId");
CREATE INDEX "Result_studentId_idx" ON "Result"("studentId");
CREATE INDEX "Result_courseId_semesterId_idx" ON "Result"("courseId", "semesterId");
CREATE INDEX "Result_deletedAt_idx" ON "Result"("deletedAt");
CREATE UNIQUE INDEX "Result_studentId_courseId_semesterId_key" ON "Result"("studentId", "courseId", "semesterId");
CREATE TABLE "new_Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matricNumber" TEXT NOT NULL,
    "regNumber" TEXT,
    "fullName" TEXT NOT NULL,
    "gender" TEXT,
    "dateOfBirth" DATETIME,
    "nationality" TEXT,
    "address" TEXT,
    "telephone" TEXT,
    "email" TEXT,
    "photoPath" TEXT,
    "facultyId" TEXT,
    "departmentId" TEXT,
    "programmeId" TEXT,
    "levelId" TEXT,
    "admissionSession" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Student_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Student" ("address", "admissionSession", "createdAt", "dateOfBirth", "deletedAt", "departmentId", "email", "facultyId", "fullName", "gender", "id", "levelId", "matricNumber", "nationality", "photoPath", "programmeId", "regNumber", "status", "telephone", "updatedAt") SELECT "address", "admissionSession", "createdAt", "dateOfBirth", "deletedAt", "departmentId", "email", "facultyId", "fullName", "gender", "id", "levelId", "matricNumber", "nationality", "photoPath", "programmeId", "regNumber", "status", "telephone", "updatedAt" FROM "Student";
DROP TABLE "Student";
ALTER TABLE "new_Student" RENAME TO "Student";
CREATE INDEX "Student_departmentId_idx" ON "Student"("departmentId");
CREATE INDEX "Student_programmeId_levelId_idx" ON "Student"("programmeId", "levelId");
CREATE TABLE "new_Transcript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transcriptNumber" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ACADEMIC_TRANSCRIPT',
    "snapshot" TEXT NOT NULL,
    "verificationHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Transcript_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transcript_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TranscriptTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transcript" ("createdAt", "deletedAt", "generatedAt", "id", "remarks", "snapshot", "status", "studentId", "templateId", "transcriptNumber", "type", "updatedAt", "verificationHash") SELECT "createdAt", "deletedAt", "generatedAt", "id", "remarks", "snapshot", "status", "studentId", "templateId", "transcriptNumber", "type", "updatedAt", "verificationHash" FROM "Transcript";
DROP TABLE "Transcript";
ALTER TABLE "new_Transcript" RENAME TO "Transcript";
CREATE UNIQUE INDEX "Transcript_transcriptNumber_key" ON "Transcript"("transcriptNumber");
CREATE INDEX "Transcript_studentId_idx" ON "Transcript"("studentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "StudentEnrollment_studentId_idx" ON "StudentEnrollment"("studentId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_programmeId_idx" ON "StudentEnrollment"("programmeId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_levelId_idx" ON "StudentEnrollment"("levelId");

-- CreateIndex
CREATE INDEX "Course_departmentId_idx" ON "Course"("departmentId");

-- CreateIndex
CREATE INDEX "Course_levelId_idx" ON "Course"("levelId");

-- CreateIndex
CREATE INDEX "Department_facultyId_idx" ON "Department"("facultyId");

-- CreateIndex
CREATE INDEX "Level_programmeId_idx" ON "Level"("programmeId");

-- CreateIndex
CREATE INDEX "Programme_departmentId_idx" ON "Programme"("departmentId");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- ---------------------------------------------------------------------------
-- Partial unique indexes (ADR-010 / F-20): uniqueness among LIVE rows only, so
-- a soft-deleted code/name can be re-used. SQLite treats NULLs as distinct, so
-- multiple NULL regNumbers remain allowed. These replace the column-level
-- @unique on user-facing entity codes (catalog tables keep their plain @unique).
-- Hand-authored: Prisma cannot express conditional unique indexes.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "Faculty_code_live_key" ON "Faculty"("code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Department_code_live_key" ON "Department"("code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Programme_code_live_key" ON "Programme"("code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Course_code_live_key" ON "Course"("code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "AcademicSession_name_live_key" ON "AcademicSession"("name") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Student_matricNumber_live_key" ON "Student"("matricNumber") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Student_regNumber_live_key" ON "Student"("regNumber") WHERE "deletedAt" IS NULL;
