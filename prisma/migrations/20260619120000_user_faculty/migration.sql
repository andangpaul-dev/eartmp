-- Faculty-scoped RBAC: a user's assigned faculties (no rows = institution-wide).
CREATE TABLE "UserFaculty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFaculty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserFaculty_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserFaculty_userId_facultyId_key" ON "UserFaculty"("userId", "facultyId");
CREATE INDEX "UserFaculty_userId_idx" ON "UserFaculty"("userId");
CREATE INDEX "UserFaculty_facultyId_idx" ON "UserFaculty"("facultyId");
