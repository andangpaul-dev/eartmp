/**
 * ListCourseRoster — enrollment-history course roster (Task 4.3, Workstream B).
 *
 * Given a course + session name, lists the students enrolled in that course's
 * programme/level AS OF that session. Uses historical enrollment spans so that
 * past-session rosters are accurate even after a student transfers programme or
 * level. Faculty-scoped via scopeStudentWhere (Workstream A).
 */
import type { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { Student } from "../../../domain/entities";
import type {
  StudentRepository,
  CourseRepository,
  StudentEnrollmentRepository,
} from "../../../domain/repositories/records";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import type { StudentFilter } from "../../../domain/repositories/records";
import { scopeStudentWhere } from "../../authorization/institutionScope";
import { RecordsError } from "../../../domain/errors/records";

export interface ListCourseRosterInput {
  courseId: string;
  sessionName: string;
}

export class ListCourseRoster implements AuthorizedUseCase<
  ListCourseRosterInput,
  Student[]
> {
  readonly name = "ListCourseRoster";
  readonly requiredPermissions = ["results.read"];

  constructor(
    private readonly students: StudentRepository,
    private readonly enrollments: StudentEnrollmentRepository,
    private readonly courses: CourseRepository,
  ) {}

  async execute(
    input: ListCourseRosterInput,
    session: SessionContext,
  ): Promise<Student[]> {
    const course = await this.courses.findById(input.courseId);
    if (!course) throw new RecordsError("Course not found.");

    const baseFilter: StudentFilter = {
      programmeId: course.programmeId,
      levelId: course.levelId,
      status: "ACTIVE",
    };
    const where = scopeStudentWhere(baseFilter, session);

    const page = await this.students.find({ where });

    const out: Student[] = [];
    for (const s of page.items) {
      const spans = await this.enrollments.listByStudent(s.id);

      // Legacy fallback: student has no enrollment history rows; they already
      // matched the programme/level filter on the Student row itself.
      if (spans.length === 0) {
        out.push(s);
        continue;
      }

      // Find a span that covers the requested session for this course's placement.
      // Session strings are "YYYY/YYYY" and compare lexicographically in
      // chronological order (e.g. "2024/2025" < "2025/2026").
      const covering = spans.find(
        (e) =>
          e.programmeId === course.programmeId &&
          e.levelId === course.levelId &&
          (e.isCurrent ||
            (e.fromSession <= input.sessionName &&
              (!e.toSession || input.sessionName <= e.toSession))),
      );

      if (covering) out.push(s);
    }

    return out;
  }
}
