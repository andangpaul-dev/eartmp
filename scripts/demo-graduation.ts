/**
 * Runnable graduation-eligibility demo (DEV-ONLY). Sets up an eligible student
 * (all passes) and an ineligible one (an outstanding fail), evaluates both, then
 * clears the eligible student to GRADUATED. Cleans up.
 * Run: npm run db:seed && npm run demo:graduation
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaStudentRepository,
  PrismaResultRepository,
  PrismaCourseRepository,
} from "../src/infrastructure/repositories/PrismaRecordsRepositories";
import {
  PrismaGradeScaleRepository,
  PrismaAssessmentConfigRepository,
} from "../src/infrastructure/repositories/PrismaGradingRepositories";
import { PrismaSettingRepository } from "../src/infrastructure/repositories/PrismaConfigRepositories";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { GradingConfigService } from "../src/application/services/GradingConfigService";
import { GraduationConfigService } from "../src/application/services/GraduationConfigService";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import { GetAcademicSummary } from "../src/application/use-cases/results/GetAcademicSummary";
import {
  EvaluateGraduation,
  GraduateStudent,
} from "../src/application/use-cases/graduation/Graduation";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const registry = buildDefaultRegistry();
  const settings = new PrismaSettingRepository(db);
  const grading = new GradingConfigService(
    new PrismaGradeScaleRepository(db),
    new PrismaAssessmentConfigRepository(db),
    settings,
    registry,
  );
  const summary = new GetAcademicSummary(
    new PrismaResultRepository(db),
    new PrismaCourseRepository(db),
    grading,
  );
  const config = new GraduationConfigService(settings, registry);
  const evaluate = new EvaluateGraduation(summary, config);
  const graduate = new GraduateStudent(
    summary,
    config,
    new PrismaStudentRepository(db),
    new PrismaAuditLogAdapter(db),
  );
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "results.read",
    "graduation.read",
    "graduation.clear",
  ]);

  // Prerequisites.
  const fac = await db.faculty.create({
    data: { name: "DGrad", code: "DGRAD" },
  });
  const dep = await db.department.create({
    data: { name: "CS", code: "DGRADCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc", code: "DGRADB", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "400", rank: 4, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({
    data: { name: "DGRAD 24/25" },
  });
  const sem = await db.semester.create({
    data: { name: "First", rank: 1, sessionId: sess.id },
  });

  async function student(matric: string) {
    return db.student.create({
      data: {
        matricNumber: matric,
        fullName: matric,
        programmeId: prog.id,
        levelId: lvl.id,
        status: "ACTIVE",
      },
    });
  }
  async function course(code: string, credit: number) {
    return db.course.create({
      data: { code, title: code, creditValue: credit, programmeId: prog.id },
    });
  }
  async function result(
    studentId: string,
    courseId: string,
    gradePoint: number,
    credit: number,
    pass: boolean,
  ) {
    return db.result.create({
      data: {
        studentId,
        courseId,
        semesterId: sem.id,
        componentScores: "[]",
        finalScore: pass ? 70 : 30,
        grade: pass ? "P" : "F",
        gradePoint,
        creditsEarned: pass ? credit : 0,
        isLocked: true,
      },
    });
  }

  const ada = await student("DGRAD/0001"); // eligible
  const bob = await student("DGRAD/0002"); // ineligible (a fail)
  const cs = await course("DGRADCS401", 3);
  const ma = await course("DGRADMA401", 2);
  const ph = await course("DGRADPH401", 3);
  const ch = await course("DGRADCH401", 1);
  await result(ada.id, cs.id, 4, 3, true);
  await result(ada.id, ma.id, 3, 2, true);
  await result(bob.id, ph.id, 2, 3, true);
  await result(bob.id, ch.id, 0, 1, false); // outstanding fail

  console.log("1) Evaluate eligible student (Ada):");
  const rA = await evaluate.execute({ studentId: ada.id }, admin);
  console.log(`   eligible=${rA.eligible}`);

  console.log("2) Evaluate ineligible student (Bob):");
  const rB = await evaluate.execute({ studentId: bob.id }, admin);
  const unmet = rB.criteria.filter((c) => !c.met).map((c) => c.name);
  console.log(`   eligible=${rB.eligible}; unmet: ${unmet.join(", ")}`);

  console.log("3) Clear Bob (should be rejected):");
  try {
    await graduate.execute({ studentId: bob.id }, admin);
    console.log("   ✗ graduated an ineligible student (BAD)");
  } catch (e) {
    console.log(`   ✓ rejected: ${(e as Error).message}`);
  }

  console.log("4) Clear Ada (eligible → GRADUATED):");
  const cleared = await graduate.execute({ studentId: ada.id }, admin);
  const adaNow = await db.student.findUnique({ where: { id: ada.id } });
  console.log(
    `   result status=${cleared.status}; student.status=${adaNow?.status}`,
  );

  console.log("5) Cleanup:");
  await db.result.deleteMany({
    where: { studentId: { in: [ada.id, bob.id] } },
  });
  await db.student.deleteMany({
    where: { matricNumber: { startsWith: "DGRAD/" } },
  });
  await db.course.deleteMany({ where: { code: { startsWith: "DGRAD" } } });
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
