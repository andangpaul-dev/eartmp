/**
 * Prisma-backed records repositories — DEV-ONLY adapter (ADR-007; replaced by
 * the Tauri-SQL data layer in the shell phase). Students, courses, enrollment,
 * results. Constructors accept a `Prisma.TransactionClient` so the SAME repos
 * run both standalone (a full PrismaClient is assignable) and inside a
 * UnitOfWork transaction. All reads filter live rows; `findByMatric`/`findByCode`
 * honour the partial-unique-among-live contract; `find` is paginated (F-7).
 */
import type { Prisma } from "@prisma/client";
import type {
  Student,
  Course,
  StudentStatus,
  ResultRecord,
} from "../../domain/entities";
import type { StudentEnrollment } from "../../domain/entities/enrollment";
import {
  ConcurrencyError,
  UniqueConstraintError,
} from "../../domain/errors/persistence";
import { ValidationError } from "../../domain/errors/validation";
import type {
  StudentRepository,
  CourseRepository,
  StudentEnrollmentRepository,
  ResultRepository,
  VersionedStudentWrites,
  StudentQuery,
  CourseQuery,
  Page,
} from "../../domain/repositories/records";
import type {
  ResultSitting,
  ResultStatus,
} from "../../domain/value-objects/ResultSitting";

type Db = Prisma.TransactionClient;

const live = { deletedAt: null } as const;

type StudentRow = {
  id: string;
  matricNumber: string;
  regNumber: string | null;
  fullName: string;
  gender: string | null;
  dateOfBirth: Date | null;
  nationality: string | null;
  address: string | null;
  telephone: string | null;
  email: string | null;
  facultyId: string | null;
  departmentId: string | null;
  subDepartmentId: string | null;
  programmeId: string | null;
  levelId: string | null;
  institutionId: string | null;
  admissionSession: string | null;
  status: string;
};

function toStudent(r: StudentRow): Student {
  return {
    id: r.id,
    matricNumber: r.matricNumber,
    regNumber: r.regNumber ?? undefined,
    fullName: r.fullName,
    gender: r.gender ?? undefined,
    dateOfBirth: r.dateOfBirth ?? undefined,
    nationality: r.nationality ?? undefined,
    address: r.address ?? undefined,
    telephone: r.telephone ?? undefined,
    email: r.email ?? undefined,
    facultyId: r.facultyId ?? undefined,
    departmentId: r.departmentId ?? undefined,
    subDepartmentId: r.subDepartmentId ?? undefined,
    institutionId: r.institutionId ?? undefined,
    programmeId: r.programmeId ?? undefined,
    levelId: r.levelId ?? undefined,
    admissionSession: r.admissionSession ?? undefined,
    status: r.status as StudentStatus,
  };
}

/** Map a Student patch to Prisma write data — shared by update + tryUpdate so
 *  both persist the SAME full field set (no silently-dropped edits). */
function studentWriteData(
  patch: Partial<Omit<Student, "id">>,
): Record<string, unknown> {
  const keys: (keyof Omit<Student, "id">)[] = [
    "regNumber",
    "fullName",
    "gender",
    "dateOfBirth",
    "nationality",
    "address",
    "telephone",
    "email",
    "facultyId",
    "departmentId",
    "subDepartmentId",
    "institutionId",
    "programmeId",
    "levelId",
    "admissionSession",
    "status",
  ];
  const data: Record<string, unknown> = {};
  for (const k of keys) {
    if (patch[k] !== undefined) data[k] = patch[k];
  }
  // dateOfBirth crosses the IPC boundary as an ISO string — coerce to a Date
  // (and treat empty string as cleared) for Prisma.
  if (typeof data.dateOfBirth === "string") {
    data.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  }
  return data;
}

export class PrismaStudentRepository
  implements StudentRepository, VersionedStudentWrites
{
  constructor(private readonly db: Db) {}

  /** Resolve the denormalized institution from the student's placement. */
  private async resolveInstitution(
    data: Pick<
      Student,
      | "institutionId"
      | "facultyId"
      | "departmentId"
      | "subDepartmentId"
      | "programmeId"
    >,
  ): Promise<string | null> {
    if (data.institutionId) return data.institutionId;
    // Resolves + validates that all placement parents share one institution.
    return resolveInstitutionId(this.db, {
      facultyId: data.facultyId,
      departmentId: data.departmentId,
      subDepartmentId: data.subDepartmentId,
      programmeId: data.programmeId,
    });
  }

  async create(data: Omit<Student, "id">): Promise<Student> {
    const institutionId = await this.resolveInstitution(data);
    const r = await this.db.student.create({
      data: {
        matricNumber: data.matricNumber,
        regNumber: data.regNumber,
        fullName: data.fullName,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        nationality: data.nationality,
        address: data.address,
        telephone: data.telephone,
        email: data.email,
        facultyId: data.facultyId,
        departmentId: data.departmentId,
        subDepartmentId: data.subDepartmentId,
        programmeId: data.programmeId,
        levelId: data.levelId,
        institutionId,
        admissionSession: data.admissionSession,
        status: data.status,
      },
    });
    return toStudent(r);
  }

  async update(id: string, patch: Partial<Omit<Student, "id">>) {
    const r = await this.db.student.update({
      where: { id },
      data: studentWriteData(patch),
    });
    return toStudent(r);
  }

  async softDelete(id: string): Promise<void> {
    await this.db.student.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findById(id: string) {
    const r = await this.db.student.findFirst({ where: { id, ...live } });
    return r ? toStudent(r) : null;
  }

  async findByMatric(matricNumber: string) {
    const r = await this.db.student.findFirst({
      where: { matricNumber, ...live },
    });
    return r ? toStudent(r) : null;
  }

  async find(query: StudentQuery): Promise<Page<Student>> {
    const f = query.where ?? {};
    const where: Prisma.StudentWhereInput = {
      deletedAt: null,
      ...(f.institutionId ? { institutionId: f.institutionId } : {}),
      ...(f.facultyId ? { facultyId: f.facultyId } : {}),
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
      ...(f.subDepartmentId ? { subDepartmentId: f.subDepartmentId } : {}),
      ...(f.programmeId ? { programmeId: f.programmeId } : {}),
      ...(f.levelId ? { levelId: f.levelId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.search
        ? {
            OR: [
              { matricNumber: { contains: f.search } },
              { fullName: { contains: f.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.student.findMany({
        where,
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: { matricNumber: "asc" },
      }),
      this.db.student.count({ where }),
    ]);
    return { items: rows.map(toStudent), total };
  }

  // --- VersionedStudentWrites (optimistic locking, F-27) -------------------

  async readVersion(id: string): Promise<number | null> {
    const r = await this.db.student.findFirst({
      where: { id, ...live },
      select: { version: true },
    });
    return r ? r.version : null;
  }

  async tryUpdate(
    id: string,
    patch: Partial<Omit<Student, "id">>,
    expectedVersion: number,
  ): Promise<number> {
    const res = await this.db.student.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...studentWriteData(patch), version: { increment: 1 } },
    });
    if (res.count === 0) throw new ConcurrencyError();
    return expectedVersion + 1;
  }
}

type CourseRow = {
  id: string;
  code: string;
  title: string;
  creditValue: number;
  courseType: string;
  departmentId: string | null;
  subDepartmentId: string | null;
  programmeId: string | null;
  levelId: string | null;
  institutionId: string | null;
  semesterRank: number | null;
};

function toCourse(r: CourseRow): Course {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    creditValue: r.creditValue,
    courseType: r.courseType as Course["courseType"],
    departmentId: r.departmentId ?? undefined,
    subDepartmentId: r.subDepartmentId ?? undefined,
    programmeId: r.programmeId ?? undefined,
    levelId: r.levelId ?? undefined,
    institutionId: r.institutionId ?? undefined,
    semesterRank: r.semesterRank ?? undefined,
  };
}

/**
 * Resolve the institution a placement belongs to, and VALIDATE that every
 * provided parent (faculty/department/sub-department/programme) resolves to the
 * SAME institution (Phase E). A placement spanning institutions is rejected —
 * you can't, e.g., put a student in faculty A's institution but department B's.
 */
async function resolveInstitutionId(
  db: Db,
  ids: {
    facultyId?: string;
    departmentId?: string;
    subDepartmentId?: string;
    programmeId?: string;
  },
): Promise<string | null> {
  const found = new Map<string, string>(); // placement field → institutionId
  if (ids.facultyId) {
    const f = await db.faculty.findFirst({
      where: { id: ids.facultyId },
      select: { institutionId: true },
    });
    if (f?.institutionId) found.set("faculty", f.institutionId);
  }
  if (ids.departmentId) {
    const d = await db.department.findFirst({
      where: { id: ids.departmentId },
      select: { institutionId: true },
    });
    if (d?.institutionId) found.set("department", d.institutionId);
  }
  if (ids.subDepartmentId) {
    const sd = await db.subDepartment.findFirst({
      where: { id: ids.subDepartmentId },
      select: { institutionId: true },
    });
    if (sd?.institutionId) found.set("sub-department", sd.institutionId);
  }
  if (ids.programmeId) {
    const p = await db.programme.findFirst({
      where: { id: ids.programmeId },
      select: { institutionId: true },
    });
    if (p?.institutionId) found.set("programme", p.institutionId);
  }
  const distinct = new Set(found.values());
  if (distinct.size > 1) {
    throw new ValidationError(
      "Placement spans multiple institutions — the faculty, department, " +
        "sub-department and programme must all belong to the same institution.",
    );
  }
  return distinct.size === 1 ? [...distinct][0]! : null;
}

export class PrismaCourseRepository implements CourseRepository {
  constructor(private readonly db: Db) {}

  async create(data: Omit<Course, "id">): Promise<Course> {
    const institutionId =
      data.institutionId ?? (await resolveInstitutionId(this.db, data));
    try {
      const r = await this.db.course.create({
        data: {
          code: data.code,
          title: data.title,
          creditValue: data.creditValue,
          courseType: data.courseType,
          departmentId: data.departmentId,
          subDepartmentId: data.subDepartmentId,
          programmeId: data.programmeId,
          levelId: data.levelId,
          institutionId,
          semesterRank: data.semesterRank,
        },
      });
      return toCourse(r);
    } catch (e) {
      // P2002 on the per-institution (institutionId, code) unique index.
      if ((e as { code?: string }).code === "P2002") {
        throw new UniqueConstraintError("code");
      }
      throw e;
    }
  }

  async update(id: string, patch: Partial<Omit<Course, "id">>) {
    const r = await this.db.course.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.creditValue !== undefined
          ? { creditValue: patch.creditValue }
          : {}),
        ...(patch.courseType !== undefined
          ? { courseType: patch.courseType }
          : {}),
        ...(patch.departmentId !== undefined
          ? { departmentId: patch.departmentId }
          : {}),
        ...(patch.subDepartmentId !== undefined
          ? { subDepartmentId: patch.subDepartmentId }
          : {}),
        ...(patch.programmeId !== undefined
          ? { programmeId: patch.programmeId }
          : {}),
        ...(patch.levelId !== undefined ? { levelId: patch.levelId } : {}),
        ...(patch.semesterRank !== undefined
          ? { semesterRank: patch.semesterRank }
          : {}),
      },
    });
    return toCourse(r);
  }

  async softDelete(id: string): Promise<void> {
    await this.db.course.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findById(id: string) {
    const r = await this.db.course.findFirst({ where: { id, ...live } });
    return r ? toCourse(r) : null;
  }

  async findByCode(code: string) {
    const r = await this.db.course.findFirst({ where: { code, ...live } });
    return r ? toCourse(r) : null;
  }

  async find(query: CourseQuery): Promise<Page<Course>> {
    const f = query.where ?? {};
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      ...(f.institutionId ? { institutionId: f.institutionId } : {}),
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
      ...(f.subDepartmentId ? { subDepartmentId: f.subDepartmentId } : {}),
      ...(f.programmeId ? { programmeId: f.programmeId } : {}),
      ...(f.levelId ? { levelId: f.levelId } : {}),
      ...(f.courseType ? { courseType: f.courseType } : {}),
      ...(f.search
        ? {
            OR: [
              { code: { contains: f.search } },
              { title: { contains: f.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.course.findMany({
        where,
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: { code: "asc" },
      }),
      this.db.course.count({ where }),
    ]);
    return { items: rows.map(toCourse), total };
  }
}

type EnrollmentRow = {
  id: string;
  studentId: string;
  programmeId: string;
  levelId: string;
  fromSession: string;
  toSession: string | null;
  isCurrent: boolean;
};

function toEnrollment(r: EnrollmentRow): StudentEnrollment {
  return {
    id: r.id,
    studentId: r.studentId,
    programmeId: r.programmeId,
    levelId: r.levelId,
    fromSession: r.fromSession,
    toSession: r.toSession ?? undefined,
    isCurrent: r.isCurrent,
  };
}

export class PrismaStudentEnrollmentRepository implements StudentEnrollmentRepository {
  constructor(private readonly db: Db) {}

  async create(
    data: Omit<StudentEnrollment, "id">,
  ): Promise<StudentEnrollment> {
    const r = await this.db.studentEnrollment.create({
      data: {
        studentId: data.studentId,
        programmeId: data.programmeId,
        levelId: data.levelId,
        fromSession: data.fromSession,
        toSession: data.toSession,
        isCurrent: data.isCurrent,
      },
    });
    return toEnrollment(r);
  }

  async findCurrent(studentId: string) {
    const r = await this.db.studentEnrollment.findFirst({
      where: { studentId, isCurrent: true, ...live },
    });
    return r ? toEnrollment(r) : null;
  }

  async closeCurrent(studentId: string, toSession: string): Promise<void> {
    await this.db.studentEnrollment.updateMany({
      where: { studentId, isCurrent: true, ...live },
      data: { isCurrent: false, toSession },
    });
  }

  async listByStudent(studentId: string) {
    const rows = await this.db.studentEnrollment.findMany({
      where: { studentId, ...live },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toEnrollment);
  }
}

type ResultRow = {
  id: string;
  studentId: string;
  courseId: string;
  semesterId: string;
  componentScores: string;
  finalScore: number | null;
  grade: string | null;
  gradePoint: number | null;
  creditsEarned: number | null;
  isLocked: boolean;
  sitting: string;
  status: string;
};

function toResult(r: ResultRow): ResultRecord {
  return {
    id: r.id,
    studentId: r.studentId,
    courseId: r.courseId,
    semesterId: r.semesterId,
    componentScores: JSON.parse(r.componentScores) as {
      key: string;
      score: number;
    }[],
    finalScore: r.finalScore ?? undefined,
    grade: r.grade ?? undefined,
    gradePoint: r.gradePoint ?? undefined,
    creditsEarned: r.creditsEarned ?? undefined,
    isLocked: r.isLocked,
    sitting: r.sitting as ResultSitting,
    status: r.status as ResultStatus,
  };
}

export class PrismaResultRepository implements ResultRepository {
  constructor(private readonly db: Db) {}

  async create(data: Omit<ResultRecord, "id">): Promise<ResultRecord> {
    const row = await this.db.result.create({
      data: {
        studentId: data.studentId,
        courseId: data.courseId,
        semesterId: data.semesterId,
        componentScores: JSON.stringify(data.componentScores),
        finalScore: data.finalScore,
        grade: data.grade,
        gradePoint: data.gradePoint,
        creditsEarned: data.creditsEarned,
        isLocked: data.isLocked,
        sitting: data.sitting,
        status: data.status,
      },
    });
    return toResult(row);
  }

  async findById(id: string): Promise<ResultRecord | null> {
    const row = await this.db.result.findFirst({ where: { id, ...live } });
    return row ? toResult(row) : null;
  }

  async existsFor(
    studentId: string,
    courseId: string,
    semesterId: string,
    sitting: ResultSitting,
  ): Promise<boolean> {
    return (
      (await this.db.result.count({
        where: { studentId, courseId, semesterId, sitting, ...live },
      })) > 0
    );
  }

  async findByStudentAndSemester(
    studentId: string,
    semesterId: string,
  ): Promise<ResultRecord[]> {
    const rows = await this.db.result.findMany({
      where: { studentId, semesterId, ...live },
    });
    return rows.map(toResult);
  }

  async findByStudent(studentId: string): Promise<ResultRecord[]> {
    const rows = await this.db.result.findMany({
      where: { studentId, ...live },
    });
    return rows.map(toResult);
  }

  async updateScores(
    id: string,
    data: {
      componentScores: { key: string; score: number }[];
      finalScore?: number;
      status?: ResultStatus;
    },
  ): Promise<void> {
    await this.db.result.update({
      where: { id },
      data: {
        componentScores: JSON.stringify(data.componentScores),
        ...(data.finalScore !== undefined
          ? { finalScore: data.finalScore }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
  }

  async setLockedForSemester(
    studentId: string,
    semesterId: string,
    locked: boolean,
    sitting?: ResultSitting,
  ): Promise<number> {
    const { count } = await this.db.result.updateMany({
      where: {
        studentId,
        semesterId,
        ...(sitting ? { sitting } : {}),
        ...live,
      },
      data: { isLocked: locked },
    });
    return count;
  }

  async unlock(id: string): Promise<void> {
    await this.db.result.update({ where: { id }, data: { isLocked: false } });
  }

  async updateProcessed(
    id: string,
    data: {
      grade: string;
      gradePoint: number;
      creditsEarned: number;
      finalScore?: number;
      gradeScaleId?: string;
    },
  ): Promise<void> {
    await this.db.result.update({
      where: { id },
      data: {
        grade: data.grade,
        gradePoint: data.gradePoint,
        creditsEarned: data.creditsEarned,
        ...(data.finalScore !== undefined
          ? { finalScore: data.finalScore }
          : {}),
        ...(data.gradeScaleId !== undefined
          ? { gradeScaleId: data.gradeScaleId }
          : {}),
      },
    });
  }
}
