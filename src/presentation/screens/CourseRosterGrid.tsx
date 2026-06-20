/**
 * CourseRosterGrid — batch score-entry for an entire course enrolment.
 *
 * Flow: Session → Semester → Faculty → Department → Programme → Course + Sitting
 * Once a course is selected the roster is loaded (listCourseRoster) and a
 * spreadsheet-style grid is shown: one row per student, one numeric input per
 * assessment component, and a Status selector per row.
 *
 * "Save all"        → saveCourseResults (all rostered students, current scores/status)
 * "Process & lock all" → per-student: processSemester then lockSemesterResults
 */
import { useMemo, useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import { Button, Card, Field, Toast, EmptyState } from "../components/ui";
import type {
  Faculty,
  Department,
  Programme,
  Course,
} from "../runtime/contract";
import type { Student } from "../../domain/entities";
import type { AssessmentComponent } from "../../domain/value-objects/AssessmentStructure";

type Sitting = "NORMAL" | "RESIT";
type RowStatus = "GRADED" | "DID" | "DISQUALIFIED" | "INCOMPLETE";

interface RowState {
  status: RowStatus;
  scores: Record<string, string>; // component key → raw string input
}

function makeDefaultRow(): RowState {
  return { status: "GRADED", scores: {} };
}

export function CourseRosterGrid() {
  const core = useCore();
  const { session } = useSession();

  // ── cascade state ──────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [sitting, setSitting] = useState<Sitting>("NORMAL");

  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [toast, setToast] = useState<string | null>(null);

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  // ── cascade data ───────────────────────────────────────────────────────────
  const sessions = useAsync(() => core.listSessions({}), []);

  const semesters = useAsync(
    () =>
      sessionId
        ? core.listSemesters({ sessionId })
        : Promise.resolve([] as never[]),
    [sessionId],
  );

  // Faculty scope: if session has facultyIds restrict the list
  const scopedFacultyIds: string[] = session?.facultyIds ?? [];
  const allFaculties = useAsync(
    () =>
      sessionId ? core.listFaculties({}) : Promise.resolve([] as Faculty[]),
    [sessionId],
  );
  const facultyOptions = useMemo(
    () =>
      (allFaculties.data ?? []).filter(
        (f: Faculty) =>
          scopedFacultyIds.length === 0 || scopedFacultyIds.includes(f.id),
      ),
    [allFaculties.data, scopedFacultyIds],
  );

  const departments = useAsync(
    () =>
      facultyId
        ? core.listDepartments({ facultyId })
        : Promise.resolve([] as Department[]),
    [facultyId],
  );

  const programmes = useAsync(
    () =>
      departmentId
        ? core.listProgrammes({ departmentId })
        : Promise.resolve([] as Programme[]),
    [departmentId],
  );

  const courses = useAsync(
    () =>
      programmeId
        ? core.listCourses({ where: { programmeId }, take: 200 })
        : Promise.resolve({ items: [] as Course[], total: 0 }),
    [programmeId],
  );

  const components = useAsync(() => core.getAssessmentStructure({}), []);

  // ── session name (needed for listCourseRoster) ─────────────────────────────
  const sessionName = useMemo(
    () => sessions.data?.find((s) => s.id === sessionId)?.name ?? "",
    [sessions.data, sessionId],
  );

  // ── faculty scope hint ─────────────────────────────────────────────────────
  const scopeHint = useMemo(() => {
    if (scopedFacultyIds.length === 0) return null;
    const names = (allFaculties.data ?? [])
      .filter((f: Faculty) => scopedFacultyIds.includes(f.id))
      .map((f: Faculty) => `${f.code} — ${f.name}`)
      .join(", ");
    return names || null;
  }, [allFaculties.data, scopedFacultyIds]);

  // ── roster ─────────────────────────────────────────────────────────────────
  const roster = useAsync(
    () =>
      courseId && sessionName
        ? core.listCourseRoster({ courseId, sessionName })
        : Promise.resolve([] as Student[]),
    [courseId, sessionName],
  );

  // When roster reloads, seed any new students with empty rows
  const students: Student[] = roster.data ?? [];

  // ── row helpers ────────────────────────────────────────────────────────────
  function getRow(studentId: string): RowState {
    return rowStates[studentId] ?? makeDefaultRow();
  }

  function setRowStatus(studentId: string, status: RowStatus) {
    setRowStates((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] ?? makeDefaultRow()), status },
    }));
  }

  function setScore(studentId: string, key: string, value: string) {
    setRowStates((prev) => {
      const row = prev[studentId] ?? makeDefaultRow();
      return {
        ...prev,
        [studentId]: {
          ...row,
          scores: { ...row.scores, [key]: value },
        },
      };
    });
  }

  // ── assemble payload ───────────────────────────────────────────────────────
  function assembleRows() {
    const comps: AssessmentComponent[] = components.data ?? [];
    return students.map((student) => {
      const row = getRow(student.id);
      const isDid = row.status !== "GRADED";
      const componentScores = isDid
        ? []
        : comps.map((c) => ({
            key: c.key,
            score: Number(row.scores[c.key] ?? 0),
          }));
      return {
        studentId: student.id,
        componentScores,
        status: row.status,
      };
    });
  }

  // ── save all ───────────────────────────────────────────────────────────────
  const saveAll = useAction(
    () =>
      core.saveCourseResults({
        semesterId,
        courseId,
        sitting,
        rows: assembleRows(),
      }),
    {
      onSuccess: (result) => {
        notify(
          `Saved ${result.saved} result(s)${result.skipped ? `, ${result.skipped} skipped` : ""}${result.errors.length ? ` (${result.errors.length} error(s))` : ""}`,
        );
      },
    },
  );

  // ── process & lock all ────────────────────────────────────────────────────
  const processAll = useAction(
    async () => {
      const failed: string[] = [];
      for (const student of students) {
        try {
          await core.processSemester({ studentId: student.id, semesterId });
          await core.lockSemesterResults({
            studentId: student.id,
            semesterId,
            sitting,
          });
        } catch {
          failed.push(student.matricNumber ?? student.id);
        }
      }
      if (failed.length > 0) {
        throw new Error(
          `Processed ${students.length - failed.length} of ${students.length}; failed: ${failed.join(", ")}`,
        );
      }
    },
    {
      onSuccess: () => {
        notify("All results processed & locked");
        roster.reload();
      },
    },
  );

  const comps: AssessmentComponent[] = components.data ?? [];
  const rosterReady = courseId && sessionName && semesterId;

  return (
    <div className="stack">
      {/* ── cascade selectors ──────────────────────────────────────────── */}
      <Card>
        {scopeHint && (
          <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
            Showing: {scopeHint}
          </div>
        )}
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          {/* Session */}
          <Field label="Session">
            <select
              className="select"
              aria-label="Session"
              value={sessionId}
              onChange={(e) => {
                setSessionId(e.target.value);
                setSemesterId("");
                setFacultyId("");
                setDepartmentId("");
                setProgrammeId("");
                setCourseId("");
                setRowStates({});
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

          {/* Semester */}
          <Field label="Semester">
            <select
              className="select"
              aria-label="Semester"
              value={semesterId}
              disabled={!sessionId}
              onChange={(e) => {
                setSemesterId(e.target.value);
                setFacultyId("");
                setDepartmentId("");
                setProgrammeId("");
                setCourseId("");
                setRowStates({});
              }}
            >
              <option value="">{sessionId ? "Select…" : "—"}</option>
              {semesters.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Faculty */}
          <Field label="Faculty">
            <select
              className="select"
              aria-label="Faculty"
              value={facultyId}
              disabled={!sessionId}
              onChange={(e) => {
                setFacultyId(e.target.value);
                setDepartmentId("");
                setProgrammeId("");
                setCourseId("");
                setRowStates({});
              }}
            >
              <option value="">{sessionId ? "Select…" : "—"}</option>
              {facultyOptions.map((f: Faculty) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Department */}
          <Field label="Department">
            <select
              className="select"
              aria-label="Department"
              value={departmentId}
              disabled={!facultyId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setProgrammeId("");
                setCourseId("");
                setRowStates({});
              }}
            >
              <option value="">{facultyId ? "Select…" : "—"}</option>
              {departments.data?.map((d: Department) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Programme */}
          <Field label="Programme">
            <select
              className="select"
              aria-label="Programme"
              value={programmeId}
              disabled={!departmentId}
              onChange={(e) => {
                setProgrammeId(e.target.value);
                setCourseId("");
                setRowStates({});
              }}
            >
              <option value="">{departmentId ? "Select…" : "—"}</option>
              {programmes.data?.map((p: Programme) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Course */}
          <Field label="Course">
            <select
              className="select"
              aria-label="Course"
              value={courseId}
              disabled={!programmeId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setRowStates({});
              }}
            >
              <option value="">{programmeId ? "Select…" : "—"}</option>
              {courses.data?.items.map((c: Course) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </Field>

          {/* Sitting */}
          <Field label="Sitting">
            <select
              className="select"
              aria-label="Sitting"
              value={sitting}
              onChange={(e) => {
                setSitting(e.target.value as Sitting);
                setRowStates({});
              }}
            >
              <option value="NORMAL">Normal</option>
              <option value="RESIT">Resit</option>
            </select>
          </Field>
        </div>
      </Card>

      {/* ── roster grid ────────────────────────────────────────────────── */}
      {rosterReady && (
        <Card>
          {roster.loading ? (
            <div className="muted" style={{ padding: 16 }}>
              Loading roster…
            </div>
          ) : roster.error ? (
            <div className="alert danger">{roster.error.message}</div>
          ) : students.length === 0 ? (
            <EmptyState
              title="No students on roster"
              hint="No students are enrolled in this course for the selected session."
            />
          ) : (
            <>
              <div className="spread" style={{ marginBottom: 12 }}>
                <span className="card-title" style={{ margin: 0 }}>
                  {students.length} student{students.length !== 1 ? "s" : ""}
                </span>
                <div className="row">
                  <Button
                    variant="primary"
                    loading={saveAll.loading}
                    onClick={saveAll.run}
                  >
                    Save all
                  </Button>
                  <Button loading={processAll.loading} onClick={processAll.run}>
                    Process &amp; lock all
                  </Button>
                </div>
              </div>

              {saveAll.error && (
                <div className="alert danger">{saveAll.error.message}</div>
              )}
              {processAll.error && (
                <div className="alert danger">{processAll.error.message}</div>
              )}

              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Matric</th>
                      <th>Name</th>
                      {comps.map((c) => (
                        <th key={c.key}>
                          {c.label}{" "}
                          <span className="muted" style={{ fontWeight: 400 }}>
                            /{c.maxScore}
                          </span>
                        </th>
                      ))}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => {
                      const row = getRow(student.id);
                      const disabled = row.status !== "GRADED";
                      return (
                        <tr key={student.id}>
                          <td className="mono">{student.matricNumber}</td>
                          <td>{student.fullName}</td>
                          {comps.map((c) => (
                            <td key={c.key}>
                              <input
                                className="input mono"
                                type="number"
                                min={0}
                                max={c.maxScore}
                                disabled={disabled}
                                aria-label={`${c.label} score for ${student.id}`}
                                value={
                                  disabled ? "" : (row.scores[c.key] ?? "")
                                }
                                onChange={(e) =>
                                  setScore(student.id, c.key, e.target.value)
                                }
                                style={{ width: 72 }}
                              />
                            </td>
                          ))}
                          <td>
                            <select
                              className="select"
                              aria-label={`Status for ${student.id}`}
                              value={row.status}
                              onChange={(e) =>
                                setRowStatus(
                                  student.id,
                                  e.target.value as RowStatus,
                                )
                              }
                            >
                              <option value="GRADED">Graded</option>
                              <option value="DID">Did Not Sit</option>
                              <option value="DISQUALIFIED">Disqualified</option>
                              <option value="INCOMPLETE">Incomplete</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
