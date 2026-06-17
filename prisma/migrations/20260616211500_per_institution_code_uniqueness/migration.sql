-- Per-institution code uniqueness (Phase C). The code-live unique indexes were
-- global; replace them with composite (institutionId, code) partial indexes so
-- two institutions can each use the same faculty/department/course code. This
-- only RELAXES uniqueness (global codes were already unique within an
-- institution), so existing data can't collide.

DROP INDEX IF EXISTS "Faculty_code_live_key";
DROP INDEX IF EXISTS "Department_code_live_key";
DROP INDEX IF EXISTS "Programme_code_live_key";
DROP INDEX IF EXISTS "Course_code_live_key";

CREATE UNIQUE INDEX "Faculty_inst_code_live_key" ON "Faculty"("institutionId", "code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Department_inst_code_live_key" ON "Department"("institutionId", "code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "SubDepartment_inst_code_live_key" ON "SubDepartment"("institutionId", "code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Programme_inst_code_live_key" ON "Programme"("institutionId", "code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Course_inst_code_live_key" ON "Course"("institutionId", "code") WHERE "deletedAt" IS NULL;
