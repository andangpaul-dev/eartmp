/**
 * Runnable academic-summary demo (DEV-ONLY). Sets up a student with PROCESSED
 * results across two semesters, then computes the academic summary: per-semester
 * GPA, cumulative CGPA (by aggregate), and the configured standing. Cleans up.
 * Run: npm run db:seed && npm run demo:summary
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaResultRepository,
  PrismaCourseRepository,
} from "../src/infrastructure/repositories/PrismaRecordsRepositories";
import {
  PrismaGradeScaleRepository,
  PrismaAssessmentConfigRepository,
} from "../src/infrastructure/repositories/PrismaGradingRepositories";
import { PrismaSettingRepository } from "../src/infrastructure/repositories/PrismaConfigRepositories";
import { GradingConfigService } from "../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import { GetAcademicSummary } from "../src/application/use-cases/results/GetAcademicSummary";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const grading = new GradingConfigService(
    new PrismaGradeScaleRepository(db),
    new PrismaAssessmentConfigRepository(db),
    new PrismaSettingRepository(db),
    buildDefaultRegistry(),
  );
  const summary = new GetAcademicSummary(
    new PrismaResultRepository(db),
    new PrismaCourseRepository(db),
    grading,
  );
  const admin = SessionContext.create("admin", "SUPER_ADMIN", ["results.read"]);

  // Prerequisites: a student + 2 semesters + 4 graded courses.
  const fac = await db.faculty.create({ data: { name: "DSum", code: "DSUM" } });
  const dep = await db.department.create({
    data: { name: "CS", code: "DSUMCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc", code: "DSUMB", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "100", rank: 1, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({
    data: { name: "DSUM 24/25" },
  });
  const sem1 = await db.semester.create({
    data: { name: "First", rank: 1, sessionId: sess.id },
  });
  const sem2 = await db.semester.create({
    data: { name: "Second", rank: 2, sessionId: sess.id },
  });
  const student = await db.student.create({
    data: {
      matricNumber: "DSUM/0001",
      fullName: "Ada",
      programmeId: prog.id,
      levelId: lvl.id,
    },
  });

  async function course(code: string, credit: number) {
    return db.course.create({
      data: { code, title: code, creditValue: credit, programmeId: prog.id },
    });
  }
  async function result(
    courseId: string,
    semesterId: string,
    gradePoint: number,
    credit: number,
    pass: boolean,
  ) {
    return db.result.create({
      data: {
        studentId: student.id,
        courseId,
        semesterId,
        componentScores: "[]",
        finalScore: 70,
        grade: pass ? "P" : "F",
        gradePoint,
        creditsEarned: pass ? credit : 0,
        isLocked: true,
      },
    });
  }

  const cs = await course("DSUMCS101", 3);
  const ma = await course("DSUMMA101", 2);
  const ph = await course("DSUMPH201", 3);
  const ch = await course("DSUMCH201", 1);
  // Sem1: A(4)*3 + B(3)*2 = 18/5 = 3.6
  await result(cs.id, sem1.id, 4, 3, true);
  await result(ma.id, sem1.id, 3, 2, true);
  // Sem2: C(2)*3 + F(0)*1 = 6/4 = 1.5
  await result(ph.id, sem2.id, 2, 3, true);
  await result(ch.id, sem2.id, 0, 1, false);

  const s = await summary.execute({ studentId: student.id }, admin);
  console.log("Per-semester GPA:");
  for (const sem of s.semesters) {
    console.log(
      `   ${sem.semesterId === sem1.id ? "Sem1" : "Sem2"}: GPA ${sem.gpa} (credits ${sem.creditsEarned}/${sem.creditsAttempted})`,
    );
  }
  console.log(
    `CGPA (aggregate) = ${s.cgpa}, credits earned ${s.creditsEarned}/${s.creditsAttempted}`,
  );
  console.log(`Standing = ${s.standing}`);

  console.log("Cleanup:");
  await db.result.deleteMany({ where: { studentId: student.id } });
  await db.student.delete({ where: { id: student.id } });
  await db.course.deleteMany({ where: { code: { startsWith: "DSUM" } } });
  await db.semester.deleteMany({ where: { sessionId: sess.id } });
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
