/**
 * Academic-structure hierarchy use-cases (faculty → department → programme →
 * level). Every write is permission-gated (`structure.manage`) through the
 * fail-closed seam and audited; reads require `structure.read`. Referential
 * invariants (parent exists & live) and soft-delete guards (no live children)
 * are enforced here, not just by FKs (AD5.4 / AD5.6).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { StructureError } from "../../../domain/errors/structure";
import { StructureRules } from "../../../domain/entities/structure";
import type {
  Faculty,
  Department,
  Programme,
  Level,
} from "../../../domain/entities/structure";
import type {
  FacultyRepository,
  DepartmentRepository,
  ProgrammeRepository,
  LevelRepository,
} from "../../../domain/repositories/structure";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

const MANAGE = ["structure.manage"];
const READ = ["structure.read"];

async function audit(
  log: AuditLogPort,
  session: SessionContext,
  action: string,
  entity: string,
  recordId: string,
  value?: unknown,
): Promise<void> {
  await log.record({
    userId: session.actorId,
    action,
    entity,
    recordId,
    newValue: value,
  });
}

// --- Faculty ---------------------------------------------------------------

export interface CreateFacultyInput {
  name: string;
  code: string;
}
export class CreateFaculty implements AuthorizedUseCase<
  CreateFacultyInput,
  Faculty
> {
  readonly name = "CreateFaculty";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly faculties: FacultyRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: CreateFacultyInput, session: SessionContext) {
    StructureRules.requireNonEmpty(input.name, "Faculty name");
    StructureRules.requireNonEmpty(input.code, "Faculty code");
    if (await this.faculties.findByCode(input.code)) {
      throw new StructureError(`Faculty code "${input.code}" already in use.`);
    }
    const created = await this.faculties.create({
      name: input.name,
      code: input.code,
    });
    await audit(this.auditLog, session, "CREATE", "Faculty", created.id, {
      code: created.code,
    });
    return created;
  }
}

export interface DeleteFacultyInput {
  id: string;
}
export class DeleteFaculty implements AuthorizedUseCase<
  DeleteFacultyInput,
  void
> {
  readonly name = "DeleteFaculty";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly faculties: FacultyRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: DeleteFacultyInput, session: SessionContext) {
    const faculty = await this.faculties.findById(input.id);
    if (!faculty) throw new StructureError("Faculty not found.");
    if (await this.faculties.hasLiveDepartments(input.id)) {
      throw new StructureError(
        "Cannot delete a faculty that still has departments.",
      );
    }
    await this.faculties.softDelete(input.id);
    await audit(this.auditLog, session, "DELETE", "Faculty", input.id);
  }
}

export class ListFaculties implements AuthorizedUseCase<
  Record<string, never>,
  Faculty[]
> {
  readonly name = "ListFaculties";
  readonly requiredPermissions = READ;
  constructor(private readonly faculties: FacultyRepository) {}
  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<Faculty[]> {
    return this.faculties.list();
  }
}

// --- Department ------------------------------------------------------------

export interface CreateDepartmentInput {
  name: string;
  code: string;
  facultyId: string;
}
export class CreateDepartment implements AuthorizedUseCase<
  CreateDepartmentInput,
  Department
> {
  readonly name = "CreateDepartment";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly departments: DepartmentRepository,
    private readonly faculties: FacultyRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: CreateDepartmentInput, session: SessionContext) {
    StructureRules.requireNonEmpty(input.name, "Department name");
    StructureRules.requireNonEmpty(input.code, "Department code");
    if (!(await this.faculties.findById(input.facultyId))) {
      throw new StructureError("Parent faculty does not exist or is deleted.");
    }
    if (await this.departments.findByCode(input.code)) {
      throw new StructureError(
        `Department code "${input.code}" already in use.`,
      );
    }
    const created = await this.departments.create({
      name: input.name,
      code: input.code,
      facultyId: input.facultyId,
    });
    await audit(this.auditLog, session, "CREATE", "Department", created.id, {
      code: created.code,
      facultyId: created.facultyId,
    });
    return created;
  }
}

export interface DeleteDepartmentInput {
  id: string;
}
export class DeleteDepartment implements AuthorizedUseCase<
  DeleteDepartmentInput,
  void
> {
  readonly name = "DeleteDepartment";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly departments: DepartmentRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: DeleteDepartmentInput, session: SessionContext) {
    const dept = await this.departments.findById(input.id);
    if (!dept) throw new StructureError("Department not found.");
    if (await this.departments.hasLiveProgrammes(input.id)) {
      throw new StructureError(
        "Cannot delete a department that still has programmes.",
      );
    }
    if (await this.departments.hasLiveSubDepartments(input.id)) {
      throw new StructureError(
        "Cannot delete a department that still has sub-departments.",
      );
    }
    await this.departments.softDelete(input.id);
    await audit(this.auditLog, session, "DELETE", "Department", input.id);
  }
}

export interface ListDepartmentsInput {
  facultyId: string;
}
export class ListDepartments implements AuthorizedUseCase<
  ListDepartmentsInput,
  Department[]
> {
  readonly name = "ListDepartments";
  readonly requiredPermissions = READ;
  constructor(private readonly departments: DepartmentRepository) {}
  async execute(input: ListDepartmentsInput) {
    return this.departments.listByFaculty(input.facultyId);
  }
}

// --- Programme -------------------------------------------------------------

export interface CreateProgrammeInput {
  name: string;
  code: string;
  departmentId: string;
  subDepartmentId?: string;
  durationLevels?: number;
  creditsRequired?: number;
}
export class CreateProgramme implements AuthorizedUseCase<
  CreateProgrammeInput,
  Programme
> {
  readonly name = "CreateProgramme";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly programmes: ProgrammeRepository,
    private readonly departments: DepartmentRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: CreateProgrammeInput, session: SessionContext) {
    StructureRules.requireNonEmpty(input.name, "Programme name");
    StructureRules.requireNonEmpty(input.code, "Programme code");
    if (!(await this.departments.findById(input.departmentId))) {
      throw new StructureError(
        "Parent department does not exist or is deleted.",
      );
    }
    if (await this.programmes.findByCode(input.code)) {
      throw new StructureError(
        `Programme code "${input.code}" already in use.`,
      );
    }
    const created = await this.programmes.create({
      name: input.name,
      code: input.code,
      departmentId: input.departmentId,
      ...(input.subDepartmentId
        ? { subDepartmentId: input.subDepartmentId }
        : {}),
      durationLevels: input.durationLevels ?? 4,
      creditsRequired: input.creditsRequired ?? 0,
    });
    await audit(this.auditLog, session, "CREATE", "Programme", created.id, {
      code: created.code,
    });
    return created;
  }
}

export interface DeleteProgrammeInput {
  id: string;
}
export class DeleteProgramme implements AuthorizedUseCase<
  DeleteProgrammeInput,
  void
> {
  readonly name = "DeleteProgramme";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly programmes: ProgrammeRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: DeleteProgrammeInput, session: SessionContext) {
    const prog = await this.programmes.findById(input.id);
    if (!prog) throw new StructureError("Programme not found.");
    if (await this.programmes.hasLiveLevels(input.id)) {
      throw new StructureError(
        "Cannot delete a programme that still has levels.",
      );
    }
    await this.programmes.softDelete(input.id);
    await audit(this.auditLog, session, "DELETE", "Programme", input.id);
  }
}

export interface ListProgrammesInput {
  departmentId: string;
}
export class ListProgrammes implements AuthorizedUseCase<
  ListProgrammesInput,
  Programme[]
> {
  readonly name = "ListProgrammes";
  readonly requiredPermissions = READ;
  constructor(private readonly programmes: ProgrammeRepository) {}
  async execute(input: ListProgrammesInput) {
    return this.programmes.listByDepartment(input.departmentId);
  }
}

// --- Level -----------------------------------------------------------------

export interface CreateLevelInput {
  name: string;
  rank: number;
  programmeId: string;
}
export class CreateLevel implements AuthorizedUseCase<CreateLevelInput, Level> {
  readonly name = "CreateLevel";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly levels: LevelRepository,
    private readonly programmes: ProgrammeRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: CreateLevelInput, session: SessionContext) {
    StructureRules.requireNonEmpty(input.name, "Level name");
    StructureRules.requirePositiveRank(input.rank);
    if (!(await this.programmes.findById(input.programmeId))) {
      throw new StructureError(
        "Parent programme does not exist or is deleted.",
      );
    }
    if (await this.levels.existsRank(input.programmeId, input.rank)) {
      throw new StructureError(
        `A level with rank ${input.rank} already exists in this programme.`,
      );
    }
    const created = await this.levels.create({
      name: input.name,
      rank: input.rank,
      programmeId: input.programmeId,
    });
    await audit(this.auditLog, session, "CREATE", "Level", created.id, {
      rank: created.rank,
    });
    return created;
  }
}

export interface ListLevelsInput {
  programmeId: string;
}
export class ListLevels implements AuthorizedUseCase<ListLevelsInput, Level[]> {
  readonly name = "ListLevels";
  readonly requiredPermissions = READ;
  constructor(private readonly levels: LevelRepository) {}
  async execute(input: ListLevelsInput) {
    return this.levels.listByProgramme(input.programmeId);
  }
}

// --- Rename / edit (management completeness) --------------------------------

async function findByCodeClash(
  repo: { findByCode(code: string): Promise<{ id: string } | null> },
  code: string,
  selfId: string,
): Promise<boolean> {
  const clash = await repo.findByCode(code);
  return clash !== null && clash.id !== selfId;
}

export interface UpdateFacultyInput {
  id: string;
  patch: { name?: string; code?: string };
}
export class UpdateFaculty implements AuthorizedUseCase<
  UpdateFacultyInput,
  Faculty
> {
  readonly name = "UpdateFaculty";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly faculties: FacultyRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: UpdateFacultyInput, session: SessionContext) {
    const before = await this.faculties.findById(input.id);
    if (!before) throw new StructureError("Faculty not found.");
    if (input.patch.name !== undefined)
      StructureRules.requireNonEmpty(input.patch.name, "Faculty name");
    if (input.patch.code !== undefined) {
      StructureRules.requireNonEmpty(input.patch.code, "Faculty code");
      if (await findByCodeClash(this.faculties, input.patch.code, input.id))
        throw new StructureError(
          `Faculty code "${input.patch.code}" already in use.`,
        );
    }
    const updated = await this.faculties.update(input.id, input.patch);
    await audit(this.auditLog, session, "UPDATE", "Faculty", input.id, updated);
    return updated;
  }
}

export interface UpdateDepartmentInput {
  id: string;
  patch: { name?: string; code?: string };
}
export class UpdateDepartment implements AuthorizedUseCase<
  UpdateDepartmentInput,
  Department
> {
  readonly name = "UpdateDepartment";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly departments: DepartmentRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: UpdateDepartmentInput, session: SessionContext) {
    const before = await this.departments.findById(input.id);
    if (!before) throw new StructureError("Department not found.");
    if (input.patch.name !== undefined)
      StructureRules.requireNonEmpty(input.patch.name, "Department name");
    if (input.patch.code !== undefined) {
      StructureRules.requireNonEmpty(input.patch.code, "Department code");
      if (await findByCodeClash(this.departments, input.patch.code, input.id))
        throw new StructureError(
          `Department code "${input.patch.code}" already in use.`,
        );
    }
    const updated = await this.departments.update(input.id, input.patch);
    await audit(
      this.auditLog,
      session,
      "UPDATE",
      "Department",
      input.id,
      updated,
    );
    return updated;
  }
}

export interface UpdateProgrammeInput {
  id: string;
  patch: {
    name?: string;
    code?: string;
    subDepartmentId?: string | null;
    durationLevels?: number;
    creditsRequired?: number;
  };
}
export class UpdateProgramme implements AuthorizedUseCase<
  UpdateProgrammeInput,
  Programme
> {
  readonly name = "UpdateProgramme";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly programmes: ProgrammeRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: UpdateProgrammeInput, session: SessionContext) {
    const before = await this.programmes.findById(input.id);
    if (!before) throw new StructureError("Programme not found.");
    if (input.patch.name !== undefined)
      StructureRules.requireNonEmpty(input.patch.name, "Programme name");
    if (input.patch.code !== undefined) {
      StructureRules.requireNonEmpty(input.patch.code, "Programme code");
      if (await findByCodeClash(this.programmes, input.patch.code, input.id))
        throw new StructureError(
          `Programme code "${input.patch.code}" already in use.`,
        );
    }
    // null clears the sub-department; undefined leaves it unchanged.
    const patch: Partial<Omit<Programme, "id">> = {
      ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
      ...(input.patch.code !== undefined ? { code: input.patch.code } : {}),
      ...(input.patch.durationLevels !== undefined
        ? { durationLevels: input.patch.durationLevels }
        : {}),
      ...(input.patch.creditsRequired !== undefined
        ? { creditsRequired: input.patch.creditsRequired }
        : {}),
      ...(input.patch.subDepartmentId !== undefined
        ? { subDepartmentId: input.patch.subDepartmentId ?? undefined }
        : {}),
    };
    const updated = await this.programmes.update(input.id, patch);
    await audit(
      this.auditLog,
      session,
      "UPDATE",
      "Programme",
      input.id,
      updated,
    );
    return updated;
  }
}

export interface UpdateLevelInput {
  id: string;
  patch: { name?: string; rank?: number; gradeScaleId?: string | null };
}
export class UpdateLevel implements AuthorizedUseCase<UpdateLevelInput, Level> {
  readonly name = "UpdateLevel";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly levels: LevelRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: UpdateLevelInput, session: SessionContext) {
    const before = await this.levels.findById(input.id);
    if (!before) throw new StructureError("Level not found.");
    if (input.patch.name !== undefined)
      StructureRules.requireNonEmpty(input.patch.name, "Level name");
    if (input.patch.rank !== undefined) {
      StructureRules.requirePositiveRank(input.patch.rank);
      if (
        input.patch.rank !== before.rank &&
        (await this.levels.existsRank(before.programmeId, input.patch.rank))
      ) {
        throw new StructureError(
          `A level with rank ${input.patch.rank} already exists in this programme.`,
        );
      }
    }
    const patch: Partial<Omit<Level, "id">> = {
      ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
      ...(input.patch.rank !== undefined ? { rank: input.patch.rank } : {}),
      // null clears the per-level grade scale (back to default).
      ...(input.patch.gradeScaleId !== undefined
        ? { gradeScaleId: input.patch.gradeScaleId ?? undefined }
        : {}),
    };
    const updated = await this.levels.update(input.id, patch);
    await audit(this.auditLog, session, "UPDATE", "Level", input.id, {
      gradeScaleId: updated.gradeScaleId ?? null,
    });
    return updated;
  }
}

export interface DeleteLevelInput {
  id: string;
}
export class DeleteLevel implements AuthorizedUseCase<DeleteLevelInput, void> {
  readonly name = "DeleteLevel";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly levels: LevelRepository,
    private readonly auditLog: AuditLogPort,
  ) {}
  async execute(input: DeleteLevelInput, session: SessionContext) {
    const level = await this.levels.findById(input.id);
    if (!level) throw new StructureError("Level not found.");
    await this.levels.softDelete(input.id);
    await audit(this.auditLog, session, "DELETE", "Level", input.id);
  }
}
