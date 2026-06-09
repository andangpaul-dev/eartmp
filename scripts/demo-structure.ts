/**
 * Runnable academic-structure demo (DEV-ONLY). Builds a faculty → department →
 * programme → level hierarchy and a session → semester calendar through the
 * Phase 5 use-cases (Prisma dev repos), demonstrates the invariants
 * (soft-delete guard, current-session, rank uniqueness), then cleans up so it is
 * re-runnable. Run: npm run db:seed && npm run demo:structure
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaFacultyRepository,
  PrismaDepartmentRepository,
  PrismaProgrammeRepository,
  PrismaLevelRepository,
  PrismaAcademicSessionRepository,
  PrismaSemesterRepository,
} from "../src/infrastructure/repositories/PrismaStructureRepositories";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import {
  CreateFaculty,
  DeleteFaculty,
  CreateDepartment,
  DeleteDepartment,
  CreateProgramme,
  DeleteProgramme,
  CreateLevel,
} from "../src/application/use-cases/structure/ManageStructure";
import {
  CreateSession,
  SetCurrentSession,
  CreateSemester,
  ListSessions,
} from "../src/application/use-cases/structure/ManageCalendar";
import { StructureError } from "../src/domain/errors/structure";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const facultyRepo = new PrismaFacultyRepository(db);
  const deptRepo = new PrismaDepartmentRepository(db);
  const progRepo = new PrismaProgrammeRepository(db);
  const levelRepo = new PrismaLevelRepository(db);
  const sessionRepo = new PrismaAcademicSessionRepository(db);
  const semesterRepo = new PrismaSemesterRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "structure.read",
    "structure.manage",
  ]);

  console.log("1) Build hierarchy:");
  const faculty = await new CreateFaculty(facultyRepo, audit).execute(
    { name: "Faculty of Science", code: "DEMOSCI" },
    admin,
  );
  const dept = await new CreateDepartment(deptRepo, facultyRepo, audit).execute(
    { name: "Computer Science", code: "DEMOCS", facultyId: faculty.id },
    admin,
  );
  const prog = await new CreateProgramme(progRepo, deptRepo, audit).execute(
    { name: "BSc Computer Science", code: "DEMOBSC", departmentId: dept.id },
    admin,
  );
  const createLevel = new CreateLevel(levelRepo, progRepo, audit);
  for (const [name, rank] of [
    ["100", 1],
    ["200", 2],
  ] as const) {
    await createLevel.execute({ name, rank, programmeId: prog.id }, admin);
  }
  console.log(`   ${faculty.code} › ${dept.code} › ${prog.code} › 2 levels`);

  console.log("2) Invariant — duplicate live code rejected:");
  try {
    await new CreateFaculty(facultyRepo, audit).execute(
      { name: "Dup", code: "DEMOSCI" },
      admin,
    );
    console.log("   ✗ allowed (BAD)");
  } catch (e) {
    console.log(`   ✓ rejected as ${(e as Error).name}`);
  }

  console.log("3) Invariant — cannot delete faculty with live departments:");
  try {
    await new DeleteFaculty(facultyRepo, audit).execute(
      { id: faculty.id },
      admin,
    );
    console.log("   ✗ allowed (BAD)");
  } catch (e) {
    console.log(`   ✓ blocked: ${(e as StructureError).message}`);
  }

  console.log("4) Calendar — session + semesters + set current:");
  const session = await new CreateSession(sessionRepo, audit).execute(
    { name: "DEMO 2025/2026" },
    admin,
  );
  const createSem = new CreateSemester(semesterRepo, sessionRepo, audit);
  await createSem.execute(
    { name: "First", rank: 1, sessionId: session.id },
    admin,
  );
  await createSem.execute(
    { name: "Second", rank: 2, sessionId: session.id },
    admin,
  );
  try {
    await createSem.execute(
      { name: "Dup", rank: 1, sessionId: session.id },
      admin,
    );
    console.log("   ✗ duplicate rank allowed (BAD)");
  } catch {
    console.log("   ✓ duplicate semester rank rejected");
  }
  await new SetCurrentSession(sessionRepo, audit).execute(
    { id: session.id },
    admin,
  );
  const current = (await sessionRepo.findCurrent())?.name;
  console.log(`   current session = ${current}`);
  console.log(
    `   sessions on record: ${(await new ListSessions(sessionRepo).execute({}, admin)).length}`,
  );

  console.log("5) Cleanup (soft-delete, bottom-up) so the demo re-runs:");
  for (const l of await levelRepo.listByProgramme(prog.id)) {
    await levelRepo.softDelete(l.id);
  }
  await new DeleteProgramme(progRepo, audit).execute({ id: prog.id }, admin);
  await new DeleteDepartment(deptRepo, audit).execute({ id: dept.id }, admin);
  await new DeleteFaculty(facultyRepo, audit).execute(
    { id: faculty.id },
    admin,
  );
  for (const s of await semesterRepo.listBySession(session.id)) {
    await semesterRepo.softDelete(s.id);
  }
  await sessionRepo.softDelete(session.id);
  console.log("   ✓ cleaned up");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
