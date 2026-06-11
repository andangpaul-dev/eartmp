/**
 * Transcript template layout validation (Phase 15). Two layers (AD15.1/AD15.2):
 *   1. a lightweight structural grammar check (object → blocks[] → known types);
 *   2. a sample-bind DRY RUN through the real binder against a synthetic
 *      ReportData — so unresolved required binds and bad sessionLoop nesting are
 *      caught before a template is ever saved. Pure, no I/O.
 */
import { TranscriptError } from "../errors/transcript";
import { bindTemplate } from "./TranscriptBinder";
import type { ReportData } from "./TranscriptReportData";

const KNOWN_BLOCKS = new Set([
  "title",
  "text",
  "remarks",
  "qr",
  "fieldGrid",
  "summary",
  "signatureRow",
  "sessionLoop",
  "courseTable",
]);

/** A fully-populated synthetic ReportData mirroring the pinned shape (P15-b). */
export const SAMPLE_REPORT_DATA: ReportData = {
  institution: {
    name: "Sample University",
    motto: "Sample Motto",
    accreditationNo: "ACC-001",
    logoPath: "/logo.png",
    sealPath: "/seal.png",
    registrarSignPath: "/sign.png",
  },
  student: {
    matricNumber: "SAMPLE/0001",
    regNumber: "REG-0001",
    fullName: "Sample Student",
    programme: "Sample Programme",
    department: "Sample Department",
    faculty: "Sample Faculty",
    level: "100",
  },
  sessions: [
    {
      session: "2024/2025",
      semester: "First Semester",
      semesterGpa: 4,
      creditsAttempted: 3,
      creditsEarned: 3,
      courses: [
        {
          code: "CS101",
          title: "Intro",
          creditValue: 3,
          finalScore: 85,
          grade: "A",
          gradePoint: 4,
          creditsEarned: 3,
        },
      ],
    },
  ],
  summary: { cgpa: 4, totalCreditsEarned: 3, standing: "First Class" },
  remarks: "Sample remarks",
  signatures: [
    { role: "Registrar", name: "Sample Registrar", imagePath: "/sign.png" },
  ],
  verification: { transcriptNumber: "TR-SAMPLE", qrPayload: "TR-SAMPLE" },
  issuedAt: "2026-01-01T00:00:00.000Z",
};

/** Validate a template layout. Returns a list of errors (empty = valid). */
export function validateTemplateLayout(layout: unknown): string[] {
  const errors: string[] = [];

  if (typeof layout !== "object" || layout === null || Array.isArray(layout)) {
    return ["Layout must be an object."];
  }
  const blocks = (layout as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) {
    return ["Layout must have a 'blocks' array."];
  }
  blocks.forEach((b, i) => {
    if (typeof b !== "object" || b === null || Array.isArray(b)) {
      errors.push(`blocks[${i}] must be an object.`);
      return;
    }
    const type = (b as { type?: unknown }).type;
    if (typeof type !== "string" || !KNOWN_BLOCKS.has(type)) {
      errors.push(`blocks[${i}] has unknown type "${String(type)}".`);
    }
  });

  // Dry-run bind through the real binder to catch nesting + bind-path errors.
  try {
    bindTemplate(layout, SAMPLE_REPORT_DATA);
  } catch (e) {
    if (e instanceof TranscriptError) errors.push(e.message);
    else throw e;
  }

  return errors;
}
