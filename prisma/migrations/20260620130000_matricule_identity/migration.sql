-- Workstream C: matricule counter + graduate re-admission link.
ALTER TABLE "Student" ADD COLUMN "previousStudentId" TEXT;

CREATE TABLE "MatriculeCounter" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "institutionId" TEXT,
  "facultyId"     TEXT NOT NULL,
  "year"          INTEGER NOT NULL,
  "next"          INTEGER NOT NULL DEFAULT 1,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL
);
CREATE UNIQUE INDEX "MatriculeCounter_institutionId_facultyId_year_key"
  ON "MatriculeCounter"("institutionId", "facultyId", "year");
