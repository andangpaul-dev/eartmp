/**
 * BuildReportData — assemble the ReportData a transcript binds to (Phase 12).
 * Gathers institution branding, student details, per-semester course tables, and
 * the academic summary (reusing the Phase 11 aggregation). Structure-name
 * lookups are collapsed behind `TranscriptNameResolver` to keep the dependency
 * surface small. A plain service (the gated entry point is GenerateTranscript).
 *
 * Phase B (Workstream B): all attempts are included (NORMAL + RESIT / cross-session
 * retakes). Only the globally-effective attempt contributes to GPA/CGPA via
 * `selectEffective`. Re-attempts carry `afterReattempt: true` so the renderer can
 * print "*". Special-status rows carry `marker: "DQ" | "I"`. A `legendNotes`
 * array is appended to ReportData only when the transcript contains such rows.
 * Sessions are ordered chronologically (sessionOrder → rank) via SemesterOrdering.
 */
import { TranscriptError } from "../../../domain/errors/transcript";
import {
  summarizeSemester,
  summarizeCumulative,
  type CourseGradePoint,
} from "../../../domain/services/AcademicSummary";
import { GpaEngine } from "../../../domain/services/GpaEngine";
import { selectEffective } from "../../../domain/services/ResultAttempts";
import type {
  ReportData,
  ReportSession,
  ReportCourse,
} from "../../../domain/services/TranscriptReportData";
import type { Course } from "../../../domain/entities";
import type {
  StudentRepository,
  ResultRepository,
  CourseRepository,
  SemesterOrdering,
} from "../../../domain/repositories/records";
import type { InstitutionRepository } from "../../../domain/repositories/config";
import type { GradingConfigService } from "../../services/GradingConfigService";

/** Resolves human names for structure ids (collapses the structure repos). */
export interface TranscriptNameResolver {
  programmeName(id?: string): Promise<string | undefined>;
  departmentName(id?: string): Promise<string | undefined>;
  facultyName(id?: string): Promise<string | undefined>;
  semesterName(semesterId: string): Promise<string | undefined>;
  sessionNameForSemester(semesterId: string): Promise<string | undefined>;
}

/** The data-assembly seam GenerateTranscript depends on. */
export interface ReportDataAssembler {
  assemble(
    studentId: string,
    transcriptNumber: string,
    issuedAt: string,
  ): Promise<ReportData>;
}

export class BuildReportData implements ReportDataAssembler {
  constructor(
    private readonly students: StudentRepository,
    private readonly institutions: InstitutionRepository,
    private readonly results: ResultRepository,
    private readonly courses: CourseRepository,
    private readonly names: TranscriptNameResolver,
    private readonly grading: GradingConfigService,
    private readonly semesterOrdering: SemesterOrdering,
  ) {}

  async assemble(
    studentId: string,
    transcriptNumber: string,
    issuedAt: string,
  ): Promise<ReportData> {
    const student = await this.students.findById(studentId);
    if (!student) throw new TranscriptError("Student not found.");
    // Resolve the student's institution (Phase B); fall back to the default.
    const institution =
      (student.institutionId
        ? await this.institutions.findById(student.institutionId)
        : null) ?? (await this.institutions.get());
    if (!institution)
      throw new TranscriptError("Institution is not provisioned.");

    // Fetch ALL results (every sitting, every session).
    const all = await this.results.findByStudent(studentId);

    // Resolve chronological ordering for every unique semester.
    const ord = await this.semesterOrdering.order([
      ...new Set(all.map((r) => r.semesterId)),
    ]);

    // Build the global effective selection from all attempts.
    const sel = selectEffective(
      all.map((r) => ({
        id: r.id,
        courseId: r.courseId,
        sessionOrder: ord.get(r.semesterId)?.sessionOrder ?? 0,
        semesterRank: ord.get(r.semesterId)?.rank ?? 0,
        sitting: r.sitting,
        status: r.status,
      })),
    );

    // Track which legend markers are needed.
    const markersSeen = new Set<string>();

    // Group all rows by semester, building course rows + effective-only GPA items.
    const courseCache = new Map<string, Course>();
    const grouped = new Map<
      string,
      { courses: ReportCourse[]; items: CourseGradePoint[] }
    >();

    for (const r of all) {
      let course = courseCache.get(r.courseId);
      if (!course) {
        const c = await this.courses.findById(r.courseId);
        if (!c) throw new TranscriptError(`Course ${r.courseId} not found.`);
        course = c;
        courseCache.set(r.courseId, c);
      }

      const marker: "DQ" | "I" | undefined =
        r.status === "DISQUALIFIED"
          ? "DQ"
          : r.status === "INCOMPLETE"
            ? "I"
            : undefined;
      const afterReattempt = sel.isReattempt(r.id);

      if (afterReattempt) markersSeen.add("*");
      if (marker) markersSeen.add(marker);

      const reportCourse: ReportCourse = {
        code: course.code,
        title: course.title,
        creditValue: course.creditValue,
        ...(r.finalScore !== undefined ? { finalScore: r.finalScore } : {}),
        ...(r.grade !== undefined ? { grade: r.grade } : {}),
        ...(r.gradePoint !== undefined ? { gradePoint: r.gradePoint } : {}),
        ...(r.creditsEarned !== undefined
          ? { creditsEarned: r.creditsEarned }
          : {}),
        ...(afterReattempt ? { afterReattempt: true } : {}),
        ...(marker ? { marker } : {}),
      };

      const g = grouped.get(r.semesterId) ?? { courses: [], items: [] };
      g.courses.push(reportCourse);

      // GPA items: only effective rows that have a gradePoint contribute.
      if (sel.effectiveIds.has(r.id) && r.gradePoint !== undefined) {
        g.items.push({
          creditValue: course.creditValue,
          gradePoint: r.gradePoint,
          creditsEarned: r.creditsEarned ?? 0,
        });
      }

      grouped.set(r.semesterId, g);
    }

    // Order semester IDs chronologically using the ordering map.
    const semesterIds = [...grouped.keys()].sort((a, b) => {
      const aOrd = ord.get(a) ?? { sessionOrder: 0, rank: 0 };
      const bOrd = ord.get(b) ?? { sessionOrder: 0, rank: 0 };
      return aOrd.sessionOrder - bOrd.sessionOrder || aOrd.rank - bOrd.rank;
    });

    const sessions: ReportSession[] = [];
    const semesterSummaries = [];
    for (const semesterId of semesterIds) {
      const g = grouped.get(semesterId)!;
      const summary = summarizeSemester(semesterId, g.items);
      semesterSummaries.push(summary);
      sessions.push({
        session: (await this.names.sessionNameForSemester(semesterId)) ?? "",
        semester: (await this.names.semesterName(semesterId)) ?? semesterId,
        semesterGpa: summary.gpa,
        creditsAttempted: summary.creditsAttempted,
        creditsEarned: summary.creditsEarned,
        courses: g.courses,
      });
    }

    const cumulative = summarizeCumulative(semesterSummaries);
    const standing = GpaEngine.resolveStanding(
      cumulative.cgpa,
      await this.grading.loadStandingBands(),
    );

    // Build legend only when markers were seen.
    const legendNotes: string[] = [];
    if (markersSeen.has("*"))
      legendNotes.push("Mark obtained after Resit/Retake");
    if (markersSeen.has("DQ")) legendNotes.push("Disqualified (malpractice)");
    if (markersSeen.has("I")) legendNotes.push("Incomplete");

    const programme = await this.names.programmeName(student.programmeId);
    const department = await this.names.departmentName(student.departmentId);
    const faculty = await this.names.facultyName(student.facultyId);

    return {
      institution: {
        name: institution.name,
        ...(institution.motto ? { motto: institution.motto } : {}),
        ...(institution.accreditationNo
          ? { accreditationNo: institution.accreditationNo }
          : {}),
        ...(institution.logoPath ? { logoPath: institution.logoPath } : {}),
        ...(institution.sealPath ? { sealPath: institution.sealPath } : {}),
        ...(institution.registrarSignPath
          ? { registrarSignPath: institution.registrarSignPath }
          : {}),
      },
      student: {
        matricNumber: student.matricNumber,
        ...(student.regNumber ? { regNumber: student.regNumber } : {}),
        fullName: student.fullName,
        ...(programme ? { programme } : {}),
        ...(department ? { department } : {}),
        ...(faculty ? { faculty } : {}),
      },
      sessions,
      summary: {
        cgpa: cumulative.cgpa,
        totalCreditsEarned: cumulative.creditsEarned,
        standing,
      },
      ...(legendNotes.length ? { legendNotes } : {}),
      signatures: [{ role: "Registrar" }],
      verification: { transcriptNumber, qrPayload: transcriptNumber },
      issuedAt,
    };
  }
}
