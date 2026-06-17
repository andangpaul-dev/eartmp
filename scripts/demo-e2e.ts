/**
 * End-to-end pipeline demo (DEV-ONLY, capstone — Phase 20). Runs the WHOLE
 * pipeline on the dev Prisma adapters: provision → admit → enter → process →
 * summary → transcript (sealed-key sign) → verify → approve → export PDF →
 * graduate → backup → verify audit chain. Self-provisioned + scoped cleanup; the
 * audit log is cleared at the start so this run's chain verifies cleanly.
 * Run: npm run db:seed && npm run demo:e2e
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaUnitOfWork } from "../src/infrastructure/persistence/PrismaUnitOfWork";
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
import {
  PrismaAuditLogAdapter,
  PrismaAuditLogQueryRepository,
} from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { PrismaDataExport } from "../src/infrastructure/backup/PrismaDataExport";
import { SecretBox } from "../src/infrastructure/crypto/SecretBox";
import { SealedSigningKeyProvider } from "../src/infrastructure/crypto/SealedSigningKeyProvider";
import { Argon2KeyDerivationService } from "../src/infrastructure/crypto/Argon2KeyDerivationService";
import { BackupCipher } from "../src/infrastructure/crypto/BackupCipher";
import { Sha256Hasher } from "../src/infrastructure/crypto/Sha256Hasher";
import { PdfMakeRenderer } from "../src/infrastructure/reporting/pdf/PdfMakeRenderer";
import { GradingConfigService } from "../src/application/services/GradingConfigService";
import { GraduationConfigService } from "../src/application/services/GraduationConfigService";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import { AdmitStudent } from "../src/application/use-cases/records/AdmitStudent";
import { EnterResult } from "../src/application/use-cases/results/ManageResults";
import { ProcessSemester } from "../src/application/use-cases/results/ProcessSemester";
import { GetAcademicSummary } from "../src/application/use-cases/results/GetAcademicSummary";
import { BuildReportData } from "../src/application/use-cases/transcripts/BuildReportData";
import { GenerateTranscript } from "../src/application/use-cases/transcripts/GenerateTranscript";
import {
  VerifyTranscript,
  ApproveTranscript,
} from "../src/application/use-cases/transcripts/VerifyTranscript";
import { ExportTranscript } from "../src/application/use-cases/transcripts/ExportTranscript";
import {
  EvaluateGraduation,
  GraduateStudent,
} from "../src/application/use-cases/graduation/Graduation";
import { CreateBackup } from "../src/application/use-cases/backup/Backup";
import { VerifyAuditChain } from "../src/application/use-cases/audit/AuditQueries";
import { SessionContext } from "../src/domain/value-objects/SessionContext";
import type { ClockPort } from "../src/application/ports/ClockPort";

const clock: ClockPort = { now: () => new Date() };
const PASS = process.env.EARTMP_KEY_PASSPHRASE ?? "eartmp-dev-passphrase";

async function main(): Promise<void> {
  const db = getPrisma();
  const settings = new PrismaSettingRepository(db);
  const registry = buildDefaultRegistry();
  const uow = new PrismaUnitOfWork(db);
  const students = new PrismaStudentRepository(db);
  const courses = new PrismaCourseRepository(db);
  const results = new PrismaResultRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const grading = new GradingConfigService(
    new PrismaGradeScaleRepository(db),
    new PrismaAssessmentConfigRepository(db),
    settings,
    registry,
  );
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "students.create",
    "results.process",
    "results.read",
    "transcripts.generate",
    "transcripts.approve",
    "transcripts.read",
    "graduation.read",
    "graduation.clear",
    "backup.create",
    "audit.read",
  ]);

  console.log("0) Fresh audit chain for this run:");
  await db.auditLog.deleteMany({});
  console.log("   cleared audit log");

  // Provision structure (FKs).
  const fac = await db.faculty.create({ data: { name: "DE2E", code: "DE2E" } });
  const dep = await db.department.create({
    data: { name: "CS", code: "DE2ECS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc Computer Science", code: "DE2EB", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "400", rank: 4, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({
    data: { name: "DE2E 24/25" },
  });
  const sem = await db.semester.create({
    data: { name: "First Semester", rank: 1, sessionId: sess.id },
  });
  const cs = await db.course.create({
    data: {
      code: "DE2ECS401",
      title: "Algorithms",
      creditValue: 3,
      programmeId: prog.id,
    },
  });
  const ma = await db.course.create({
    data: {
      code: "DE2EMA401",
      title: "Analysis",
      creditValue: 2,
      programmeId: prog.id,
    },
  });

  console.log("1) Admit (atomic student + enrollment):");
  const admitted = await new AdmitStudent(uow).execute(
    {
      matricNumber: "DE2E/0001",
      fullName: "Ada Lovelace",
      programmeId: prog.id,
      levelId: lvl.id,
      fromSession: sess.name,
    },
    admin,
  );
  const studentId = admitted.student.id;
  console.log(`   ${admitted.student.matricNumber} admitted`);

  console.log("2) Enter + process results:");
  const enter = new EnterResult(results, grading, audit);
  await enter.execute(
    {
      studentId,
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
      studentId,
      courseId: ma.id,
      semesterId: sem.id,
      componentScores: [
        { key: "ca", score: 27 },
        { key: "exam", score: 63 },
      ],
    },
    admin,
  );
  const gpa = await new ProcessSemester(uow, grading).execute(
    { studentId, semesterId: sem.id },
    admin,
  );
  console.log(`   semester GPA ${gpa.gpa}`);

  console.log("3) Academic summary:");
  const academic = new GetAcademicSummary(results, courses, grading);
  const summary = await academic.execute({ studentId }, admin);
  console.log(`   CGPA ${summary.cgpa}, standing ${summary.standing}`);

  console.log(
    "4) Transcript: generate (sealed-key sign) → verify → approve → export PDF:",
  );
  const signer = await new SealedSigningKeyProvider(
    settings,
    registry,
    new SecretBox(new Argon2KeyDerivationService()),
  ).getSigner(PASS);
  const builder = new BuildReportData(
    students,
    new PrismaInstitutionRepository(db),
    results,
    courses,
    new PrismaTranscriptNameResolver(db),
    grading,
  );
  const transcripts = new PrismaTranscriptRepository(db);
  const t = await new GenerateTranscript(
    transcripts,
    new PrismaTranscriptTemplateRepository(db),
    new PrismaInstitutionRepository(db),
    builder,
    signer,
    clock,
    audit,
    new PrismaStudentRepository(db),
  ).execute({ studentId }, admin);
  const verified = await new VerifyTranscript(transcripts, signer).execute(
    { transcriptId: t.id },
    admin,
  );
  await new ApproveTranscript(transcripts, audit).execute(
    { transcriptId: t.id },
    admin,
  );
  const pdf = await new ExportTranscript(
    transcripts,
    new PdfMakeRenderer(),
    audit,
  ).execute({ transcriptId: t.id }, admin);
  const isPdf = pdf.bytes[0] === 0x25 && pdf.bytes[1] === 0x50;
  console.log(
    `   ${t.transcriptNumber}: verified=${verified.valid}, PDF ${pdf.bytes.length} bytes (%PDF=${isPdf})`,
  );

  console.log("5) Graduation: evaluate → clear:");
  const gradConfig = new GraduationConfigService(settings, registry);
  const elig = await new EvaluateGraduation(academic, gradConfig).execute(
    { studentId },
    admin,
  );
  const cleared = await new GraduateStudent(
    academic,
    gradConfig,
    students,
    audit,
  ).execute({ studentId }, admin);
  console.log(`   eligible=${elig.eligible} → status ${cleared.status}`);

  console.log("6) Backup (encrypted) + verify audit chain:");
  const backup = await new CreateBackup(
    new PrismaDataExport(db),
    new BackupCipher(new Argon2KeyDerivationService()),
    clock,
    audit,
  ).execute({ passphrase: PASS }, admin);
  const backupRows = Object.values(backup.manifest.tables).reduce(
    (s, n) => s + n,
    0,
  );
  const chain = await new VerifyAuditChain(
    new PrismaAuditLogQueryRepository(db),
    new Sha256Hasher(),
  ).execute({}, admin);
  console.log(
    `   backup ${backupRows} rows; audit chain valid=${chain.valid} (checked ${chain.checked})`,
  );

  console.log("7) Cleanup:");
  await db.transcript.deleteMany({ where: { studentId } });
  await db.result.deleteMany({ where: { studentId } });
  await db.studentEnrollment.deleteMany({ where: { studentId } });
  await db.student.delete({ where: { id: studentId } });
  await db.course.deleteMany({ where: { code: { startsWith: "DE2E" } } });
  await db.semester.delete({ where: { id: sem.id } });
  await db.academicSession.delete({ where: { id: sess.id } });
  await db.level.delete({ where: { id: lvl.id } });
  await db.programme.delete({ where: { id: prog.id } });
  await db.department.delete({ where: { id: dep.id } });
  await db.faculty.delete({ where: { id: fac.id } });
  console.log("   ✓ cleaned up");
  console.log("\nEnd-to-end pipeline: GREEN ✅");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
