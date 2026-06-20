/**
 * MergeStudents + FindDuplicateCandidates (Workstream C Phase 7).
 *
 * MergeStudents: atomically merges a duplicate student into the surviving
 * record.  All relations (results, transcripts, enrollments) are re-pointed
 * from the duplicate to the survivor before the duplicate is soft-deleted.
 * A conflict check runs FIRST — if re-pointing would violate the unique key
 * (courseId, semesterId, sitting) on the results table, the merge is refused
 * without touching any data.
 *
 * FindDuplicateCandidates: heuristic scan of live students that surfaces
 * probable duplicates via two signals:
 *   (a) previousStudentId link — a live student pointing at another live student
 *   (b) exact full-name match — normalised fullName collides across students
 * Pairs are deduplicated by unordered {survivingId, duplicateId} key so the
 * same physical pair is never reported twice regardless of which signal found it.
 */
import { RecordsError } from "../../../domain/errors/records";
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type { StudentRepository } from "../../../domain/repositories/records";
import type { UnitOfWork } from "../../ports/UnitOfWork";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";
import {
  requireInScope,
  requireInFacultyScope,
  scopeStudentWhere,
} from "../../authorization/institutionScope";

// ── MergeStudents ────────────────────────────────────────────────────────────

export interface MergeStudentsInput {
  survivingId: string;
  duplicateId: string;
}

export class MergeStudents implements AuthorizedUseCase<
  MergeStudentsInput,
  { ok: true }
> {
  readonly name = "MergeStudents";
  readonly requiredPermissions = ["students.manage"];

  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    input: MergeStudentsInput,
    session: SessionContext,
  ): Promise<{ ok: true }> {
    const { survivingId, duplicateId } = input;

    return this.uow.run(async (repos) => {
      const { students, results, transcripts, enrollments, audit } = repos;

      // ── guard: ids must differ ─────────────────────────────────────────────
      if (survivingId === duplicateId) {
        throw new RecordsError(
          "survivingId and duplicateId must be different students.",
        );
      }

      // ── load both students ─────────────────────────────────────────────────
      const [survivor, duplicate] = await Promise.all([
        students.findById(survivingId),
        students.findById(duplicateId),
      ]);

      if (!survivor) {
        throw new RecordsError(`Surviving student "${survivingId}" not found.`);
      }
      if (!duplicate) {
        throw new RecordsError(`Duplicate student "${duplicateId}" not found.`);
      }

      // ── scope guard on BOTH ────────────────────────────────────────────────
      requireInScope(survivor.institutionId, session);
      requireInFacultyScope(survivor.facultyId, session);
      requireInScope(duplicate.institutionId, session);
      requireInFacultyScope(duplicate.facultyId, session);

      // ── conflict check ─────────────────────────────────────────────────────
      // Load the full result sets for both students; reject if any
      // (courseId, semesterId, sitting) key appears in both — re-pointing would
      // violate the unique index.
      const [survivorResults, duplicateResults] = await Promise.all([
        results.findByStudent(survivingId),
        results.findByStudent(duplicateId),
      ]);

      const survivorKeys = new Set(
        survivorResults.map(
          (r) => `${r.courseId}::${r.semesterId}::${r.sitting}`,
        ),
      );
      const conflicting = duplicateResults
        .map((r) => `${r.courseId}::${r.semesterId}::${r.sitting}`)
        .filter((k) => survivorKeys.has(k));

      if (conflicting.length > 0) {
        const courseIds = [
          ...new Set(conflicting.map((k) => k.split("::")[0])),
        ].join(", ");
        throw new RecordsError(
          `Cannot merge: conflicting results for course(s) ${courseIds}`,
        );
      }

      // ── re-point all relations ─────────────────────────────────────────────
      await Promise.all([
        results.reassignStudent(duplicateId, survivingId),
        transcripts.reassignStudent(duplicateId, survivingId),
        enrollments.reassignStudent(duplicateId, survivingId),
      ]);

      // ── soft-delete the duplicate ──────────────────────────────────────────
      await students.softDelete(duplicateId);

      // ── audit ──────────────────────────────────────────────────────────────
      await audit.record({
        userId: session.actorId,
        action: "MERGE",
        entity: "Student",
        recordId: survivingId,
        oldValue: {
          duplicateId,
          duplicateMatric: duplicate.matricNumber,
        },
        newValue: { survivingId },
      });

      return { ok: true as const };
    });
  }
}

// ── FindDuplicateCandidates ──────────────────────────────────────────────────

export interface DuplicateCandidate {
  survivingId: string;
  duplicateId: string;
  reason: string;
}

export class FindDuplicateCandidates implements AuthorizedUseCase<
  Record<never, never>,
  DuplicateCandidate[]
> {
  readonly name = "FindDuplicateCandidates";
  readonly requiredPermissions = ["students.read"];

  constructor(private readonly students: StudentRepository) {}

  async execute(
    _input: Record<never, never>,
    session: SessionContext,
  ): Promise<DuplicateCandidate[]> {
    // Load up to 1000 live students visible to this operator.
    const { items } = await this.students.find({
      where: scopeStudentWhere<{ institutionId?: string; facultyId?: string }>(
        undefined,
        session,
      ),
      take: 1000,
      skip: 0,
    });

    const liveById = new Map(items.map((s) => [s.id, s]));
    const pairs: DuplicateCandidate[] = [];

    // Track emitted (unordered) pairs to deduplicate.
    function pairKey(a: string, b: string): string {
      return a < b ? `${a}::${b}` : `${b}::${a}`;
    }
    const emitted = new Set<string>();

    function emit(c: DuplicateCandidate): void {
      const key = pairKey(c.survivingId, c.duplicateId);
      if (!emitted.has(key)) {
        emitted.add(key);
        pairs.push(c);
      }
    }

    // (a) previousStudentId links ───────────────────────────────────────────
    for (const student of items) {
      if (
        student.previousStudentId &&
        liveById.has(student.previousStudentId)
      ) {
        // The student pointed-to is the older/original → survivingId.
        // The one doing the pointing is the duplicate.
        emit({
          survivingId: student.previousStudentId,
          duplicateId: student.id,
          reason: "previousStudentId link",
        });
      }
    }

    // (b) exact full-name matches ───────────────────────────────────────────
    // Group by normalised (trim + lowercase) fullName.
    const byName = new Map<string, typeof items>();
    for (const student of items) {
      const norm = student.fullName.trim().toLowerCase();
      const group = byName.get(norm);
      if (group) {
        group.push(student);
      } else {
        byName.set(norm, [student]);
      }
    }

    for (const group of byName.values()) {
      if (group.length < 2) continue;
      // Sort ascending by id to give a stable "older = survivor" ordering.
      const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : 1));
      // Emit all pairs (n*(n-1)/2) — (older, newer).
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          emit({
            survivingId: sorted[i]!.id,
            duplicateId: sorted[j]!.id,
            reason: "exact name match",
          });
        }
      }
    }

    return pairs;
  }
}
