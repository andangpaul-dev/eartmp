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
import { ConcurrencyError } from "../../domain/errors/persistence";
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
  facultyId: string | null;
  departmentId: string | null;
  programmeId: string | null;
  levelId: string | null;
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
    facultyId: r.facultyId ?? undefined,
    departmentId: r.departmentId ?? undefined,
    programmeId: r.programmeId ?? undefined,
    levelId: r.levelId ?? undefined,
    admissionSession: r.admissionSession ?? undefined,
    status: r.status as StudentStatus,
  };
}

export class PrismaStudentRepository
  implements StudentRepository, VersionedStudentWrites
{
  constructor(private readonly db: Db) {}

  async create(data: Omit<Student, "id">): Promise<Student> {
    const r = await this.db.student.create({
      data: {
        matricNumber: data.matricNumber,
        regNumber: data.regNumber,
        fullName: data.fullName,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        nationality: data.nationality,
        facultyId: data.facultyId,
        departmentId: data.departmentId,
        programmeId: data.programmeId,
        levelId: data.levelId,
        admissionSession: data.admissionSession,
        status: data.status,
      },
    });
    return toStudent(r);
  }

  async update(id: string, patch: Partial<Omit<Student, "id">>) {
    const r = await this.db.student.update({
      where: { id },
      data: {
        ...(patch.regNumber !== undefined
          ? { regNumber: patch.regNumber }
          : {}),
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
        ...(patch.dateOfBirth !== undefined
          ? { dateOfBirth: patch.dateOfBirth }
          : {}),
        ...(patch.nationality !== undefined
          ? { nationality: patch.nationality }
          : {}),
        ...(patch.facultyId !== undefined
          ? { facultyId: patch.facultyId }
          : {}),
        ...(patch.departmentId !== undefined
          ? { departmentId: patch.departmentId }
          : {}),
        ...(patch.programmeId !== undefined
          ? { programmeId: patch.programmeId }
          : {}),
        ...(patch.levelId !== undefined ? { levelId: patch.levelId } : {}),
        ...(patch.admissionSession !== undefined
          ? { admissionSession: patch.admissionSession }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      },
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
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
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
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.regNumber !== undefined
          ? { regNumber: patch.regNumber }
          : {}),
        ...(patch.departmentId !== undefined
          ? { departmentId: patch.departmentId }
          : {}),
        ...(patch.programmeId !== undefined
          ? { programmeId: patch.programmeId }
          : {}),
        ...(patch.levelId !== undefined ? { levelId: patch.levelId } : {}),
        version: { increment: 1 },
      },
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
  programmeId: string | null;
  levelId: string | null;
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
    programmeId: r.programmeId ?? undefined,
    levelId: r.levelId ?? undefined,
    semesterRank: r.semesterRank ?? undefined,
  };
}

export class PrismaCourseRepository implements CourseRepository {
  constructor(private readonly db: Db) {}

  async create(data: Omit<Course, "id">): Promise<Course> {
    const r = await this.db.course.create({
      data: {
        code: data.code,
        title: data.title,
        creditValue: data.creditValue,
        courseType: data.courseType,
        departmentId: data.departmentId,
        programmeId: data.programmeId,
        levelId: data.levelId,
        semesterRank: data.semesterRank,
      },
    });
    return toCourse(r);
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
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
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
  ): Promise<boolean> {
    return (
      (await this.db.result.count({
        where: { studentId, courseId, semesterId, ...live },
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
      finalScore: number;
    },
  ): Promise<void> {
    await this.db.result.update({
      where: { id },
      data: {
        componentScores: JSON.stringify(data.componentScores),
        finalScore: data.finalScore,
      },
    });
  }

  async setLockedForSemester(
    studentId: string,
    semesterId: string,
    locked: boolean,
  ): Promise<number> {
    const { count } = await this.db.result.updateMany({
      where: { studentId, semesterId, ...live },
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
