/**
 * Student record use-cases: create, update, get, list (paged), change status,
 * soft-delete. Permission-gated through the fail-closed seam and audited.
 * Status changes are validated against the transition matrix (AD6.1); matric
 * numbers are unique among live rows (AD6.4).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { RecordsError } from "../../../domain/errors/records";
import { StudentRules } from "../../../domain/entities";
import type { Student, StudentStatus } from "../../../domain/entities";
import { canTransition } from "../../../domain/entities/student-status";
import type {
  StudentRepository,
  StudentQuery,
  Page,
  VersionedStudentWrites,
} from "../../../domain/repositories/records";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

/**
 * Apply a patch with optimistic locking when a versioned writer is available
 * (the production Prisma repo): reads the version, then UPDATE … WHERE version =
 * expected — a concurrent edit since the load throws ConcurrencyError. Falls
 * back to a plain update for repos that don't support versioning (fakes).
 */
async function versionedPatch(
  students: StudentRepository,
  versioned: VersionedStudentWrites | undefined,
  id: string,
  patch: Partial<Omit<Student, "id">>,
  loadedVersion?: number,
): Promise<Student> {
  if (versioned) {
    const v = loadedVersion ?? (await versioned.readVersion(id));
    if (v === null) throw new RecordsError("Student not found.");
    await versioned.tryUpdate(id, patch, v);
    const updated = await students.findById(id);
    if (!updated) throw new RecordsError("Student not found.");
    return updated;
  }
  return students.update(id, patch);
}

export const DEFAULT_TAKE = 50;
export const MAX_TAKE = 200;

function clampTake(take?: number): number {
  if (take === undefined || take <= 0) return DEFAULT_TAKE;
  return Math.min(take, MAX_TAKE);
}

export interface CreateStudentInput {
  matricNumber: string;
  fullName: string;
  regNumber?: string;
  gender?: string;
  dateOfBirth?: Date;
  nationality?: string;
  facultyId?: string;
  departmentId?: string;
  programmeId?: string;
  levelId?: string;
  admissionSession?: string;
}

export class CreateStudent implements AuthorizedUseCase<
  CreateStudentInput,
  Student
> {
  readonly name = "CreateStudent";
  readonly requiredPermissions = ["students.create"];
  constructor(
    private readonly students: StudentRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateStudentInput, session: SessionContext) {
    if (input.matricNumber.trim().length === 0) {
      throw new RecordsError("Matric number must not be empty.");
    }
    if (input.fullName.trim().length === 0) {
      throw new RecordsError("Full name must not be empty.");
    }
    if (await this.students.findByMatric(input.matricNumber)) {
      throw new RecordsError(
        `Matric number "${input.matricNumber}" is already in use.`,
      );
    }
    const created = await this.students.create({ ...input, status: "ACTIVE" });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "Student",
      recordId: created.id,
      newValue: { matricNumber: created.matricNumber },
    });
    return created;
  }
}

export interface UpdateStudentInput {
  id: string;
  patch: Partial<Omit<Student, "id" | "matricNumber" | "status">>;
}
export class UpdateStudent implements AuthorizedUseCase<
  UpdateStudentInput,
  Student
> {
  readonly name = "UpdateStudent";
  readonly requiredPermissions = ["students.update"];
  constructor(
    private readonly students: StudentRepository,
    private readonly audit: AuditLogPort,
    private readonly versioned?: VersionedStudentWrites,
  ) {}
  async execute(input: UpdateStudentInput, session: SessionContext) {
    const before = await this.students.findById(input.id);
    if (!before) throw new RecordsError("Student not found.");
    const version = this.versioned
      ? await this.versioned.readVersion(input.id)
      : undefined;
    const updated = await versionedPatch(
      this.students,
      this.versioned,
      input.id,
      input.patch,
      version ?? undefined,
    );
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Student",
      recordId: input.id,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  }
}

export interface GetStudentInput {
  id: string;
}
export class GetStudent implements AuthorizedUseCase<GetStudentInput, Student> {
  readonly name = "GetStudent";
  readonly requiredPermissions = ["students.read"];
  constructor(private readonly students: StudentRepository) {}
  async execute(input: GetStudentInput, _session: SessionContext) {
    const student = await this.students.findById(input.id);
    if (!student) throw new RecordsError("Student not found.");
    return student;
  }
}

export class ListStudents implements AuthorizedUseCase<
  StudentQuery,
  Page<Student>
> {
  readonly name = "ListStudents";
  readonly requiredPermissions = ["students.read"];
  constructor(private readonly students: StudentRepository) {}
  async execute(input: StudentQuery, _session: SessionContext) {
    return this.students.find({
      ...input,
      skip: input.skip ?? 0,
      take: clampTake(input.take),
    });
  }
}

export interface ChangeStudentStatusInput {
  studentId: string;
  to: StudentStatus;
}
export class ChangeStudentStatus implements AuthorizedUseCase<
  ChangeStudentStatusInput,
  Student
> {
  readonly name = "ChangeStudentStatus";
  readonly requiredPermissions = ["students.update"];
  constructor(
    private readonly students: StudentRepository,
    private readonly audit: AuditLogPort,
    private readonly versioned?: VersionedStudentWrites,
  ) {}
  async execute(input: ChangeStudentStatusInput, session: SessionContext) {
    const student = await this.students.findById(input.studentId);
    if (!student) throw new RecordsError("Student not found.");
    // Capture the version at load time so a concurrent status change since this
    // read makes the write fail (ConcurrencyError) — two racing transitions on a
    // stale status can't both win.
    const version = this.versioned
      ? await this.versioned.readVersion(input.studentId)
      : undefined;
    if (StudentRules.isFinalized(student.status)) {
      throw new RecordsError(
        `Student status "${student.status}" is final and cannot change.`,
      );
    }
    // GRADUATED is reachable only through the eligibility-checked, audited
    // graduation clearance flow — never a direct status edit.
    if (input.to === "GRADUATED") {
      throw new RecordsError(
        "Use the graduation clearance flow to graduate a student.",
      );
    }
    if (!canTransition(student.status, input.to)) {
      throw new RecordsError(
        `Illegal status transition ${student.status} → ${input.to}.`,
      );
    }
    const updated = await versionedPatch(
      this.students,
      this.versioned,
      input.studentId,
      { status: input.to },
      version ?? undefined,
    );
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "Student",
      recordId: input.studentId,
      oldValue: { status: student.status },
      newValue: { status: input.to },
    });
    return updated;
  }
}

export interface DeleteStudentInput {
  id: string;
}
export class DeleteStudent implements AuthorizedUseCase<
  DeleteStudentInput,
  void
> {
  readonly name = "DeleteStudent";
  readonly requiredPermissions = ["students.update"];
  constructor(
    private readonly students: StudentRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteStudentInput, session: SessionContext) {
    const student = await this.students.findById(input.id);
    if (!student) throw new RecordsError("Student not found.");
    await this.students.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "Student",
      recordId: input.id,
    });
  }
}
