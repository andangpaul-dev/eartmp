/**
 * Host composition root (shell phase, Node sidecar). The ONE trusted place that
 * builds the concrete infrastructure (Prisma + crypto + …) and binds it into the
 * application use-cases. The webview never sees any of this — it calls the host
 * over IPC. Not scanned by the architecture fitness test (host is the trusted
 * seam), so it may import infrastructure + application freely.
 *
 * Most registry entries are gated thunks `(input, session) => authorize(uc, …)`.
 * A few derived reads (assessment structure, live final-score preview, workbook
 * parsing) are gated inline against the same permissions.
 */
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../infrastructure/db/prisma";
import { Argon2HashingService } from "../infrastructure/crypto/Argon2HashingService";
import { PrismaUnitOfWork } from "../infrastructure/persistence/PrismaUnitOfWork";
import {
  PrismaStudentRepository,
  PrismaCourseRepository,
  PrismaResultRepository,
} from "../infrastructure/repositories/PrismaRecordsRepositories";
import {
  PrismaUserRepository,
  PrismaRoleRepository,
  PrismaAuditLogAdapter,
} from "../infrastructure/repositories/PrismaAuthRepositories";
import {
  PrismaFacultyRepository,
  PrismaDepartmentRepository,
  PrismaProgrammeRepository,
  PrismaLevelRepository,
  PrismaAcademicSessionRepository,
  PrismaSemesterRepository,
} from "../infrastructure/repositories/PrismaStructureRepositories";
import {
  PrismaGradeScaleRepository,
  PrismaAssessmentConfigRepository,
} from "../infrastructure/repositories/PrismaGradingRepositories";
import {
  PrismaSettingRepository,
  PrismaInstitutionRepository,
} from "../infrastructure/repositories/PrismaConfigRepositories";
import {
  PrismaTranscriptRepository,
  PrismaTranscriptTemplateRepository,
} from "../infrastructure/repositories/PrismaTranscriptRepository";
import { PrismaTranscriptNameResolver } from "../infrastructure/repositories/PrismaTranscriptNameResolver";
import { PrismaAuditLogQueryRepository } from "../infrastructure/repositories/PrismaAuthRepositories";
import { SheetJsReader } from "../infrastructure/import/SheetJsReader";
import { SecretBox } from "../infrastructure/crypto/SecretBox";
import { SealedSigningKeyProvider } from "../infrastructure/crypto/SealedSigningKeyProvider";
import { Argon2KeyDerivationService } from "../infrastructure/crypto/Argon2KeyDerivationService";
import { Sha256Hasher } from "../infrastructure/crypto/Sha256Hasher";
import { PdfMakeRenderer } from "../infrastructure/reporting/pdf/PdfMakeRenderer";
import { authorize } from "../application/authorization/AuthorizedUseCase";
import { GradingConfigService } from "../application/services/GradingConfigService";
import { AuthenticateUser } from "../application/use-cases/auth/AuthenticateUser";
import { ChangePassword } from "../application/use-cases/auth/ChangePassword";
import {
  ListStudents,
  GetStudent,
  UpdateStudent,
  ChangeStudentStatus,
  DeleteStudent,
} from "../application/use-cases/records/ManageStudents";
import { AdmitStudent } from "../application/use-cases/records/AdmitStudent";
import { ListCourses } from "../application/use-cases/records/ManageCourses";
import {
  ListFaculties,
  ListDepartments,
  ListProgrammes,
  ListLevels,
} from "../application/use-cases/structure/ManageStructure";
import {
  ListSessions,
  ListSemesters,
} from "../application/use-cases/structure/ManageCalendar";
import {
  EnterResult,
  GetStudentSemesterResults,
  LockSemesterResults,
  UnlockResult,
} from "../application/use-cases/results/ManageResults";
import { ProcessSemester } from "../application/use-cases/results/ProcessSemester";
import { ImportResults } from "../application/use-cases/results/ImportResults";
import { GetAcademicSummary } from "../application/use-cases/results/GetAcademicSummary";
import { GraduationConfigService } from "../application/services/GraduationConfigService";
import { BuildReportData } from "../application/use-cases/transcripts/BuildReportData";
import { GenerateTranscript } from "../application/use-cases/transcripts/GenerateTranscript";
import {
  VerifyTranscript,
  ApproveTranscript,
} from "../application/use-cases/transcripts/VerifyTranscript";
import { ExportTranscript } from "../application/use-cases/transcripts/ExportTranscript";
import {
  EvaluateGraduation,
  GraduateStudent,
} from "../application/use-cases/graduation/Graduation";
import {
  GetAuditLog,
  VerifyAuditChain,
} from "../application/use-cases/audit/AuditQueries";
import {
  GetInstitution,
  UpdateInstitution,
} from "../application/use-cases/config/ManageInstitution";
import {
  GetSetting,
  SetSetting,
} from "../application/use-cases/config/ManageSettings";
import {
  ListGradeScales,
  SetDefaultGradeScale,
} from "../application/use-cases/config/ManageGradeScales";
import {
  ListAssessmentConfigs,
  SetDefaultAssessmentConfig,
} from "../application/use-cases/config/ManageAssessmentConfigs";
import { ChangeKeyPassphrase } from "../application/use-cases/security/ChangeKeyPassphrase";
import { buildDefaultRegistry } from "../domain/settings/SettingsRegistry";
import { AuthorizationError } from "../domain/errors/auth";
import { TranscriptError } from "../domain/errors/transcript";
import { SessionContext } from "../domain/value-objects/SessionContext";
import type { ComponentScore } from "../domain/value-objects/AssessmentStructure";
import type { SignaturePort } from "../application/ports/SignaturePort";
import type { ClockPort } from "../application/ports/ClockPort";

export type Handler = (
  input: unknown,
  session: SessionContext | null,
) => Promise<unknown>;

export interface Host {
  registry: Map<string, Handler>;
  authenticate: AuthenticateUser;
}

const clock: ClockPort = { now: () => new Date() };

function requirePerm(session: SessionContext | null, perm: string): void {
  if (!session || !session.has(perm)) {
    throw new AuthorizationError(`Requires "${perm}".`);
  }
}

export function buildHost(db: PrismaClient = getPrisma()): Host {
  // --- infrastructure ---
  const students = new PrismaStudentRepository(db);
  const courses = new PrismaCourseRepository(db);
  const results = new PrismaResultRepository(db);
  const users = new PrismaUserRepository(db);
  const roles = new PrismaRoleRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const hasher = new Argon2HashingService();
  const uow = new PrismaUnitOfWork(db);
  const settings = new PrismaSettingRepository(db);
  const settingsRegistry = buildDefaultRegistry();
  const gradeScales = new PrismaGradeScaleRepository(db);
  const assessmentConfigs = new PrismaAssessmentConfigRepository(db);
  const box = new SecretBox(new Argon2KeyDerivationService());
  const grading = new GradingConfigService(
    gradeScales,
    assessmentConfigs,
    settings,
    settingsRegistry,
  );

  // --- use-cases ---
  const authenticate = new AuthenticateUser(users, roles, hasher, audit, clock);
  const changePassword = new ChangePassword(users, hasher, audit);
  const listStudents = new ListStudents(students);
  const getStudent = new GetStudent(students);
  const admitStudent = new AdmitStudent(uow);
  const updateStudent = new UpdateStudent(students, audit);
  const changeStudentStatus = new ChangeStudentStatus(students, audit);
  const deleteStudent = new DeleteStudent(students, audit);
  const listFaculties = new ListFaculties(new PrismaFacultyRepository(db));
  const listDepartments = new ListDepartments(
    new PrismaDepartmentRepository(db),
  );
  const listProgrammes = new ListProgrammes(new PrismaProgrammeRepository(db));
  const listLevels = new ListLevels(new PrismaLevelRepository(db));
  const listSessions = new ListSessions(
    new PrismaAcademicSessionRepository(db),
  );
  const listSemesters = new ListSemesters(new PrismaSemesterRepository(db));
  const listCourses = new ListCourses(courses);
  const enterResult = new EnterResult(results, grading, audit);
  const getStudentSemesterResults = new GetStudentSemesterResults(results);
  const processSemester = new ProcessSemester(uow, grading);
  const lockSemesterResults = new LockSemesterResults(results, audit);
  const unlockResult = new UnlockResult(results, audit);
  const importResults = new ImportResults(
    students,
    courses,
    results,
    grading,
    uow,
  );

  // --- M5: summary / transcripts / graduation / audit ---
  const institutions = new PrismaInstitutionRepository(db);
  const transcripts = new PrismaTranscriptRepository(db);
  const templates = new PrismaTranscriptTemplateRepository(db);
  const academic = new GetAcademicSummary(results, courses, grading);
  const reportBuilder = new BuildReportData(
    students,
    institutions,
    results,
    courses,
    new PrismaTranscriptNameResolver(db),
    grading,
  );
  const approveTranscript = new ApproveTranscript(transcripts, audit);
  const gradConfig = new GraduationConfigService(settings, settingsRegistry);
  const evaluateGraduation = new EvaluateGraduation(academic, gradConfig);
  const graduateStudent = new GraduateStudent(
    academic,
    gradConfig,
    students,
    audit,
  );
  const getAuditLog = new GetAuditLog(new PrismaAuditLogQueryRepository(db));
  const verifyAuditChain = new VerifyAuditChain(
    new PrismaAuditLogQueryRepository(db),
    new Sha256Hasher(),
  );

  // --- M6: configuration + security ---
  const getInstitution = new GetInstitution(institutions);
  const updateInstitution = new UpdateInstitution(institutions, audit);
  const getSetting = new GetSetting(settings, settingsRegistry);
  const setSetting = new SetSetting(settings, settingsRegistry, audit);
  const listGradeScales = new ListGradeScales(gradeScales);
  const setDefaultGradeScale = new SetDefaultGradeScale(gradeScales, audit);
  const listAssessmentConfigs = new ListAssessmentConfigs(assessmentConfigs);
  const setDefaultAssessmentConfig = new SetDefaultAssessmentConfig(
    assessmentConfigs,
    audit,
  );
  const changeKeyPassphrase = new ChangeKeyPassphrase(
    settings,
    settingsRegistry,
    box,
    audit,
  );

  // The transcript-signing key is sealed at rest. It is unsealed ONCE per host
  // session with the institution passphrase and held in memory; a lost
  // passphrase is unrecoverable. While sealed, signing operations are refused.
  const keyProvider = new SealedSigningKeyProvider(
    settings,
    settingsRegistry,
    box,
  );
  let signer: SignaturePort | null = null;
  const requireSigner = (): SignaturePort => {
    if (!signer)
      throw new TranscriptError(
        "Signing key is sealed — unseal it with the institution passphrase first.",
      );
    return signer;
  };

  const registry = new Map<string, Handler>([
    ["changePassword", (i, s) => authorize(changePassword, i as never, s)],
    ["listStudents", (i, s) => authorize(listStudents, i as never, s)],
    ["getStudent", (i, s) => authorize(getStudent, i as never, s)],
    ["admitStudent", (i, s) => authorize(admitStudent, i as never, s)],
    ["updateStudent", (i, s) => authorize(updateStudent, i as never, s)],
    [
      "changeStudentStatus",
      (i, s) => authorize(changeStudentStatus, i as never, s),
    ],
    ["deleteStudent", (i, s) => authorize(deleteStudent, i as never, s)],
    ["listFaculties", (i, s) => authorize(listFaculties, i as never, s)],
    ["listDepartments", (i, s) => authorize(listDepartments, i as never, s)],
    ["listProgrammes", (i, s) => authorize(listProgrammes, i as never, s)],
    ["listLevels", (i, s) => authorize(listLevels, i as never, s)],
    ["listSessions", (i, s) => authorize(listSessions, i as never, s)],
    ["listSemesters", (i, s) => authorize(listSemesters, i as never, s)],
    ["listCourses", (i, s) => authorize(listCourses, i as never, s)],
    ["enterResult", (i, s) => authorize(enterResult, i as never, s)],
    [
      "getStudentSemesterResults",
      (i, s) => authorize(getStudentSemesterResults, i as never, s),
    ],
    ["processSemester", (i, s) => authorize(processSemester, i as never, s)],
    [
      "lockSemesterResults",
      (i, s) => authorize(lockSemesterResults, i as never, s),
    ],
    ["unlockResult", (i, s) => authorize(unlockResult, i as never, s)],
    ["importResults", (i, s) => authorize(importResults, i as never, s)],
    ["getAcademicSummary", (i, s) => authorize(academic, i as never, s)],
    [
      "approveTranscript",
      (i, s) => authorize(approveTranscript, i as never, s),
    ],
    [
      "evaluateGraduation",
      (i, s) => authorize(evaluateGraduation, i as never, s),
    ],
    ["graduateStudent", (i, s) => authorize(graduateStudent, i as never, s)],
    ["getAuditLog", (i, s) => authorize(getAuditLog, i as never, s)],
    ["verifyAuditChain", (i, s) => authorize(verifyAuditChain, i as never, s)],
    ["getInstitution", (i, s) => authorize(getInstitution, i as never, s)],
    [
      "updateInstitution",
      (i, s) => authorize(updateInstitution, i as never, s),
    ],
    ["getSetting", (i, s) => authorize(getSetting, i as never, s)],
    ["setSetting", (i, s) => authorize(setSetting, i as never, s)],
    ["listGradeScales", (i, s) => authorize(listGradeScales, i as never, s)],
    [
      "setDefaultGradeScale",
      (i, s) => authorize(setDefaultGradeScale, i as never, s),
    ],
    [
      "listAssessmentConfigs",
      (i, s) => authorize(listAssessmentConfigs, i as never, s),
    ],
    [
      "setDefaultAssessmentConfig",
      (i, s) => authorize(setDefaultAssessmentConfig, i as never, s),
    ],
    [
      "changeKeyPassphrase",
      (i, s) => authorize(changeKeyPassphrase, i as never, s),
    ],
  ]);

  // Derived reads (gated inline) — the live final score comes from the CORE's
  // assessment structure, never client math.
  registry.set("getAssessmentStructure", async (_i, s) => {
    requirePerm(s, "results.process");
    return (await grading.loadAssessmentStructure()).toComponents();
  });
  registry.set("previewFinalScore", async (i, s) => {
    requirePerm(s, "results.process");
    const structure = await grading.loadAssessmentStructure();
    return structure.computeFinalScore(
      (i as { componentScores: ComponentScore[] }).componentScores,
    );
  });
  registry.set("parseWorkbook", async (i, s) => {
    requirePerm(s, "results.import");
    const bytes = new Uint8Array(
      Buffer.from((i as { base64: string }).base64, "base64"),
    );
    return new SheetJsReader().read(bytes);
  });

  // --- transcript listing + sealed-key lifecycle (gated inline) ---
  registry.set("listTranscripts", async (i, s) => {
    requirePerm(s, "transcripts.read");
    return transcripts.findByStudent((i as { studentId: string }).studentId);
  });

  registry.set("keyState", async (_i, s) => {
    requirePerm(s, "transcripts.read");
    return { sealed: signer === null };
  });
  registry.set("unsealKey", async (i, s) => {
    requirePerm(s, "transcripts.generate");
    signer = await keyProvider.getSigner(
      (i as { passphrase: string }).passphrase,
    );
    return { sealed: false };
  });
  registry.set("sealKey", async (_i, s) => {
    requirePerm(s, "transcripts.generate");
    signer = null;
    return { sealed: true };
  });

  // Generate + verify need the unsealed signer; approve/export do not. The
  // use-cases still run through `authorize` so the permission gate is uniform.
  registry.set("generateTranscript", (i, s) =>
    authorize(
      new GenerateTranscript(
        transcripts,
        templates,
        institutions,
        reportBuilder,
        requireSigner(),
        clock,
        audit,
      ),
      i as never,
      s,
    ),
  );
  registry.set("verifyTranscript", (i, s) =>
    authorize(
      new VerifyTranscript(transcripts, requireSigner()),
      i as never,
      s,
    ),
  );
  registry.set("exportTranscript", async (i, s) => {
    const result = await authorize(
      new ExportTranscript(transcripts, new PdfMakeRenderer(), audit),
      i as never,
      s,
    );
    // Bytes don't survive JSON transport — hand the webview base64 to download.
    const r = result as {
      bytes: Uint8Array;
      filename: string;
      contentType: string;
    };
    return {
      base64: Buffer.from(r.bytes).toString("base64"),
      filename: r.filename,
      contentType: r.contentType,
    };
  });

  return { registry, authenticate };
}
