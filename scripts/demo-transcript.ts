/**
 * Runnable transcript-engine demo (DEV-ONLY). Generates a transcript (assemble →
 * bind → snapshot → sign → number → persist DRAFT), verifies its signature,
 * tampers with the stored snapshot to show verification fails, then approves it.
 * Cleans up. Run: npm run db:seed && npm run demo:transcript
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
import {
  PrismaInstitutionRepository,
  PrismaSettingRepository,
} from "../src/infrastructure/repositories/PrismaConfigRepositories";
import {
  PrismaTranscriptRepository,
  PrismaTranscriptTemplateRepository,
} from "../src/infrastructure/repositories/PrismaTranscriptRepository";
import { PrismaTranscriptNameResolver } from "../src/infrastructure/repositories/PrismaTranscriptNameResolver";
import { SealedSigningKeyProvider } from "../src/infrastructure/crypto/SealedSigningKeyProvider";
import { SecretBox } from "../src/infrastructure/crypto/SecretBox";
import { Argon2KeyDerivationService } from "../src/infrastructure/crypto/Argon2KeyDerivationService";
import { GradingConfigService } from "../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import { BuildReportData } from "../src/application/use-cases/transcripts/BuildReportData";
import { GenerateTranscript } from "../src/application/use-cases/transcripts/GenerateTranscript";
import {
  VerifyTranscript,
  ApproveTranscript,
} from "../src/application/use-cases/transcripts/VerifyTranscript";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { SessionContext } from "../src/domain/value-objects/SessionContext";
import type { ClockPort } from "../src/application/ports/ClockPort";

const clock: ClockPort = { now: () => new Date() };

async function main(): Promise<void> {
  const db = getPrisma();
  const settings = new PrismaSettingRepository(db);
  const registry = buildDefaultRegistry();
  // Phase 18: the signing private key is sealed; open it with the passphrase.
  const keyProvider = new SealedSigningKeyProvider(
    settings,
    registry,
    new SecretBox(new Argon2KeyDerivationService()),
  );
  const signer = await keyProvider.getSigner(
    process.env.EARTMP_KEY_PASSPHRASE ?? "eartmp-dev-passphrase",
  );

  const grading = new GradingConfigService(
    new PrismaGradeScaleRepository(db),
    new PrismaAssessmentConfigRepository(db),
    settings,
    registry,
  );
  const builder = new BuildReportData(
    new PrismaStudentRepository(db),
    new PrismaInstitutionRepository(db),
    new PrismaResultRepository(db),
    new PrismaCourseRepository(db),
    new PrismaTranscriptNameResolver(db),
    grading,
  );
  const transcripts = new PrismaTranscriptRepository(db);
  const generate = new GenerateTranscript(
    transcripts,
    new PrismaTranscriptTemplateRepository(db),
    new PrismaInstitutionRepository(db),
    builder,
    signer,
    clock,
    new PrismaAuditLogAdapter(db),
  );
  const verify = new VerifyTranscript(transcripts, signer);
  const approve = new ApproveTranscript(
    transcripts,
    new PrismaAuditLogAdapter(db),
  );
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "transcripts.read",
    "transcripts.generate",
    "transcripts.approve",
  ]);

  // Prerequisites: a student + a graded semester.
  const fac = await db.faculty.create({
    data: { name: "DTrSci", code: "DTR" },
  });
  const dep = await db.department.create({
    data: { name: "CS", code: "DTRCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc Computer Science", code: "DTRB", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "100", rank: 1, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({ data: { name: "DTR 24/25" } });
  const sem = await db.semester.create({
    data: { name: "First Semester", rank: 1, sessionId: sess.id },
  });
  const student = await db.student.create({
    data: {
      matricNumber: "DTR/0001",
      fullName: "Ada Lovelace",
      programmeId: prog.id,
      departmentId: dep.id,
      facultyId: fac.id,
      levelId: lvl.id,
    },
  });
  const cs = await db.course.create({
    data: {
      code: "DTRCS101",
      title: "Intro CS",
      creditValue: 3,
      programmeId: prog.id,
    },
  });
  await db.result.create({
    data: {
      studentId: student.id,
      courseId: cs.id,
      semesterId: sem.id,
      componentScores: "[]",
      finalScore: 85,
      grade: "A",
      gradePoint: 4,
      creditsEarned: 3,
      isLocked: true,
    },
  });

  console.log("1) Generate transcript:");
  const t = await generate.execute({ studentId: student.id }, admin);
  console.log(`   number ${t.transcriptNumber}, status ${t.status}`);

  console.log("2) Verify signature:");
  console.log(
    `   valid = ${(await verify.execute({ transcriptId: t.id }, admin)).valid}`,
  );

  console.log("3) Tamper with the stored snapshot → verify fails:");
  await db.transcript.update({
    where: { id: t.id },
    data: { snapshot: t.snapshot.replace("Ada Lovelace", "Mallory") },
  });
  console.log(
    `   valid = ${(await verify.execute({ transcriptId: t.id }, admin)).valid}`,
  );

  console.log("4) Approve (DRAFT → APPROVED):");
  // restore snapshot so approval reflects a valid doc
  await db.transcript.update({
    where: { id: t.id },
    data: { snapshot: t.snapshot },
  });
  const approved = await approve.execute({ transcriptId: t.id }, admin);
  console.log(`   status ${approved.status}`);

  console.log("5) Cleanup:");
  await db.transcript.deleteMany({ where: { studentId: student.id } });
  await db.result.deleteMany({ where: { studentId: student.id } });
  await db.student.delete({ where: { id: student.id } });
  await db.course.deleteMany({ where: { code: { startsWith: "DTR" } } });
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
