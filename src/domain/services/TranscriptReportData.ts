/**
 * ReportData — the pinned, framework-free data contract a transcript template
 * binds to (Phase 12). Everything dynamic on a transcript flows from here; the
 * binder resolves template `bind` paths against this shape. `[ASSUMPTION]` the
 * exact field set tracks the real Transcript Template V1 sample when supplied.
 */

export interface ReportCourse {
  code: string;
  title: string;
  creditValue: number;
  finalScore?: number;
  grade?: string;
  gradePoint?: number;
  creditsEarned?: number;
  /** True when this row is a reattempt (resit or cross-session retake). The renderer may print "*". */
  afterReattempt?: boolean;
  /** Status marker for special conditions rendered in the legend. */
  marker?: "DQ" | "I";
}

export interface ReportSession {
  session: string;
  semester: string;
  semesterGpa: number;
  creditsAttempted: number;
  creditsEarned: number;
  courses: ReportCourse[];
}

export interface ReportData {
  institution: {
    name: string;
    motto?: string;
    accreditationNo?: string;
    logoPath?: string;
    sealPath?: string;
    registrarSignPath?: string;
  };
  student: {
    matricNumber: string;
    regNumber?: string;
    fullName: string;
    programme?: string;
    department?: string;
    faculty?: string;
    level?: string;
  };
  sessions: ReportSession[];
  summary: {
    cgpa: number;
    totalCreditsEarned: number;
    standing: string;
  };
  remarks?: string;
  /** Present only when the transcript contains reattempts or special-status rows. */
  legendNotes?: string[];
  signatures: { role: string; name?: string; imagePath?: string }[];
  verification: { transcriptNumber: string; qrPayload: string };
  issuedAt: string;
}

/** A resolved, format-agnostic document — what PDF/DOCX renderers (P13/14) consume. */
export type ResolvedBlock =
  | { type: "title"; text: string }
  | { type: "text"; text: string }
  | {
      type: "fieldGrid";
      columns: number;
      fields: { label: string; value: string }[];
    }
  | {
      type: "courseTable";
      heading: string;
      columns: { header: string }[];
      rows: string[][];
      footer: { label: string; value: string }[];
    }
  | { type: "summary"; fields: { label: string; value: string }[] }
  | { type: "remarks"; text: string }
  | {
      type: "signatureRow";
      items: { role: string; name: string; image?: string }[];
    }
  | { type: "qr"; payload: string; caption?: string };

export interface ResolvedDoc {
  pageSize: string;
  blocks: ResolvedBlock[];
  /** Institution branding image paths (resolved to data URLs by the renderer). */
  logoPath?: string;
  sealPath?: string;
}
