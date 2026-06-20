/**
 * In-memory fakes for the Phase 9 results tests: a ResultRepository, a fake
 * UnitOfWork, and a tiny GradingConfigService built from in-memory config.
 */
import type { ResultRecord } from "../../src/domain/entities";
import type {
  ResultRepository,
  StudentRepository,
  CourseRepository,
  StudentEnrollmentRepository,
  SemesterOrdering,
  MatriculeCounterRepository,
} from "../../src/domain/repositories/records";
import type {
  UnitOfWork,
  TransactionalRepos,
} from "../../src/application/ports/UnitOfWork";
import type { AuditLogPort } from "../../src/domain/repositories";
import type {
  ResultSitting,
  ResultStatus,
} from "../../src/domain/value-objects/ResultSitting";

/** Default fake SemesterOrdering: maps every id to {sessionOrder:0, rank:0}. */
export const defaultFakeSemesterOrdering: SemesterOrdering = {
  async order(ids: string[]) {
    return new Map(ids.map((id) => [id, { sessionOrder: 0, rank: 0 }]));
  },
};

export class FakeResultRepo implements ResultRepository {
  readonly rows: ResultRecord[] = [];
  /** Captures the gradeScaleId passed to updateProcessed (provenance, F-19). */
  readonly provenance: Record<string, string | undefined> = {};
  private seq = 0;
  private live(id: string) {
    return this.rows.find((r) => r.id === id);
  }
  async create(data: Omit<ResultRecord, "id">) {
    const r: ResultRecord = { ...data, id: `r${++this.seq}` };
    this.rows.push(r);
    return { ...r };
  }
  async findById(id: string) {
    const r = this.live(id);
    return r ? { ...r } : null;
  }
  async existsFor(
    studentId: string,
    courseId: string,
    semesterId: string,
    sitting: ResultSitting,
  ) {
    return this.rows.some(
      (r) =>
        r.studentId === studentId &&
        r.courseId === courseId &&
        r.semesterId === semesterId &&
        r.sitting === sitting,
    );
  }
  async findByStudentAndSemester(studentId: string, semesterId: string) {
    return this.rows
      .filter((r) => r.studentId === studentId && r.semesterId === semesterId)
      .map((r) => ({ ...r }));
  }
  async findByStudent(studentId: string) {
    return this.rows
      .filter((r) => r.studentId === studentId)
      .map((r) => ({ ...r }));
  }
  async updateScores(
    id: string,
    data: {
      componentScores: { key: string; score: number }[];
      finalScore?: number | null;
      status?: ResultStatus;
    },
  ) {
    const r = this.live(id)!;
    r.componentScores = data.componentScores;
    if ("finalScore" in data) {
      if (data.finalScore == null) {
        delete r.finalScore;
      } else {
        r.finalScore = data.finalScore;
      }
    }
    if (data.status !== undefined) r.status = data.status;
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
  ) {
    const r = this.live(id)!;
    r.grade = data.grade;
    r.gradePoint = data.gradePoint;
    r.creditsEarned = data.creditsEarned;
    this.provenance[id] = data.gradeScaleId;
  }
  async setLockedForSemester(
    studentId: string,
    semesterId: string,
    locked: boolean,
    sitting?: ResultSitting,
  ) {
    let n = 0;
    for (const r of this.rows) {
      if (
        r.studentId === studentId &&
        r.semesterId === semesterId &&
        (sitting === undefined || r.sitting === sitting)
      ) {
        r.isLocked = locked;
        n++;
      }
    }
    return n;
  }
  async unlock(id: string) {
    const r = this.live(id);
    if (r) r.isLocked = false;
  }
}

class FakeMatriculeCounter implements MatriculeCounterRepository {
  private counters = new Map<string, number>();
  private key(i: string | null, f: string, y: number) {
    return `${i}:${f}:${y}`;
  }
  async peek(institutionId: string | null, facultyId: string, year: number) {
    return this.counters.get(this.key(institutionId, facultyId, year)) ?? 1;
  }
  async reserve(institutionId: string | null, facultyId: string, year: number) {
    const k = this.key(institutionId, facultyId, year);
    const current = this.counters.get(k) ?? 1;
    this.counters.set(k, current + 1);
    return current;
  }
}

/** Fake UnitOfWork that runs the work against the given repos (no real tx). */
export function fakeUow(repos: Partial<TransactionalRepos>): UnitOfWork {
  return {
    run<T>(work: (r: TransactionalRepos) => Promise<T>) {
      return work({
        students: {} as StudentRepository,
        enrollments: {} as StudentEnrollmentRepository,
        courses: {} as CourseRepository,
        results: {} as ResultRepository,
        audit: { async record() {} } as AuditLogPort,
        semesterOrdering: defaultFakeSemesterOrdering,
        matriculeCounter: new FakeMatriculeCounter(),
        ...repos,
      });
    },
  };
}
