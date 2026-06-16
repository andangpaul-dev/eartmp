/**
 * Sub-department hierarchy use-cases (department → sub-department). Writes are
 * gated `structure.manage` and audited; reads require `structure.read`. The
 * parent department must exist & be live; a sub-department with live children
 * (programmes/courses/students) can't be deleted (AD5.4 / AD5.6).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { StructureError } from "../../../domain/errors/structure";
import { StructureRules } from "../../../domain/entities/structure";
import type { SubDepartment } from "../../../domain/entities/structure";
import type {
  SubDepartmentRepository,
  DepartmentRepository,
} from "../../../domain/repositories/structure";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

const MANAGE = ["structure.manage"];
const READ = ["structure.read"];

export interface CreateSubDepartmentInput {
  name: string;
  code: string;
  departmentId: string;
}
export class CreateSubDepartment implements AuthorizedUseCase<
  CreateSubDepartmentInput,
  SubDepartment
> {
  readonly name = "CreateSubDepartment";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly subDepartments: SubDepartmentRepository,
    private readonly departments: DepartmentRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: CreateSubDepartmentInput, session: SessionContext) {
    StructureRules.requireNonEmpty(input.name, "Sub-department name");
    StructureRules.requireNonEmpty(input.code, "Sub-department code");
    if (!(await this.departments.findById(input.departmentId))) {
      throw new StructureError(
        "Parent department does not exist or is deleted.",
      );
    }
    if (await this.subDepartments.findByCode(input.code)) {
      throw new StructureError(
        `Sub-department code "${input.code}" already in use.`,
      );
    }
    const created = await this.subDepartments.create({
      name: input.name,
      code: input.code,
      departmentId: input.departmentId,
    });
    await this.audit.record({
      userId: session.actorId,
      action: "CREATE",
      entity: "SubDepartment",
      recordId: created.id,
      newValue: { code: created.code, departmentId: created.departmentId },
    });
    return created;
  }
}

export interface UpdateSubDepartmentInput {
  id: string;
  patch: { name?: string; code?: string };
}
export class UpdateSubDepartment implements AuthorizedUseCase<
  UpdateSubDepartmentInput,
  SubDepartment
> {
  readonly name = "UpdateSubDepartment";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly subDepartments: SubDepartmentRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: UpdateSubDepartmentInput, session: SessionContext) {
    const before = await this.subDepartments.findById(input.id);
    if (!before) throw new StructureError("Sub-department not found.");
    if (input.patch.name !== undefined) {
      StructureRules.requireNonEmpty(input.patch.name, "Sub-department name");
    }
    if (input.patch.code !== undefined) {
      StructureRules.requireNonEmpty(input.patch.code, "Sub-department code");
      const clash = await this.subDepartments.findByCode(input.patch.code);
      if (clash && clash.id !== input.id) {
        throw new StructureError(
          `Sub-department code "${input.patch.code}" already in use.`,
        );
      }
    }
    const updated = await this.subDepartments.update(input.id, input.patch);
    await this.audit.record({
      userId: session.actorId,
      action: "UPDATE",
      entity: "SubDepartment",
      recordId: input.id,
      oldValue: before,
      newValue: updated,
    });
    return updated;
  }
}

export interface DeleteSubDepartmentInput {
  id: string;
}
export class DeleteSubDepartment implements AuthorizedUseCase<
  DeleteSubDepartmentInput,
  void
> {
  readonly name = "DeleteSubDepartment";
  readonly requiredPermissions = MANAGE;
  constructor(
    private readonly subDepartments: SubDepartmentRepository,
    private readonly audit: AuditLogPort,
  ) {}
  async execute(input: DeleteSubDepartmentInput, session: SessionContext) {
    const sd = await this.subDepartments.findById(input.id);
    if (!sd) throw new StructureError("Sub-department not found.");
    if (await this.subDepartments.hasLiveChildren(input.id)) {
      throw new StructureError(
        "Cannot delete a sub-department that still has programmes, courses or students.",
      );
    }
    await this.subDepartments.softDelete(input.id);
    await this.audit.record({
      userId: session.actorId,
      action: "DELETE",
      entity: "SubDepartment",
      recordId: input.id,
    });
  }
}

export interface ListSubDepartmentsInput {
  departmentId: string;
}
export class ListSubDepartments implements AuthorizedUseCase<
  ListSubDepartmentsInput,
  SubDepartment[]
> {
  readonly name = "ListSubDepartments";
  readonly requiredPermissions = READ;
  constructor(private readonly subDepartments: SubDepartmentRepository) {}
  async execute(input: ListSubDepartmentsInput, _session: SessionContext) {
    return this.subDepartments.listByDepartment(input.departmentId);
  }
}
