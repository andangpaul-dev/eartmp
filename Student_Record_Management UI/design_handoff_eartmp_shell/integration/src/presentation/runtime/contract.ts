/**
 * EARTMP — UI ⇄ Core contract (host/webview split, reconciled to the real core)
 * ============================================================================
 * Target: `src/presentation/runtime/contract.ts`
 *
 * This is the ONLY surface the React webview sees. It is PURE (types +
 * a metadata map) — no infrastructure, no DI container, no `authorize`.
 * That keeps the repo's architecture boundary intact (the webview must
 * not import `src/infrastructure/**`; the trusted HOST side does — see
 * ../../host/dispatcher.ts).
 *
 * Three things live here:
 *   1. SessionView   — the read-only projection of SessionContext the UI renders.
 *   2. CoreApi       — the typed methods the UI calls (camelCase verbs).
 *   3. USE_CASE      — maps each verb → the real core use-case `.name`
 *                      (PascalCase class), so the host dispatcher can resolve it.
 *
 * Method names are UI-facing verbs; the strings in USE_CASE are the core's
 * actual class names (read from src/application/use-cases/**). Keep them in
 * sync with the core.
 */

/* ── Real input/output types, imported straight from the core (type-only,
 *    pure — safe for the webview). Adjust the relative depth/alias to taste. */
import type { AuthenticateUserInput } from "../../application/use-cases/auth/AuthenticateUser";
import type { ChangePasswordInput } from "../../application/use-cases/auth/ChangePassword";

import type {
  GetStudentInput,
  UpdateStudentInput,
  ChangeStudentStatusInput,
} from "../../application/use-cases/records/ManageStudents";
import type {
  AdmitStudentInput,
  AdmitStudentResult,
} from "../../application/use-cases/records/AdmitStudent";
import type { Student, ResultRecord } from "../../domain/entities";
import type { Page, StudentQuery } from "../../domain/repositories/records";

import type {
  EnterResultInput,
  UnlockResultInput,
  LockSemesterResultsInput,
  GetStudentSemesterResultsInput,
} from "../../application/use-cases/results/ManageResults";
import type { ProcessSemesterUseCaseInput } from "../../application/use-cases/results/ProcessSemester";
import type {
  ImportResultsInput,
  ImportReport,
} from "../../application/use-cases/results/ImportResults";
import type {
  GetAcademicSummaryInput,
  AcademicSummary,
} from "../../application/use-cases/results/GetAcademicSummary";

import type { GenerateTranscriptInput } from "../../application/use-cases/transcripts/GenerateTranscript";
import type {
  VerifyTranscriptInput,
  VerifyResult,
  ApproveTranscriptInput,
} from "../../application/use-cases/transcripts/VerifyTranscript";
import type {
  ExportTranscriptInput,
  ExportResult,
} from "../../application/use-cases/transcripts/ExportTranscript";
import type { StoredTranscript } from "../../domain/repositories/transcripts";

import type {
  GraduationInput,
  GraduateResult,
} from "../../application/use-cases/graduation/Graduation";
import type { EligibilityReport } from "../../domain/services/GraduationEligibility";

import type { AuditQuery } from "../../domain/repositories/audit";
import type {
  AuditEntry,
  ChainVerification,
} from "../../domain/services/AuditChain";

export type {
  Student,
  ResultRecord,
  Page,
  StudentQuery,
  AcademicSummary,
  ImportReport,
  StoredTranscript,
  VerifyResult,
  ExportResult,
  EligibilityReport,
  AuditEntry,
  ChainVerification,
  AdmitStudentInput,
  AdmitStudentResult,
  ChangeStudentStatusInput,
};

/* ───────────────────────────── SessionView ───────────────────────────── */
/**
 * SessionContext is a class with methods and lives host-side. Across the
 * boundary the UI receives this plain projection (built by the host's
 * `toSessionView`). The UI checks permissions against `permissions[]`.
 */
export interface SessionView {
  actorId: string;
  roleName: string; // e.g. "REGISTRAR"
  permissions: string[]; // resolved from the role by the core
  fullName?: string;
  mustChangePassword?: boolean; // surface the "change default password" banner
  keyUnlocked?: boolean; // operator signing key unsealed this session?
}

/* Inputs with no dedicated core type (session lifecycle / security). */
export interface UnlockSigningKeyInput {
  passphrase: string;
}

/* ────────────────────────────── CoreApi ──────────────────────────────── */
/**
 * The typed methods the React UI calls. The webview client (ipcClient.ts)
 * implements this by forwarding to the host; the host dispatcher resolves
 * each to the real use-case and runs it through `authorize`.
 */
export interface CoreApi {
  /* Auth & session (lifecycle — host owns the session) */
  login(input: AuthenticateUserInput): Promise<SessionView>;
  logout(): Promise<void>;
  currentUser(): Promise<SessionView | null>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  /** Unseal the signing key for this session. ⚠ confirm the host op/use-case. */
  unlockSigningKey(input: UnlockSigningKeyInput): Promise<void>;

  /* Students */
  listStudents(input: StudentQuery): Promise<Page<Student>>;
  getStudent(input: GetStudentInput): Promise<Student>;
  admitStudent(input: AdmitStudentInput): Promise<AdmitStudentResult>;
  updateStudent(input: UpdateStudentInput): Promise<Student>;
  changeStudentStatus(input: ChangeStudentStatusInput): Promise<Student>;

  /* Results */
  getStudentSemesterResults(
    input: GetStudentSemesterResultsInput,
  ): Promise<ResultRecord[]>;
  enterResult(input: EnterResultInput): Promise<ResultRecord>;
  lockSemesterResults(input: LockSemesterResultsInput): Promise<number>;
  unlockResult(input: UnlockResultInput): Promise<void>;
  processSemester(input: ProcessSemesterUseCaseInput): Promise<unknown>;

  /* Import */
  importResults(input: ImportResultsInput): Promise<ImportReport>;

  /* Summary & transcripts */
  getAcademicSummary(input: GetAcademicSummaryInput): Promise<AcademicSummary>;
  generateTranscript(input: GenerateTranscriptInput): Promise<StoredTranscript>;
  verifyTranscript(input: VerifyTranscriptInput): Promise<VerifyResult>;
  approveTranscript(input: ApproveTranscriptInput): Promise<StoredTranscript>;
  exportTranscript(input: ExportTranscriptInput): Promise<ExportResult>;

  /* Graduation */
  evaluateGraduation(input: GraduationInput): Promise<EligibilityReport>;
  graduateStudent(input: GraduationInput): Promise<GraduateResult>;

  /* Audit */
  getAuditLog(input: AuditQuery): Promise<Page<AuditEntry>>;
  verifyAuditChain(input: Record<string, never>): Promise<ChainVerification>;
}

export type CoreMethod = keyof CoreApi;

/* ────────────────────────────── USE_CASE ─────────────────────────────── */
/**
 * verb → core use-case class `.name`. The host dispatcher resolves the
 * instance from the DI container by this name and runs `authorize` (which
 * reads the use-case's own `requiredPermissions`). `lifecycle: true` marks
 * the session methods the dispatcher handles specially (login/logout/
 * currentUser) — no 1:1 use-case, or it mutates the host session.
 *
 * ⚠ RECONCILE the `name` strings if any core class is renamed. The required
 * permission for each is declared ON the use-case in the core — do NOT
 * duplicate it here; the gate reads it there.
 */
export const USE_CASE: Record<
  CoreMethod,
  { name: string; lifecycle?: boolean }
> = {
  login: { name: "AuthenticateUser", lifecycle: true },
  logout: { name: "-", lifecycle: true },
  currentUser: { name: "-", lifecycle: true },
  changePassword: { name: "ChangePassword" },
  unlockSigningKey: {
    name: "ChangeKeyPassphrase" /* ⚠ confirm: unlock vs change */,
    lifecycle: true,
  },

  listStudents: { name: "ListStudents" },
  getStudent: { name: "GetStudent" },
  admitStudent: { name: "AdmitStudent" },
  updateStudent: { name: "UpdateStudent" },
  changeStudentStatus: { name: "ChangeStudentStatus" },

  getStudentSemesterResults: { name: "GetStudentSemesterResults" },
  enterResult: { name: "EnterResult" },
  lockSemesterResults: { name: "LockSemesterResults" },
  unlockResult: { name: "UnlockResult" },
  processSemester: { name: "ProcessSemester" },

  importResults: { name: "ImportResults" },

  getAcademicSummary: { name: "GetAcademicSummary" },
  generateTranscript: { name: "GenerateTranscript" },
  verifyTranscript: { name: "VerifyTranscript" },
  approveTranscript: { name: "ApproveTranscript" },
  exportTranscript: { name: "ExportTranscript" },

  evaluateGraduation: { name: "EvaluateGraduation" },
  graduateStudent: { name: "GraduateStudent" },

  getAuditLog: { name: "GetAuditLog" },
  verifyAuditChain: { name: "VerifyAuditChain" },
};
