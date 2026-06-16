-- AlterTable
ALTER TABLE "Level" ADD COLUMN "gradeScaleId" TEXT;

-- CreateTable
CREATE TABLE "SubDepartment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "SubDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "creditValue" INTEGER NOT NULL,
    "courseType" TEXT NOT NULL DEFAULT 'CORE',
    "departmentId" TEXT,
    "subDepartmentId" TEXT,
    "programmeId" TEXT,
    "levelId" TEXT,
    "semesterRank" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Course_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Course_subDepartmentId_fkey" FOREIGN KEY ("subDepartmentId") REFERENCES "SubDepartment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Course_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Course_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Course" ("code", "courseType", "createdAt", "creditValue", "deletedAt", "departmentId", "id", "levelId", "programmeId", "semesterRank", "title", "updatedAt") SELECT "code", "courseType", "createdAt", "creditValue", "deletedAt", "departmentId", "id", "levelId", "programmeId", "semesterRank", "title", "updatedAt" FROM "Course";
DROP TABLE "Course";
ALTER TABLE "new_Course" RENAME TO "Course";
CREATE INDEX "Course_programmeId_idx" ON "Course"("programmeId");
CREATE INDEX "Course_departmentId_idx" ON "Course"("departmentId");
CREATE INDEX "Course_subDepartmentId_idx" ON "Course"("subDepartmentId");
CREATE INDEX "Course_levelId_idx" ON "Course"("levelId");
CREATE TABLE "new_Programme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "subDepartmentId" TEXT,
    "durationLevels" INTEGER NOT NULL DEFAULT 4,
    "creditsRequired" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Programme_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Programme_subDepartmentId_fkey" FOREIGN KEY ("subDepartmentId") REFERENCES "SubDepartment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Programme" ("code", "createdAt", "creditsRequired", "deletedAt", "departmentId", "durationLevels", "id", "name", "updatedAt") SELECT "code", "createdAt", "creditsRequired", "deletedAt", "departmentId", "durationLevels", "id", "name", "updatedAt" FROM "Programme";
DROP TABLE "Programme";
ALTER TABLE "new_Programme" RENAME TO "Programme";
CREATE INDEX "Programme_departmentId_idx" ON "Programme"("departmentId");
CREATE INDEX "Programme_subDepartmentId_idx" ON "Programme"("subDepartmentId");
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
    "subDepartmentId" TEXT,
    "programmeId" TEXT,
    "levelId" TEXT,
    "admissionSession" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Student_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_subDepartmentId_fkey" FOREIGN KEY ("subDepartmentId") REFERENCES "SubDepartment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Student" ("address", "admissionSession", "createdAt", "dateOfBirth", "deletedAt", "departmentId", "email", "facultyId", "fullName", "gender", "id", "levelId", "matricNumber", "nationality", "photoPath", "programmeId", "regNumber", "status", "telephone", "updatedAt", "version") SELECT "address", "admissionSession", "createdAt", "dateOfBirth", "deletedAt", "departmentId", "email", "facultyId", "fullName", "gender", "id", "levelId", "matricNumber", "nationality", "photoPath", "programmeId", "regNumber", "status", "telephone", "updatedAt", "version" FROM "Student";
DROP TABLE "Student";
ALTER TABLE "new_Student" RENAME TO "Student";
CREATE INDEX "Student_departmentId_idx" ON "Student"("departmentId");
CREATE INDEX "Student_programmeId_levelId_idx" ON "Student"("programmeId", "levelId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SubDepartment_departmentId_idx" ON "SubDepartment"("departmentId");
