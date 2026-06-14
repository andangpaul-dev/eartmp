/**
 * CoreApi contract — the typed seam between the webview and the Node host
 * (shell phase). PURE types only: no React, no infrastructure, no DB. The host
 * implements these; the webview's IPC client calls them. Inputs/outputs reuse
 * the core's domain types (plain interfaces), so the UI binds the real shapes.
 *
 * Boundary: this file lives in `presentation/` and may import domain TYPES only
 * (enforced by tests/architecture.test.ts — no infrastructure imports).
 */
import type {
  Page,
  StudentQuery,
  CourseQuery,
} from "../../domain/repositories/records";
import type {
  Student,
  StudentStatus,
  ResultRecord,
  Course,
} from "../../domain/entities";
import type {
  Faculty,
  Department,
  Programme,
  Level,
  AcademicSession,
  Semester,
} from "../../domain/entities/structure";
import type {
  AssessmentComponent,
  ComponentScore,
} from "../../domain/value-objects/AssessmentStructure";
import type { GpaSummary } from "../../domain/services/GpaEngine";
import type { ImportReport } from "../../application/use-cases/results/ImportResults";
import type { RawRow } from "../../application/ports/SpreadsheetReaderPort";
import type { AcademicSummary } from "../../application/use-cases/results/GetAcademicSummary";
import type { StoredTranscript } from "../../domain/repositories/transcripts";
import type { VerifyResult } from "../../application/use-cases/transcripts/VerifyTranscript";
import type { EligibilityReport } from "../../domain/services/GraduationEligibility";
import type { GraduateResult } from "../../application/use-cases/graduation/Graduation";
import type {
  AuditEntry,
  ChainVerification,
} from "../../domain/services/AuditChain";
import type { AuditQuery } from "../../domain/repositories/audit";
import type { Institution } from "../../domain/entities/institution";
import type {
  StoredGradeScale,
  StoredAssessmentConfig,
} from "../../domain/repositories/grading";
import type { GraduationRequirements } from "../../domain/services/GraduationEligibility";

// Re-exported so presentation code imports these shapes from the contract
// (the single seam) rather than reaching into application/domain paths.
export type {
  ImportReport,
  RawRow,
  AcademicSummary,
  StoredTranscript,
  VerifyResult,
  EligibilityReport,
  GraduateResult,
  AuditEntry,
  ChainVerification,
  AuditQuery,
  Institution,
  StoredGradeScale,
  StoredAssessmentConfig,
  GraduationRequirements,
};

/** Transcript bytes are transported base64-encoded (JSON can't carry Uint8Array). */
export interface ExportedDoc {
  base64: string;
  filename: string;
  contentType: string;
}
export interface KeyState {
  sealed: boolean;
}

// --- envelope + errors (mirrored from the host) ----------------------------

export type CoreErrorCode =
  | "VALIDATION"
  | "CONFLICT"
  | "LOCKED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INTERNAL";

export interface CoreError {
  code: CoreErrorCode;
  message: string;
  /** Field-level messages for form VALIDATION errors. */
  fields?: Record<string, string>;
}

export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: CoreError };

/** What the webview reads to gate the UI (it never asserts its own privileges). */
export interface SessionView {
  userId: string;
  role: string;
  permissions: string[];
}

// --- inputs (subset wired in Milestone 1; grows per milestone) --------------

export interface LoginInput {
  username: string;
  password: string;
}
export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}
export interface AdmitStudentInput {
  matricNumber: string;
  fullName: string;
  regNumber?: string;
  programmeId: string;
  levelId: string;
  fromSession: string;
}
export interface ChangeStudentStatusInput {
  studentId: string;
  to: StudentStatus;
}

/**
 * The methods the webview can call. Each maps to a core use-case `.name` on the
 * host (see INTEGRATION.md §2). Auth lifecycle (login/logout/currentUser) is
 * host-owned and returns a SessionView.
 */
export interface CoreApi {
  // auth / session
  login(input: LoginInput): Promise<{ token: string; session: SessionView }>;
  logout(): Promise<void>;
  currentUser(): Promise<SessionView | null>;
  changePassword(input: ChangePasswordInput): Promise<void>;

  // students
  listStudents(input: StudentQuery): Promise<Page<Student>>;
  getStudent(input: { id: string }): Promise<Student>;
  admitStudent(input: AdmitStudentInput): Promise<{ student: Student }>;
  updateStudent(input: {
    id: string;
    patch: Partial<Omit<Student, "id">>;
  }): Promise<Student>;
  changeStudentStatus(input: ChangeStudentStatusInput): Promise<Student>;

  // structure reads (admit-form cascade)
  listFaculties(input: Record<string, never>): Promise<Faculty[]>;
  listDepartments(input: { facultyId: string }): Promise<Department[]>;
  listProgrammes(input: { departmentId: string }): Promise<Programme[]>;
  listLevels(input: { programmeId: string }): Promise<Level[]>;
  listSessions(input: Record<string, never>): Promise<AcademicSession[]>;
  listSemesters(input: { sessionId: string }): Promise<Semester[]>;
  listCourses(input: CourseQuery): Promise<Page<Course>>;

  // results
  getAssessmentStructure(
    input: Record<string, never>,
  ): Promise<AssessmentComponent[]>;
  previewFinalScore(input: {
    componentScores: ComponentScore[];
  }): Promise<number>;
  enterResult(input: {
    studentId: string;
    courseId: string;
    semesterId: string;
    componentScores: ComponentScore[];
  }): Promise<ResultRecord>;
  getStudentSemesterResults(input: {
    studentId: string;
    semesterId: string;
  }): Promise<ResultRecord[]>;
  processSemester(input: {
    studentId: string;
    semesterId: string;
  }): Promise<GpaSummary>;
  lockSemesterResults(input: {
    studentId: string;
    semesterId: string;
  }): Promise<number>;
  unlockResult(input: { resultId: string }): Promise<void>;

  // import
  parseWorkbook(input: { base64: string }): Promise<RawRow[]>;
  importResults(input: {
    semesterId: string;
    rows: RawRow[];
    dryRun?: boolean;
  }): Promise<ImportReport>;

  // academic summary (CGPA is a display-only aggregate, 2 dp)
  getAcademicSummary(input: { studentId: string }): Promise<AcademicSummary>;

  // transcripts: generate (DRAFT) → verify (Ed25519) → approve → export.
  // Generate/verify need the signing key unsealed.
  listTranscripts(input: { studentId: string }): Promise<StoredTranscript[]>;
  generateTranscript(input: {
    studentId: string;
    type?: string;
    templateId?: string;
  }): Promise<StoredTranscript>;
  verifyTranscript(input: { transcriptId: string }): Promise<VerifyResult>;
  approveTranscript(input: { transcriptId: string }): Promise<StoredTranscript>;
  exportTranscript(input: {
    transcriptId: string;
    preview?: boolean;
  }): Promise<ExportedDoc>;

  // sealed signing-key lifecycle (lost passphrase is unrecoverable)
  keyState(input: Record<string, never>): Promise<KeyState>;
  unsealKey(input: { passphrase: string }): Promise<KeyState>;
  sealKey(input: Record<string, never>): Promise<KeyState>;

  // graduation: evaluate (transparent criteria) → clear (irreversible)
  evaluateGraduation(input: { studentId: string }): Promise<EligibilityReport>;
  graduateStudent(input: { studentId: string }): Promise<GraduateResult>;

  // audit: append-only trail + tamper-evident chain verification
  getAuditLog(input: AuditQuery): Promise<Page<AuditEntry>>;
  verifyAuditChain(input: Record<string, never>): Promise<ChainVerification>;

  // configuration: institution profile, grading config, settings
  getInstitution(input: Record<string, never>): Promise<Institution>;
  updateInstitution(input: {
    patch: Partial<Institution>;
  }): Promise<Institution>;
  getSetting(input: { key: string }): Promise<unknown>;
  setSetting(input: { key: string; value: unknown }): Promise<void>;
  listGradeScales(input: Record<string, never>): Promise<StoredGradeScale[]>;
  setDefaultGradeScale(input: { id: string }): Promise<void>;
  listAssessmentConfigs(
    input: Record<string, never>,
  ): Promise<StoredAssessmentConfig[]>;
  setDefaultAssessmentConfig(input: { id: string }): Promise<void>;

  // security: rotate the signing-key passphrase (re-seals the private key)
  changeKeyPassphrase(input: {
    oldPassphrase: string;
    newPassphrase: string;
  }): Promise<void>;
}

/** Generic transport shape the IPC client/host share. */
export interface RpcRequest {
  method: string;
  input: unknown;
  token?: string;
}
