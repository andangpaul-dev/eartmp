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
  PrismaSubDepartmentRepository,
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
import {
  ListCourses,
  CreateCourse,
  UpdateCourse,
  DeleteCourse,
} from "../application/use-cases/records/ManageCourses";
import {
  ListFaculties,
  ListDepartments,
  ListProgrammes,
  ListLevels,
  CreateFaculty,
  UpdateFaculty,
  DeleteFaculty,
  CreateDepartment,
  UpdateDepartment,
  DeleteDepartment,
  CreateProgramme,
  UpdateProgramme,
  DeleteProgramme,
  CreateLevel,
  UpdateLevel,
  DeleteLevel,
} from "../application/use-cases/structure/ManageStructure";
import {
  CreateSubDepartment,
  UpdateSubDepartment,
  DeleteSubDepartment,
  ListSubDepartments,
} from "../application/use-cases/structure/ManageSubDepartments";
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
import { ImportStudents } from "../application/use-cases/records/ImportStudents";
import { GetAcademicSummary } from "../application/use-cases/results/GetAcademicSummary";
import { GraduationConfigService } from "../application/services/GraduationConfigService";
import { BuildReportData } from "../application/use-cases/transcripts/BuildReportData";
import { GenerateTranscript } from "../application/use-cases/transcripts/GenerateTranscript";
import {
  VerifyTranscript,
  ApproveTranscript,
  LockTranscript,
  RevokeTranscript,
} from "../application/use-cases/transcripts/VerifyTranscript";
import { ExportTranscript } from "../application/use-cases/transcripts/ExportTranscript";
import { ListTranscriptRecords } from "../application/use-cases/transcripts/ListTranscriptRecords";
import {
  EvaluateGraduation,
  GraduateStudent,
} from "../application/use-cases/graduation/Graduation";
import {
  GetAuditLog,
  VerifyAuditChain,
} from "../application/use-cases/audit/AuditQueries";
import {
  CreateBackup,
  VerifyBackup,
  RestoreBackup,
} from "../application/use-cases/backup/Backup";
import { PrismaDataExport } from "../infrastructure/backup/PrismaDataExport";
import { BackupCipher } from "../infrastructure/crypto/BackupCipher";
import {
  ListNotifications,
  MarkNotificationRead,
  MarkAllNotificationsRead,
} from "../application/use-cases/notifications/ManageNotifications";
import { WorkflowNotifier } from "../application/services/WorkflowNotifier";
import { PrismaNotificationRepository } from "../infrastructure/repositories/PrismaNotificationRepository";
import {
  GetInstitution,
  UpdateInstitution,
} from "../application/use-cases/config/ManageInstitution";
import {
  ListInstitutions,
  CreateInstitution,
  UpdateInstitutionById,
  DeleteInstitution,
  SetDefaultInstitution,
} from "../application/use-cases/config/ManageInstitutions";
import { UploadInstitutionAsset } from "../application/use-cases/config/UploadInstitutionAsset";
import { FileAssetStore } from "../infrastructure/storage/FileAssetStore";
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
import { ProvisionSigningKey } from "../application/use-cases/security/ProvisionSigningKey";
import { CryptoSigningKeyFactory } from "../infrastructure/crypto/CryptoSigningKeyFactory";
import {
  hasOwnSigningKey,
  resolveSigningPublic,
} from "../domain/settings/signingKeys";
import {
  CreateUser,
  DeactivateUser,
  ActivateUser,
  AssignRole,
  ResetUserPassword,
  UpdateUserDetails,
  ListUsers,
  ListRoles,
  SetUserFaculties,
} from "../application/use-cases/auth/ManageUsers";
import {
  CreateRole,
  UpdateRole,
  DeleteRole,
  SetRolePermissions,
  ListPermissions,
} from "../application/use-cases/auth/ManageRoles";
import { PrismaPermissionRepository } from "../infrastructure/repositories/PrismaAuthRepositories";
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
  // `students` (PrismaStudentRepository) also implements VersionedStudentWrites,
  // so these edits use optimistic locking (lost-update protection, F-27).
  const updateStudent = new UpdateStudent(students, audit, students);
  const changeStudentStatus = new ChangeStudentStatus(
    students,
    audit,
    students,
  );
  const deleteStudent = new DeleteStudent(students, audit);
  // Shared structure repos (reads + writes go through the same instances).
  const facultyRepo = new PrismaFacultyRepository(db);
  const departmentRepo = new PrismaDepartmentRepository(db);
  const subDepartmentRepo = new PrismaSubDepartmentRepository(db);
  const programmeRepo = new PrismaProgrammeRepository(db);
  const levelRepo = new PrismaLevelRepository(db);
  const listFaculties = new ListFaculties(facultyRepo);
  const listDepartments = new ListDepartments(departmentRepo);
  const listProgrammes = new ListProgrammes(programmeRepo);
  const listLevels = new ListLevels(levelRepo);
  const listSessions = new ListSessions(
    new PrismaAcademicSessionRepository(db),
  );
  const listSemesters = new ListSemesters(new PrismaSemesterRepository(db));
  const listCourses = new ListCourses(courses);
  const enterResult = new EnterResult(results, grading, audit, students);
  const getStudentSemesterResults = new GetStudentSemesterResults(
    results,
    students,
  );
  // students + levelRepo let ProcessSemester resolve a per-level grade scale.
  const processSemester = new ProcessSemester(
    uow,
    grading,
    students,
    levelRepo,
  );
  const lockSemesterResults = new LockSemesterResults(results, audit);
  const unlockResult = new UnlockResult(results, audit);
  const importResults = new ImportResults(grading, uow);
  const importStudents = new ImportStudents(uow);

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
  const lockTranscript = new LockTranscript(transcripts, audit);
  const revokeTranscript = new RevokeTranscript(transcripts, audit);
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

  // --- backup: encrypted logical export → verify (non-destructive) → restore ---
  const dataExport = new PrismaDataExport(db);
  const backupCipher = new BackupCipher(new Argon2KeyDerivationService());
  const createBackup = new CreateBackup(dataExport, backupCipher, clock, audit);
  const verifyBackup = new VerifyBackup(backupCipher);
  const restoreBackup = new RestoreBackup(dataExport, backupCipher, audit);

  // --- notifications: role-addressed workflow handoffs ---
  const notificationRepo = new PrismaNotificationRepository(db);
  const notifier = new WorkflowNotifier(notificationRepo);
  const listNotifications = new ListNotifications(notificationRepo);
  const markNotificationRead = new MarkNotificationRead(notificationRepo);
  const markAllNotificationsRead = new MarkAllNotificationsRead(
    notificationRepo,
  );

  // --- M6: configuration + security ---
  const getInstitution = new GetInstitution(institutions);
  const updateInstitution = new UpdateInstitution(institutions, audit);
  const listInstitutions = new ListInstitutions(institutions);
  const createInstitution = new CreateInstitution(institutions, audit);
  const updateInstitutionById = new UpdateInstitutionById(institutions, audit);
  // Branding images live next to the DB in the per-user app-data dir.
  const dbFile = (process.env.DATABASE_URL ?? "file:./prisma/dev.db").replace(
    /^file:/,
    "",
  );
  const brandingDir = `${dbFile.replace(/[\\/][^\\/]*$/, "")}/branding`;
  const uploadInstitutionAsset = new UploadInstitutionAsset(
    institutions,
    new FileAssetStore(brandingDir),
    audit,
  );
  const deleteInstitution = new DeleteInstitution(institutions, audit);
  const setDefaultInstitution = new SetDefaultInstitution(institutions, audit);
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
  const provisionSigningKey = new ProvisionSigningKey(
    settings,
    settingsRegistry,
    box,
    new CryptoSigningKeyFactory(),
    audit,
  );

  // --- user & role administration ---
  const listUsers = new ListUsers(users, roles);
  const listRoles = new ListRoles(roles);
  const createUser = new CreateUser(users, roles, hasher, audit);
  const setUserFaculties = new SetUserFaculties(users, facultyRepo, audit);
  const deactivateUser = new DeactivateUser(users, audit);
  const activateUser = new ActivateUser(users, audit);
  const assignRole = new AssignRole(users, roles, audit);
  const resetUserPassword = new ResetUserPassword(users, hasher, audit);
  const updateUserDetails = new UpdateUserDetails(users, audit);
  const permissionsRepo = new PrismaPermissionRepository(db);
  const createRole = new CreateRole(roles, audit);
  const updateRole = new UpdateRole(roles, audit);
  const deleteRole = new DeleteRole(roles, audit);
  const setRolePermissions = new SetRolePermissions(roles, audit);
  const listPermissions = new ListPermissions(permissionsRepo);

  // The transcript-signing key is sealed at rest. It is unsealed ONCE per host
  // session with the institution passphrase and held in memory; a lost
  // passphrase is unrecoverable. While sealed, signing operations are refused.
  const keyProvider = new SealedSigningKeyProvider(
    settings,
    settingsRegistry,
    box,
  );
  // Phase F: per-institution unsealed signers, keyed by institutionId; the empty
  // string is the shared global key. An institution with no dedicated key maps to
  // the global slot, so single-institution deployments behave exactly as before.
  const GLOBAL_SLOT = "";
  const signers = new Map<string, SignaturePort>();
  const slotFor = async (institutionId?: string | null): Promise<string> =>
    institutionId && (await hasOwnSigningKey(settings, institutionId))
      ? institutionId
      : GLOBAL_SLOT;
  // Sign path: resolve the unsealed signer for the issuing institution.
  const resolveSigner = async (
    institutionId: string,
  ): Promise<SignaturePort> => {
    const s = signers.get(await slotFor(institutionId));
    if (!s)
      throw new TranscriptError(
        "Signing key is sealed — unseal it with the institution passphrase first.",
      );
    return s;
  };
  // Verify path: a verify-only signer from the institution's public key (no unseal).
  const resolveVerifier = (
    institutionId?: string,
  ): Promise<SignaturePort | null> => keyProvider.getVerifier(institutionId);

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
    [
      "listSubDepartments",
      (i, s) =>
        authorize(new ListSubDepartments(subDepartmentRepo), i as never, s),
    ],
    // --- academic-structure management (Feature 2) ---
    [
      "createFaculty",
      (i, s) => authorize(new CreateFaculty(facultyRepo, audit), i as never, s),
    ],
    [
      "updateFaculty",
      (i, s) => authorize(new UpdateFaculty(facultyRepo, audit), i as never, s),
    ],
    [
      "deleteFaculty",
      (i, s) => authorize(new DeleteFaculty(facultyRepo, audit), i as never, s),
    ],
    [
      "createDepartment",
      (i, s) =>
        authorize(
          new CreateDepartment(departmentRepo, facultyRepo, audit),
          i as never,
          s,
        ),
    ],
    [
      "updateDepartment",
      (i, s) =>
        authorize(new UpdateDepartment(departmentRepo, audit), i as never, s),
    ],
    [
      "deleteDepartment",
      (i, s) =>
        authorize(new DeleteDepartment(departmentRepo, audit), i as never, s),
    ],
    [
      "createSubDepartment",
      (i, s) =>
        authorize(
          new CreateSubDepartment(subDepartmentRepo, departmentRepo, audit),
          i as never,
          s,
        ),
    ],
    [
      "updateSubDepartment",
      (i, s) =>
        authorize(
          new UpdateSubDepartment(subDepartmentRepo, audit),
          i as never,
          s,
        ),
    ],
    [
      "deleteSubDepartment",
      (i, s) =>
        authorize(
          new DeleteSubDepartment(subDepartmentRepo, audit),
          i as never,
          s,
        ),
    ],
    [
      "createProgramme",
      (i, s) =>
        authorize(
          new CreateProgramme(programmeRepo, departmentRepo, audit),
          i as never,
          s,
        ),
    ],
    [
      "updateProgramme",
      (i, s) =>
        authorize(new UpdateProgramme(programmeRepo, audit), i as never, s),
    ],
    [
      "deleteProgramme",
      (i, s) =>
        authorize(new DeleteProgramme(programmeRepo, audit), i as never, s),
    ],
    [
      "createLevel",
      (i, s) =>
        authorize(
          new CreateLevel(levelRepo, programmeRepo, audit),
          i as never,
          s,
        ),
    ],
    [
      "updateLevel",
      (i, s) => authorize(new UpdateLevel(levelRepo, audit), i as never, s),
    ],
    [
      "deleteLevel",
      (i, s) => authorize(new DeleteLevel(levelRepo, audit), i as never, s),
    ],
    [
      "createCourse",
      (i, s) => authorize(new CreateCourse(courses, audit), i as never, s),
    ],
    [
      "updateCourse",
      (i, s) => authorize(new UpdateCourse(courses, audit), i as never, s),
    ],
    [
      "deleteCourse",
      (i, s) => authorize(new DeleteCourse(courses, audit), i as never, s),
    ],
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
    ["importStudents", (i, s) => authorize(importStudents, i as never, s)],
    ["getAcademicSummary", (i, s) => authorize(academic, i as never, s)],
    [
      "approveTranscript",
      (i, s) => authorize(approveTranscript, i as never, s),
    ],
    ["lockTranscript", (i, s) => authorize(lockTranscript, i as never, s)],
    ["revokeTranscript", (i, s) => authorize(revokeTranscript, i as never, s)],
    [
      "evaluateGraduation",
      (i, s) => authorize(evaluateGraduation, i as never, s),
    ],
    ["graduateStudent", (i, s) => authorize(graduateStudent, i as never, s)],
    ["getAuditLog", (i, s) => authorize(getAuditLog, i as never, s)],
    ["verifyAuditChain", (i, s) => authorize(verifyAuditChain, i as never, s)],
    ["createBackup", (i, s) => authorize(createBackup, i as never, s)],
    ["verifyBackup", (i, s) => authorize(verifyBackup, i as never, s)],
    ["restoreBackup", (i, s) => authorize(restoreBackup, i as never, s)],
    [
      "listNotifications",
      (i, s) => authorize(listNotifications, i as never, s),
    ],
    [
      "markNotificationRead",
      (i, s) => authorize(markNotificationRead, i as never, s),
    ],
    [
      "markAllNotificationsRead",
      (i, s) => authorize(markAllNotificationsRead, i as never, s),
    ],
    ["getInstitution", (i, s) => authorize(getInstitution, i as never, s)],
    ["listInstitutions", (i, s) => authorize(listInstitutions, i as never, s)],
    [
      "createInstitution",
      (i, s) => authorize(createInstitution, i as never, s),
    ],
    [
      "updateInstitutionById",
      (i, s) => authorize(updateInstitutionById, i as never, s),
    ],
    [
      "uploadInstitutionAsset",
      (i, s) => authorize(uploadInstitutionAsset, i as never, s),
    ],
    [
      "deleteInstitution",
      (i, s) => authorize(deleteInstitution, i as never, s),
    ],
    [
      "setDefaultInstitution",
      (i, s) => authorize(setDefaultInstitution, i as never, s),
    ],
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
    ["listUsers", (i, s) => authorize(listUsers, i as never, s)],
    ["setUserFaculties", (i, s) => authorize(setUserFaculties, i as never, s)],
    ["listRoles", (i, s) => authorize(listRoles, i as never, s)],
    [
      "createUser",
      async (i, s) => {
        const u = await authorize(createUser, i as never, s);
        return { id: (u as { id: string }).id }; // never return the hash
      },
    ],
    ["deactivateUser", (i, s) => authorize(deactivateUser, i as never, s)],
    ["activateUser", (i, s) => authorize(activateUser, i as never, s)],
    ["assignRole", (i, s) => authorize(assignRole, i as never, s)],
    [
      "resetUserPassword",
      (i, s) => authorize(resetUserPassword, i as never, s),
    ],
    [
      "updateUserDetails",
      async (i, s) => {
        const u = await authorize(updateUserDetails, i as never, s);
        return { id: (u as { id: string }).id }; // never return the hash
      },
    ],
    ["listPermissions", (i, s) => authorize(listPermissions, i as never, s)],
    ["createRole", (i, s) => authorize(createRole, i as never, s)],
    ["updateRole", (i, s) => authorize(updateRole, i as never, s)],
    ["deleteRole", (i, s) => authorize(deleteRole, i as never, s)],
    [
      "setRolePermissions",
      (i, s) => authorize(setRolePermissions, i as never, s),
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
  registry.set("listTranscriptRecords", (i, s) =>
    authorize(new ListTranscriptRecords(transcripts), i as never, s),
  );

  // The seal state is per-institution (Phase F): the chip/Transcripts screen ask
  // about the caller's institution (or an explicit one), falling back to the
  // global key for unscoped operators / single-institution deployments.
  registry.set("keyState", async (i, s) => {
    requirePerm(s, "transcripts.read");
    const target =
      (i as { institutionId?: string }).institutionId ?? s?.institutionId;
    return { sealed: !signers.has(await slotFor(target)) };
  });
  // Admin key management (Feature 4 / Phase F): report whether a key exists + its
  // seal state for the global key or a specific institution's dedicated key.
  registry.set("keyStatus", async (i, s) => {
    requirePerm(s, "security.manage");
    const institutionId = (i as { institutionId?: string }).institutionId;
    if (institutionId) {
      const provisioned = await hasOwnSigningKey(settings, institutionId);
      return {
        provisioned,
        sealed: !signers.has(await slotFor(institutionId)),
        institutionId,
      };
    }
    const pub = await resolveSigningPublic(settings, settingsRegistry);
    return { provisioned: pub.length > 0, sealed: !signers.has(GLOBAL_SLOT) };
  });
  registry.set("provisionSigningKey", async (i, s) => {
    const result = await authorize(provisionSigningKey, i as never, s);
    // A freshly provisioned key must be re-unsealed before use this session.
    const institutionId = (i as { institutionId?: string }).institutionId;
    signers.delete(institutionId ?? GLOBAL_SLOT);
    return result;
  });
  registry.set("unsealKey", async (i, s) => {
    requirePerm(s, "transcripts.generate");
    const input = i as { passphrase: string; institutionId?: string };
    const slot = await slotFor(input.institutionId ?? s?.institutionId);
    const useInst = slot === GLOBAL_SLOT ? undefined : slot;
    signers.set(slot, await keyProvider.getSigner(input.passphrase, useInst));
    return { sealed: false };
  });
  registry.set("sealKey", async (i, s) => {
    requirePerm(s, "transcripts.generate");
    const target =
      (i as { institutionId?: string }).institutionId ?? s?.institutionId;
    signers.delete(await slotFor(target));
    return { sealed: true };
  });

  // Generate + verify resolve the issuing institution's key (Phase F). The
  // use-cases still run through `authorize` so the permission gate is uniform.
  const newGenerate = () =>
    new GenerateTranscript(
      transcripts,
      templates,
      institutions,
      reportBuilder,
      resolveSigner,
      clock,
      audit,
      students,
    );
  registry.set("generateTranscript", (i, s) =>
    authorize(newGenerate(), i as never, s),
  );
  // A certificate is the same signed-document pipeline with the CERTIFICATE
  // template + type (gated by the same transcripts.generate permission).
  registry.set("generateCertificate", (i, s) =>
    authorize(
      newGenerate(),
      {
        ...(i as object),
        category: "CERTIFICATE",
        type: "CERTIFICATE",
      } as never,
      s,
    ),
  );
  registry.set("verifyTranscript", (i, s) =>
    authorize(
      new VerifyTranscript(transcripts, resolveVerifier),
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

  // Wrap the task handlers that trigger a workflow handoff: after the task
  // succeeds, notify the next role (best-effort; never fails the task).
  for (const method of notifier.methods()) {
    const inner = registry.get(method);
    if (!inner) continue;
    registry.set(method, async (i, s) => {
      const result = await inner(i, s);
      if (s) await notifier.afterTask(method, s.actorId);
      return result;
    });
  }

  return { registry, authenticate };
}
