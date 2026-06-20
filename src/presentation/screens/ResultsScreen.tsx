/**
 * Results — enter component scores (the FINAL score is computed by the core's
 * assessment structure, never client math), process a semester (atomic; locks
 * the results), and unlock a single result (audited). Locked results are
 * read-only. CGPA/GPA values come from the core.
 */
import { useEffect, useMemo, useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import {
  Button,
  Card,
  Badge,
  Field,
  Modal,
  Toast,
  EmptyState,
  Icon,
} from "../components/ui";
import { StudentPicker } from "../components/StudentPicker";
import type { Student } from "../../domain/entities";

export function ResultsScreen() {
  const core = useCore();
  const { can } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [entering, setEntering] = useState(false);
  const [confirmProcess, setConfirmProcess] = useState(false);
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const sessions = useAsync(() => core.listSessions({}), []);
  const semesters = useAsync(
    () => (sessionId ? core.listSemesters({ sessionId }) : Promise.resolve([])),
    [sessionId],
  );
  const ready = student && semesterId;
  const list = useAsync(
    () =>
      ready
        ? core.getStudentSemesterResults({ studentId: student.id, semesterId })
        : Promise.resolve([]),
    [student?.id, semesterId],
  );
  // The programme's courses give each result its code/title and ALLOCATED
  // CREDIT VALUE — the same credit the core uses for the credit-weighted GPA/CGPA
  // and credits earned. Shown here so the credit is visible at point of entry.
  const courses = useAsync(
    () =>
      student?.programmeId
        ? core.listCourses({
            where: { programmeId: student.programmeId },
            take: 200,
          })
        : Promise.resolve({ items: [], total: 0 }),
    [student?.programmeId],
  );
  const courseById = useMemo(() => {
    const m = new Map<
      string,
      { code: string; title: string; creditValue: number }
    >();
    for (const c of courses.data?.items ?? []) m.set(c.id, c);
    return m;
  }, [courses.data]);
  const totalCredits = (list.data ?? []).reduce(
    (n, r) => n + (courseById.get(r.courseId)?.creditValue ?? 0),
    0,
  );

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2400);
  };

  // Process computes grades/GPA, then seals the semester with the audited
  // lock use-case — "Process & lock" is one finalize action to the user.
  const process = useAction(
    async () => {
      const gpa = await core.processSemester({
        studentId: student!.id,
        semesterId,
      });
      await core.lockSemesterResults({ studentId: student!.id, semesterId });
      return gpa;
    },
    {
      onSuccess: (gpa) => {
        setConfirmProcess(false);
        list.reload();
        notify(`Processed & locked — semester GPA ${gpa.gpa}`);
      },
    },
  );
  const unlock = useAction(() => core.unlockResult({ resultId: unlockId! }), {
    onSuccess: () => {
      setUnlockId(null);
      list.reload();
      notify("Result unlocked");
    },
  });

  return (
    <div className="stack">
      <Card>
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          <StudentPicker value={student} onChange={setStudent} />
          <Field label="Session">
            <select
              className="select"
              aria-label="Session"
              value={sessionId}
              onChange={(e) => {
                setSessionId(e.target.value);
                setSemesterId("");
              }}
            >
              <option value="">Select…</option>
              {sessions.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Semester">
            <select
              className="select"
              aria-label="Semester"
              value={semesterId}
              disabled={!sessionId}
              onChange={(e) => setSemesterId(e.target.value)}
            >
              <option value="">{sessionId ? "Select…" : "—"}</option>
              {semesters.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      {ready && (
        <Card>
          <div className="spread" style={{ marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>
              {student.fullName} ·{" "}
              <span className="mono">{student.matricNumber}</span>
            </div>
            <div className="row">
              {can("results.process") && (
                <Button onClick={() => setEntering(true)}>
                  <Icon name="plus" size={15} /> Enter result
                </Button>
              )}
              {can("results.process") && (list.data?.length ?? 0) > 0 && (
                <Button
                  variant="primary"
                  onClick={() => setConfirmProcess(true)}
                >
                  Process semester
                </Button>
              )}
            </div>
          </div>

          {list.loading ? (
            <div className="muted" style={{ padding: 16 }}>
              Loading…
            </div>
          ) : list.error ? (
            <div className="alert danger">{list.error.message}</div>
          ) : (list.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="No results entered"
              hint="Enter component scores for this student's courses."
            />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Credit</th>
                  <th>Final</th>
                  <th>Grade</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data!.map((r) => {
                  const c = courseById.get(r.courseId);
                  return (
                    <tr key={r.id}>
                      <td>
                        {c ? (
                          <>
                            <span className="mono">{c.code}</span> {c.title}
                          </>
                        ) : (
                          <span className="mono">{r.courseId.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="mono">{c?.creditValue ?? "—"}</td>
                      <td className="mono">{r.finalScore ?? "—"}</td>
                      <td className="mono">{r.grade ?? "—"}</td>
                      <td>
                        {r.isLocked ? (
                          <Badge tone="info">Locked</Badge>
                        ) : (
                          <Badge tone="neutral">Open</Badge>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {r.isLocked && can("results.unlock") && (
                          <Button
                            variant="ghost"
                            onClick={() => setUnlockId(r.id)}
                          >
                            <Icon name="lock" size={14} /> Unlock
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="strong">Total credits</td>
                  <td className="mono strong">{totalCredits}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}

      {entering && student && (
        <EntryModal
          studentId={student.id}
          programmeId={student.programmeId ?? ""}
          semesterId={semesterId}
          onClose={() => setEntering(false)}
          onDone={() => {
            setEntering(false);
            list.reload();
            notify("Result saved");
          }}
        />
      )}

      {confirmProcess && (
        <Modal
          title="Process this semester?"
          subtitle="Computes grades, GPA & credits, then LOCKS the results. Unlocking later is an audited action."
          onClose={() => setConfirmProcess(false)}
        >
          {process.error && (
            <div className="alert danger">{process.error.message}</div>
          )}
          <div className="actions">
            <Button onClick={() => setConfirmProcess(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={process.loading}
              onClick={process.run}
            >
              Process &amp; lock
            </Button>
          </div>
        </Modal>
      )}

      {unlockId && (
        <Modal
          title="Unlock this result?"
          subtitle="The result becomes editable again. This is recorded in the audit log."
          onClose={() => setUnlockId(null)}
        >
          {unlock.error && (
            <div className="alert danger">{unlock.error.message}</div>
          )}
          <div className="actions">
            <Button onClick={() => setUnlockId(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={unlock.loading}
              onClick={unlock.run}
            >
              Unlock
            </Button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function EntryModal({
  studentId,
  programmeId,
  semesterId,
  onClose,
  onDone,
}: {
  studentId: string;
  programmeId: string;
  semesterId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const core = useCore();
  const [courseId, setCourseId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<number | null>(null);
  const [sitting, setSitting] = useState<"NORMAL" | "RESIT">("NORMAL");
  const [status, setStatus] = useState<
    "GRADED" | "DID" | "DISQUALIFIED" | "INCOMPLETE"
  >("GRADED");
  const scoresDisabled = status !== "GRADED";

  const components = useAsync(() => core.getAssessmentStructure({}), []);
  const courses = useAsync(
    () =>
      programmeId
        ? core.listCourses({ where: { programmeId }, take: 200 })
        : Promise.resolve({ items: [], total: 0 }),
    [programmeId],
  );

  const componentScores = useMemo(
    () =>
      (components.data ?? []).map((c) => ({
        key: c.key,
        score: Number(scores[c.key] ?? 0),
      })),
    [components.data, scores],
  );
  const complete =
    scoresDisabled ||
    ((components.data ?? []).length > 0 &&
      (components.data ?? []).every(
        (c) => scores[c.key] !== undefined && scores[c.key] !== null,
      ));

  useEffect(() => {
    let alive = true;
    if (!scoresDisabled && complete) {
      core
        .previewFinalScore({ componentScores })
        .then((p) => alive && setPreview(p))
        .catch(() => alive && setPreview(null));
    } else setPreview(null);
    return () => {
      alive = false;
    };
  }, [core, complete, scoresDisabled, componentScores]);

  const save = useAction(
    () =>
      core.enterResult({
        studentId,
        courseId,
        semesterId,
        componentScores: scoresDisabled ? [] : componentScores,
        sitting,
        status,
      }),
    { onSuccess: onDone },
  );

  return (
    <Modal
      title="Enter result"
      subtitle="The final score is computed by the configured assessment structure."
      onClose={onClose}
    >
      <Field label="Course">
        <select
          className="select"
          aria-label="Course"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
        >
          <option value="">
            {courses.data?.items.length
              ? "Select…"
              : "No courses for this programme"}
          </option>
          {courses.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title} · {c.creditValue} cr
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sitting">
        <select
          className="select"
          aria-label="Sitting"
          value={sitting}
          onChange={(e) => setSitting(e.target.value as "NORMAL" | "RESIT")}
        >
          <option value="NORMAL">Normal</option>
          <option value="RESIT">Resit</option>
        </select>
      </Field>
      <Field label="Status">
        <select
          className="select"
          aria-label="Status"
          value={status}
          onChange={(e) =>
            setStatus(
              e.target.value as
                | "GRADED"
                | "DID"
                | "DISQUALIFIED"
                | "INCOMPLETE",
            )
          }
        >
          <option value="GRADED">Graded</option>
          <option value="DID">Did Not Sit</option>
          <option value="DISQUALIFIED">Disqualified</option>
          <option value="INCOMPLETE">Incomplete</option>
        </select>
      </Field>
      {components.data?.map((c) => (
        <Field key={c.key} label={`${c.label} (max ${c.maxScore})`}>
          <input
            className="input mono"
            type="number"
            min={0}
            max={c.maxScore}
            disabled={scoresDisabled}
            value={scoresDisabled ? "" : (scores[c.key] ?? "")}
            onChange={(e) =>
              setScores((s) => ({ ...s, [c.key]: Number(e.target.value) }))
            }
          />
        </Field>
      ))}
      {!scoresDisabled && (
        <div
          className="spread"
          style={{
            background: "var(--surface-2)",
            padding: "10px 13px",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          <span className="muted">Final score (from core)</span>
          <span
            className="mono"
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-strong)",
            }}
          >
            {preview ?? "—"}
          </span>
        </div>
      )}
      {save.error && <div className="alert danger">{save.error.message}</div>}
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!courseId || !complete}
          loading={save.loading}
          onClick={save.run}
        >
          Save result
        </Button>
      </div>
    </Modal>
  );
}
