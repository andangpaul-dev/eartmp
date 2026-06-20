-- Workstream B: resit/carryover sittings + result statuses.
ALTER TABLE "Result" ADD COLUMN "sitting" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Result" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'GRADED';
DROP INDEX IF EXISTS "Result_studentId_courseId_semesterId_key";
CREATE UNIQUE INDEX "Result_studentId_courseId_semesterId_sitting_key"
  ON "Result"("studentId", "courseId", "semesterId", "sitting");
