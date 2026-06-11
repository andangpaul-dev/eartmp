/**
 * Runnable results demo (DEV-ONLY). Enters component scores, processes a
 * semester atomically (GPA + grade-scale provenance), locks the results, shows
 * a blocked edit, then unlocks. Builds prerequisites and cleans up.
 * Run: npm run db:seed && npm run demo:results
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaGradeScaleRepository,
  PrismaAssessmentConfigRepository,
} from "../src/infrastructure/repositories/PrismaGradingRepositories";
import { PrismaSettingRepository } from "../src/infrastructure/repositories/PrismaConfigRepositories";
import { PrismaResultRepository } from "../src/infrastructure/repositories/PrismaRecordsRepositories";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { PrismaUnitOfWork } from "../src/infrastructure/persistence/PrismaUnitOfWork";
import { GradingConfigService } from "../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import {
  EnterResult,
  LockSemesterResults,
  UnlockResult,
  GetStudentSemesterResults,
} from "../src/application/use-cases/results/ManageResults";
import { ProcessSemester } from "../src/application/use-cases/results/ProcessSemester";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const results = new PrismaResultRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const grading = new GradingConfigService(
    new PrismaGradeScaleRepository(db),
    new PrismaAssessmentConfigRepository(db),
    new PrismaSettingRepository(db),
    buildDefaultRegistry(),
  );
  const uow = new PrismaUnitOfWork(db);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "results.read",
    "results.process",
    "results.unlock",
  ]);

  // Prerequisites.
  const fac = await db.faculty.create({
    data: { name: "DResSci", code: "DRES" },
  });
  const dep = await db.department.create({
    data: { name: "DResCS", code: "DRESCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc", code: "DRESB", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "100", rank: 1, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({
    data: { name: "DRES 24/25" },
  });
  const sem = await db.semester.create({
    data: { name: "First", rank: 1, sessionId: sess.id },
  });
  const student = await db.student.create({
    data: {
      matricNumber: "DRES/0001",
      fullName: "Ada",
      programmeId: prog.id,
      levelId: lvl.id,
    },
  });
  const cs = await db.course.create({
    data: {
      code: "DRESCS101",
      title: "Intro CS",
      creditValue: 3,
      programmeId: prog.id,
    },
  });
  const ma = await db.course.create({
    data: {
      code: "DRESMA101",
      title: "Calc",
      creditValue: 2,
      programmeId: prog.id,
    },
  });

  console.log("1) Enter component scores (final score computed):");
  const enter = new EnterResult(results, grading, audit);
  const r1 = await enter.execute(
    {
      studentId: student.id,
      courseId: cs.id,
      semesterId: sem.id,
      componentScores: [
        { key: "ca", score: 28 },
        { key: "exam", score: 65 },
      ],
    },
    admin,
  );
  await enter.execute(
    {
      studentId: student.id,
      courseId: ma.id,
      semesterId: sem.id,
      componentScores: [
        { key: "ca", score: 20 },
        { key: "exam", score: 30 },
      ],
    },
    admin,
  );
  console.log(`   CS101 final=${r1.finalScore}, MA101 final=50`);

  console.log("2) Process the semester (atomic, provenance):");
  const summary = await new ProcessSemester(uow, grading).execute(
    { studentId: student.id, semesterId: sem.id },
    admin,
  );
  console.log(
    `   GPA = ${summary.gpa}, credits earned ${summary.creditsEarned}`,
  );
  const processed = await new GetStudentSemesterResults(results).execute(
    { studentId: student.id, semesterId: sem.id },
    admin,
  );
  const csRow = processed.find((r) => r.courseId === cs.id)!;
  const csRaw = await db.result.findUnique({ where: { id: csRow.id } });
  console.log(
    `   CS101 → ${csRow.grade}; gradeScaleId stamped = ${csRaw?.gradeScaleId ? "yes" : "no"}`,
  );

  console.log("3) Lock the semester results:");
  const locked = await new LockSemesterResults(results, audit).execute(
    { studentId: student.id, semesterId: sem.id },
    admin,
  );
  console.log(`   locked ${locked} result(s)`);

  console.log("4) Blocked edit while locked:");
  try {
    await enter.execute(
      {
        studentId: student.id,
        courseId: cs.id,
        semesterId: sem.id,
        componentScores: [
          { key: "ca", score: 30 },
          { key: "exam", score: 70 },
        ],
      },
      admin,
    );
    console.log("   ✗ edit allowed while locked (BAD)");
  } catch {
    console.log("   ✓ edit rejected (locked)");
  }

  console.log("5) Unlock + edit:");
  await new UnlockResult(results, audit).execute({ resultId: csRow.id }, admin);
  await enter.execute(
    {
      studentId: student.id,
      courseId: cs.id,
      semesterId: sem.id,
      componentScores: [
        { key: "ca", score: 30 },
        { key: "exam", score: 70 },
      ],
    },
    admin,
  );
  console.log("   ✓ unlocked and re-entered");

  console.log("6) Cleanup:");
  await db.result.deleteMany({ where: { studentId: student.id } });
  await db.student.delete({ where: { id: student.id } });
  await db.course.deleteMany({ where: { id: { in: [cs.id, ma.id] } } });
  await db.semester.delete({ where: { id: sem.id } });
  await db.academicSession.delete({ where: { id: sess.id } });
  await db.level.delete({ where: { id: lvl.id } });
  await db.programme.delete({ where: { id: prog.id } });
  await db.department.delete({ where: { id: dep.id } });
  await db.faculty.delete({ where: { id: fac.id } });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
