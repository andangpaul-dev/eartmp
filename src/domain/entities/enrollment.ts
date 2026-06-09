/**
 * StudentEnrollment — a student's programme/level over a span of time. The
 * current enrollment is the source of truth for a student's placement; the
 * Student row mirrors it (set in the same use-case). F-22.
 */
export interface StudentEnrollment {
  id: string;
  studentId: string;
  programmeId: string;
  levelId: string;
  fromSession: string;
  toSession?: string;
  isCurrent: boolean;
}
