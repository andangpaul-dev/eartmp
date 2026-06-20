/**
 * Effective-attempt selection (Workstream B). Per courseId, attempts are ordered
 * by session, then semester rank, then sitting (NORMAL before RESIT); the LATEST
 * attempt is "effective" and counts toward GPA, every earlier attempt is
 * discounted (kept for the transcript). An INCOMPLETE latest attempt leaves the
 * course pending — excluded from GPA until resolved. Pure: no I/O.
 */
import type {
  ResultSitting,
  ResultStatus,
} from "../value-objects/ResultSitting";
import { isPending } from "../value-objects/ResultSitting";

export interface Attempt {
  id: string;
  courseId: string;
  sessionOrder: number;
  semesterRank: number;
  sitting: ResultSitting;
  status: ResultStatus;
}

const SITTING_ORDER: Record<ResultSitting, number> = { NORMAL: 0, RESIT: 1 };

export function orderAttempts<T extends Attempt>(attempts: T[]): T[] {
  return [...attempts].sort(
    (x, y) =>
      x.sessionOrder - y.sessionOrder ||
      x.semesterRank - y.semesterRank ||
      SITTING_ORDER[x.sitting] - SITTING_ORDER[y.sitting],
  );
}

export interface EffectiveSelection {
  effectiveIds: Set<string>;
  pendingCourseIds: Set<string>;
  isReattempt(id: string): boolean;
}

export function selectEffective(attempts: Attempt[]): EffectiveSelection {
  const byCourse = new Map<string, Attempt[]>();
  for (const at of attempts) {
    const list = byCourse.get(at.courseId) ?? [];
    list.push(at);
    byCourse.set(at.courseId, list);
  }
  const effectiveIds = new Set<string>();
  const pendingCourseIds = new Set<string>();
  const reattemptIds = new Set<string>();
  for (const [courseId, list] of byCourse) {
    const ordered = orderAttempts(list);
    ordered.forEach((at, i) => {
      if (i > 0) reattemptIds.add(at.id);
    });
    const latest = ordered[ordered.length - 1]!;
    if (isPending(latest.status)) pendingCourseIds.add(courseId);
    else effectiveIds.add(latest.id);
  }
  return {
    effectiveIds,
    pendingCourseIds,
    isReattempt: (id) => reattemptIds.has(id),
  };
}
