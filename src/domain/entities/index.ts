/**
 * Domain entities — plain, framework-free types and invariants.
 * These never import Prisma, React, or any infrastructure. The persistence
 * layer maps to/from these.
 */

export type StudentStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "DEFERRED"
  | "WITHDRAWN"
  | "GRADUATED";

export type CourseType = "CORE" | "ELECTIVE" | "PRACTICAL" | "CLINICAL";

export interface Student {
  id: string;
  matricNumber: string;
  regNumber?: string;
  fullName: string;
  gender?: string;
  dateOfBirth?: Date;
  nationality?: string;
  address?: string;
  telephone?: string;
  email?: string;
  programmeId?: string;
  departmentId?: string;
  subDepartmentId?: string;
  facultyId?: string;
  levelId?: string;
  admissionSession?: string;
  status: StudentStatus;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  creditValue: number;
  courseType: CourseType;
  departmentId?: string;
  subDepartmentId?: string;
  programmeId?: string;
  levelId?: string;
  semesterRank?: number;
}

export interface ResultRecord {
  id: string;
  studentId: string;
  courseId: string;
  semesterId: string;
  componentScores: { key: string; score: number }[];
  finalScore?: number;
  grade?: string;
  gradePoint?: number;
  creditsEarned?: number;
  isLocked: boolean;
}

export type TranscriptStatus = "DRAFT" | "APPROVED" | "LOCKED" | "REVOKED";

export interface Transcript {
  id: string;
  transcriptNumber: string;
  studentId: string;
  templateId: string;
  type:
    | "RESULT_SLIP"
    | "ACADEMIC_TRANSCRIPT"
    | "STATEMENT"
    | "GRADUATION_REPORT";
  verificationHash: string;
  status: TranscriptStatus;
  remarks?: string;
  generatedAt: Date;
}

/** Invariant helpers kept with the entities. */
export const StudentRules = {
  canEditResults(status: StudentStatus): boolean {
    return status === "ACTIVE" || status === "DEFERRED";
  },
  isFinalized(status: StudentStatus): boolean {
    return status === "GRADUATED" || status === "WITHDRAWN";
  },
};

export const TranscriptRules = {
  isEditable(status: TranscriptStatus): boolean {
    return status === "DRAFT";
  },
  canExport(status: TranscriptStatus): boolean {
    return status === "APPROVED" || status === "LOCKED";
  },
  /** Seal an approved transcript (terminal except for revocation). */
  canLock(status: TranscriptStatus): boolean {
    return status === "APPROVED";
  },
  /** Revoke an issued transcript (corrected/superseded/fraudulent). */
  canRevoke(status: TranscriptStatus): boolean {
    return status === "APPROVED" || status === "LOCKED";
  },
};
