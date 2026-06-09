/**
 * Runnable grading demo (DEV-ONLY). Loads the institution's configured grade
 * scale, assessment structure, and standing bands from the seeded `dev.db`
 * through the single validated GradingConfigService, then drives the pure
 * engines to grade a sample student.
 *
 * Run: npm run db:seed && npm run demo:grading
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaGradeScaleRepository,
  PrismaAssessmentConfigRepository,
} from "../src/infrastructure/repositories/PrismaGradingRepositories";
import { PrismaSettingRepository } from "../src/infrastructure/repositories/PrismaConfigRepositories";
import { GradingConfigService } from "../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import { GpaEngine } from "../src/domain/services/GpaEngine";

async function main(): Promise<void> {
  const db = getPrisma();
  const config = new GradingConfigService(
    new PrismaGradeScaleRepository(db),
    new PrismaAssessmentConfigRepository(db),
    new PrismaSettingRepository(db),
    buildDefaultRegistry(),
  );

  const scale = await config.loadGradeScale();
  const assessment = await config.loadAssessmentStructure();
  const standingBands = await config.loadStandingBands();
  console.log("Loaded config from DB (validated):");
  console.log(`   grade scale: ${scale.toBands().length} bands`);
  console.log(
    `   assessment:  ${assessment
      .toComponents()
      .map((c) => `${c.key}=${c.weight}%`)
      .join(", ")}`,
  );

  // Compute a final score from raw component scores, then grade the semester.
  const engine = new GpaEngine(scale);
  const examFinal = assessment.computeFinalScore([
    { key: "ca", score: 25 },
    { key: "exam", score: 60 },
  ]);
  console.log(`\nComputed final score (CA 25/30 + Exam 60/70) = ${examFinal}`);

  const summary = engine.processSemester([
    { courseCode: "CS101", creditValue: 3, finalScore: 82 },
    { courseCode: "MA101", creditValue: 4, finalScore: examFinal },
    { courseCode: "PH101", creditValue: 2, finalScore: 41 },
  ]);
  console.log("\nSemester result:");
  for (const c of summary.courses) {
    console.log(
      `   ${c.courseCode}: ${c.finalScore} → ${c.grade} (${c.gradePoint}) credits ${c.creditsEarned}/${c.creditValue}`,
    );
  }
  console.log(
    `   GPA = ${summary.gpa}, credits earned ${summary.creditsEarned}`,
  );
  console.log(
    `   Standing = ${GpaEngine.resolveStanding(summary.gpa, standingBands)}`,
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
