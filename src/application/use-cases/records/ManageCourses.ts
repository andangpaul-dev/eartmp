/**
 * Course registry use-cases: create, update, list (paged), soft-delete.
 * Permission-gated and audited. Code unique among live rows; creditValue must be
 * a positive integer; courseType restricted to the enum.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import type { Course, CourseType } from "../../../domain/entities";
import type {
  CourseRepository,
  CourseQuery,
  Page,
} from "../../../domain/repositories/records";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import { DEFAULT_TAKE, MAX_TAKE } from "./ManageStudents";

const COURSE_TYPES: readonly CourseType[] = [
  "CORE",
  "ELECTIVE",
  "PRACTICAL",
  "CLINICAL",
];

export interface CreateCourseInput {
  code: string;
  title: string;
  creditValue: number;
  courseType: CourseType;
  departmentId?: string;
  programmeId?: string;
  levelId?: string;
  semesterRank?: number;
}

export class CreateCourse implements AuthorizedUseCase<
  CreateCourseInput,
  Course
> {
  readonly name = "CreateCourse";
  readonly requiredPermissions = ["courses.create"];
  constructor(
    private readonly courses: CourseRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateCourseInput, session: SessionContext) {
    if (input.code.trim().length === 0) {
      throw new RecordsError("Course code must not be empty.");
    }
    if (!Number.isInteger(input.creditValue) || input.creditValue <= 0) {
      throw new RecordsError("Credit value must be a positive integer.");
    }
    if (!COURSE_TYPES.includes(input.courseType)) {
      throw new RecordsError(`Invalid course type "${input.courseType}".`);
    }
    if (await this.courses.findByCode(input.code)) {
      throw new RecordsError(`Course code "${input.code}" is already in use.`);
    }
    const created = await this.courses.create(input);
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "Course",
      recordId: created.id,
      newValue: { code: created.code, creditValue: created.creditValue },
    });
    return created;
  }
}

export interface UpdateCourseInput {
  id: string;
  patch: Partial<Omit<Course, "id" | "code">>;
}
export class UpdateCourse implements AuthorizedUseCase<
  UpdateCourseInput,
  Course
> {
  readonly name = "UpdateCourse";
  readonly requiredPermissions = ["courses.update"];
  constructor(
    private readonly courses: CourseRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateCourseInput, session: SessionContext) {
    const before = await this.courses.findById(input.id);
    if (!before) throw new RecordsError("Course not found.");
    if (
      input.patch.creditValue !== undefined &&
      (!Number.isInteger(input.patch.creditValue) ||
        input.patch.creditValue <= 0)
    ) {
      throw new RecordsError("Credit value must be a positive integer.");
    }
    const updated = await this.courses.update(input.id, input.patch);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Course",
      recordId: input.id,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  }
}

export class ListCourses implements AuthorizedUseCase<
  CourseQuery,
  Page<Course>
> {
  readonly name = "ListCourses";
  readonly requiredPermissions = ["courses.read"];
  constructor(private readonly courses: CourseRepository) {}
  async execute(input: CourseQuery, _session: SessionContext) {
    const take =
      input.take === undefined || input.take <= 0
        ? DEFAULT_TAKE
        : Math.min(input.take, MAX_TAKE);
    return this.courses.find({ ...input, skip: input.skip ?? 0, take });
  }
}

export interface DeleteCourseInput {
  id: string;
}
export class DeleteCourse implements AuthorizedUseCase<
  DeleteCourseInput,
  void
> {
  readonly name = "DeleteCourse";
  readonly requiredPermissions = ["courses.update"];
  constructor(
    private readonly courses: CourseRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteCourseInput, session: SessionContext) {
    const course = await this.courses.findById(input.id);
    if (!course) throw new RecordsError("Course not found.");
    await this.courses.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "Course",
      recordId: input.id,
    });
  }
}
