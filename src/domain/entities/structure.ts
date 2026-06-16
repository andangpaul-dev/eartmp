/**
 * Academic-structure domain entities — framework-free types and invariants for
 * the faculty → department → programme → level hierarchy and the
 * session → semester calendar.
 */

export interface Faculty {
  id: string;
  name: string;
  code: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  facultyId: string;
}

/** Optional organizational unit under a Department. */
export interface SubDepartment {
  id: string;
  name: string;
  code: string;
  departmentId: string;
}

export interface Programme {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  /** Optional sub-department the programme belongs to (within its department). */
  subDepartmentId?: string;
  durationLevels: number;
  creditsRequired: number;
}

export interface Level {
  id: string;
  name: string;
  rank: number;
  programmeId: string;
  /** Optional per-level grade scale (loose ref); null ⇒ institution default. */
  gradeScaleId?: string;
}

export interface AcademicSession {
  id: string;
  name: string;
  startDate?: Date;
  endDate?: Date;
  isCurrent: boolean;
}

export interface Semester {
  id: string;
  name: string;
  rank: number;
  sessionId: string;
}

/** Shared structure invariants. */
export const StructureRules = {
  requireNonEmpty(value: string, field: string): void {
    if (value.trim().length === 0) {
      throw new Error(`${field} must not be empty.`);
    }
  },
  requirePositiveRank(rank: number, field = "rank"): void {
    if (!Number.isInteger(rank) || rank <= 0) {
      throw new Error(`${field} must be a positive integer.`);
    }
  },
};
