/**
 * Structure — manage the academic hierarchy: Faculty/School → Department →
 * Sub-department → Programme → Level (with a per-level grade scale), plus the
 * courses under a department/sub-department. A drill-down: selecting an item on
 * the left reveals its children on the right. Writes are gated structure.manage
 * (courses by courses.create / courses.update); reads need structure.read.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync } from "../runtime/hooks";
import { Card, Button, Field, Toast, Icon } from "../components/ui";
import type { Level, Course, StoredGradeScale } from "../runtime/contract";

const COURSE_TYPES = ["CORE", "ELECTIVE", "PRACTICAL", "CLINICAL"] as const;

export function StructureScreen() {
  const core = useCore();
  const { can } = useSession();
  const manage = can("structure.manage");
  const [facultyId, setFacultyId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [subDepartmentId, setSubDepartmentId] = useState<string | null>(null);
  const [programmeId, setProgrammeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const guard = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notify(ok);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action failed");
    }
  };

  const faculties = useAsync(() => core.listFaculties({}), []);
  const departments = useAsync(
    () =>
      facultyId ? core.listDepartments({ facultyId }) : Promise.resolve([]),
    [facultyId],
  );
  const subDepartments = useAsync(
    () =>
      departmentId
        ? core.listSubDepartments({ departmentId })
        : Promise.resolve([]),
    [departmentId],
  );
  const programmes = useAsync(
    () =>
      departmentId
        ? core.listProgrammes({ departmentId })
        : Promise.resolve([]),
    [departmentId],
  );
  const levels = useAsync(
    () =>
      programmeId ? core.listLevels({ programmeId }) : Promise.resolve([]),
    [programmeId],
  );
  const gradeScales = useAsync(() => core.listGradeScales({}), []);
  const courses = useAsync(
    () =>
      departmentId
        ? core.listCourses({
            where: subDepartmentId ? { subDepartmentId } : { departmentId },
            take: 200,
          })
        : Promise.resolve({ items: [], total: 0 }),
    [departmentId, subDepartmentId],
  );

  return (
    <div className="stack">
      <div className="form-grid">
        {/* Faculties */}
        <Panel
          title="Faculties / Schools"
          items={faculties.data ?? []}
          loading={faculties.loading}
          selectedId={facultyId}
          onSelect={(id) => {
            setFacultyId(id);
            setDepartmentId(null);
            setSubDepartmentId(null);
            setProgrammeId(null);
          }}
          canManage={manage}
          onAdd={(name, code) =>
            guard(async () => {
              await core.createFaculty({ name, code });
              faculties.reload();
            }, "Faculty created")
          }
          onRename={(it, name) =>
            guard(async () => {
              await core.updateFaculty({ id: it.id, patch: { name } });
              faculties.reload();
            }, "Renamed")
          }
          onDelete={(it) =>
            guard(async () => {
              await core.deleteFaculty({ id: it.id });
              if (facultyId === it.id) setFacultyId(null);
              faculties.reload();
            }, "Deleted")
          }
        />

        {/* Departments */}
        <Panel
          title="Departments"
          hint={facultyId ? undefined : "Select a faculty"}
          items={departments.data ?? []}
          loading={departments.loading}
          selectedId={departmentId}
          onSelect={(id) => {
            setDepartmentId(id);
            setSubDepartmentId(null);
            setProgrammeId(null);
          }}
          canManage={manage && !!facultyId}
          onAdd={(name, code) =>
            guard(async () => {
              await core.createDepartment({
                name,
                code,
                facultyId: facultyId!,
              });
              departments.reload();
            }, "Department created")
          }
          onRename={(it, name) =>
            guard(async () => {
              await core.updateDepartment({ id: it.id, patch: { name } });
              departments.reload();
            }, "Renamed")
          }
          onDelete={(it) =>
            guard(async () => {
              await core.deleteDepartment({ id: it.id });
              if (departmentId === it.id) setDepartmentId(null);
              departments.reload();
            }, "Deleted")
          }
        />

        {/* Sub-departments */}
        <Panel
          title="Sub-departments"
          hint={departmentId ? undefined : "Select a department"}
          items={subDepartments.data ?? []}
          loading={subDepartments.loading}
          selectedId={subDepartmentId}
          onSelect={setSubDepartmentId}
          canManage={manage && !!departmentId}
          onAdd={(name, code) =>
            guard(async () => {
              await core.createSubDepartment({
                name,
                code,
                departmentId: departmentId!,
              });
              subDepartments.reload();
            }, "Sub-department created")
          }
          onRename={(it, name) =>
            guard(async () => {
              await core.updateSubDepartment({ id: it.id, patch: { name } });
              subDepartments.reload();
            }, "Renamed")
          }
          onDelete={(it) =>
            guard(async () => {
              await core.deleteSubDepartment({ id: it.id });
              if (subDepartmentId === it.id) setSubDepartmentId(null);
              subDepartments.reload();
            }, "Deleted")
          }
        />

        {/* Programmes */}
        <Panel
          title="Programmes"
          hint={departmentId ? undefined : "Select a department"}
          items={programmes.data ?? []}
          loading={programmes.loading}
          selectedId={programmeId}
          onSelect={setProgrammeId}
          canManage={manage && !!departmentId}
          onAdd={(name, code) =>
            guard(async () => {
              await core.createProgramme({
                name,
                code,
                departmentId: departmentId!,
                ...(subDepartmentId ? { subDepartmentId } : {}),
              });
              programmes.reload();
            }, "Programme created")
          }
          onRename={(it, name) =>
            guard(async () => {
              await core.updateProgramme({ id: it.id, patch: { name } });
              programmes.reload();
            }, "Renamed")
          }
          onDelete={(it) =>
            guard(async () => {
              await core.deleteProgramme({ id: it.id });
              if (programmeId === it.id) setProgrammeId(null);
              programmes.reload();
            }, "Deleted")
          }
        />
      </div>

      {/* Levels + per-level grade scale */}
      {programmeId && (
        <Card title="Levels & per-level grade scale">
          <LevelsPanel
            levels={levels.data ?? []}
            loading={levels.loading}
            scales={gradeScales.data ?? []}
            canManage={manage}
            onAdd={(name, rank) =>
              guard(async () => {
                await core.createLevel({ name, rank, programmeId });
                levels.reload();
              }, "Level created")
            }
            onSetScale={(level, gradeScaleId) =>
              guard(async () => {
                await core.updateLevel({
                  id: level.id,
                  patch: { gradeScaleId },
                });
                levels.reload();
              }, "Grade scale updated")
            }
            onDelete={(level) =>
              guard(async () => {
                await core.deleteLevel({ id: level.id });
                levels.reload();
              }, "Deleted")
            }
          />
        </Card>
      )}

      {/* Courses for the selected department / sub-department */}
      {departmentId && (
        <Card
          title={`Courses — ${subDepartmentId ? "sub-department" : "department"}`}
        >
          <CoursesPanel
            courses={courses.data?.items ?? []}
            loading={courses.loading}
            levels={levels.data ?? []}
            canCreate={can("courses.create")}
            canUpdate={can("courses.update")}
            onAdd={(c) =>
              guard(async () => {
                await core.createCourse({
                  ...c,
                  departmentId: departmentId!,
                  ...(subDepartmentId ? { subDepartmentId } : {}),
                  ...(programmeId ? { programmeId } : {}),
                });
                courses.reload();
              }, "Course created")
            }
            onDelete={(c) =>
              guard(async () => {
                await core.deleteCourse({ id: c.id });
                courses.reload();
              }, "Deleted")
            }
          />
        </Card>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

type NamedCoded = { id: string; name: string; code: string };

function Panel<T extends NamedCoded>({
  title,
  hint,
  items,
  loading,
  selectedId,
  onSelect,
  canManage,
  onAdd,
  onRename,
  onDelete,
}: {
  title: string;
  hint?: string;
  items: T[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canManage: boolean;
  onAdd: (name: string, code: string) => void;
  onRename: (item: T, name: string) => void;
  onDelete: (item: T) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <Card title={title}>
      {hint ? (
        <div className="muted" style={{ padding: "4px 0 8px" }}>
          {hint}
        </div>
      ) : loading ? (
        <div className="muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="muted" style={{ padding: "4px 0 8px" }}>
          None yet.
        </div>
      ) : (
        <ul className="picklist">
          {items.map((it) => (
            <li
              key={it.id}
              className={`picklist-row ${selectedId === it.id ? "active" : ""}`}
            >
              <button className="picklist-main" onClick={() => onSelect(it.id)}>
                <span className="mono">{it.code}</span> {it.name}
              </button>
              {canManage && (
                <span className="picklist-actions">
                  <button
                    className="iconbtn"
                    title="Rename"
                    onClick={() => {
                      const n = window.prompt(`Rename "${it.name}"`, it.name);
                      if (n && n.trim()) onRename(it, n.trim());
                    }}
                  >
                    <Icon name="config" size={13} />
                  </button>
                  <button
                    className="iconbtn"
                    title="Delete"
                    onClick={() => {
                      if (window.confirm(`Delete "${it.name}"?`)) onDelete(it);
                    }}
                  >
                    <Icon name="lock" size={13} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <input
            className="input mono"
            style={{ width: 70 }}
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input
            className="input"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            variant="primary"
            disabled={!name.trim() || !code.trim()}
            onClick={() => {
              onAdd(name.trim(), code.trim());
              setName("");
              setCode("");
            }}
          >
            <Icon name="plus" size={14} />
          </Button>
        </div>
      )}
    </Card>
  );
}

function LevelsPanel({
  levels,
  loading,
  scales,
  canManage,
  onAdd,
  onSetScale,
  onDelete,
}: {
  levels: Level[];
  loading: boolean;
  scales: StoredGradeScale[];
  canManage: boolean;
  onAdd: (name: string, rank: number) => void;
  onSetScale: (level: Level, gradeScaleId: string | null) => void;
  onDelete: (level: Level) => void;
}) {
  const [name, setName] = useState("");
  const [rank, setRank] = useState("");
  if (loading) return <div className="muted">Loading…</div>;
  return (
    <>
      <table className="data">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Grade scale (per level)</th>
            {canManage && <th />}
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.id}>
              <td className="mono">{l.rank}</td>
              <td>{l.name}</td>
              <td>
                <select
                  className="select"
                  aria-label={`Grade scale for level ${l.name}`}
                  disabled={!canManage}
                  value={l.gradeScaleId ?? ""}
                  onChange={(e) => onSetScale(l, e.target.value || null)}
                >
                  <option value="">Institution default</option>
                  {scales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </td>
              {canManage && (
                <td style={{ textAlign: "right" }}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete level "${l.name}"?`))
                        onDelete(l);
                    }}
                  >
                    Delete
                  </Button>
                </td>
              )}
            </tr>
          ))}
          {levels.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No levels yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {canManage && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <input
            className="input mono"
            style={{ width: 70 }}
            placeholder="Rank"
            value={rank}
            onChange={(e) => setRank(e.target.value)}
          />
          <input
            className="input"
            placeholder="Name (e.g. 100)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            variant="primary"
            disabled={!name.trim() || !Number.isInteger(Number(rank))}
            onClick={() => {
              onAdd(name.trim(), Number(rank));
              setName("");
              setRank("");
            }}
          >
            <Icon name="plus" size={14} /> Level
          </Button>
        </div>
      )}
    </>
  );
}

function CoursesPanel({
  courses,
  loading,
  levels,
  canCreate,
  canUpdate,
  onAdd,
  onDelete,
}: {
  courses: Course[];
  loading: boolean;
  levels: Level[];
  canCreate: boolean;
  canUpdate: boolean;
  onAdd: (c: {
    code: string;
    title: string;
    creditValue: number;
    courseType: Course["courseType"];
    levelId?: string;
  }) => void;
  onDelete: (c: Course) => void;
}) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [credit, setCredit] = useState("3");
  const [type, setType] = useState<Course["courseType"]>("CORE");
  const [levelId, setLevelId] = useState("");
  if (loading) return <div className="muted">Loading…</div>;
  return (
    <>
      <table className="data">
        <thead>
          <tr>
            <th>Code</th>
            <th>Title</th>
            <th>Credit</th>
            <th>Type</th>
            {canUpdate && <th />}
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.code}</td>
              <td>{c.title}</td>
              <td className="mono">{c.creditValue}</td>
              <td>{c.courseType.toLowerCase()}</td>
              {canUpdate && (
                <td style={{ textAlign: "right" }}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete course "${c.code}"?`))
                        onDelete(c);
                    }}
                  >
                    Delete
                  </Button>
                </td>
              )}
            </tr>
          ))}
          {courses.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No courses yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {canCreate && (
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label="Code">
            <input
              className="input mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label="Title">
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Credit value">
            <input
              className="input mono"
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
            />
          </Field>
          <Field label="Type">
            <select
              className="select"
              aria-label="Course type"
              value={type}
              onChange={(e) => setType(e.target.value as Course["courseType"])}
            >
              {COURSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Level (optional)">
            <select
              className="select"
              aria-label="Course level"
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
            >
              <option value="">—</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button
              variant="primary"
              disabled={
                !code.trim() ||
                !title.trim() ||
                !Number.isInteger(Number(credit)) ||
                Number(credit) <= 0
              }
              onClick={() => {
                onAdd({
                  code: code.trim(),
                  title: title.trim(),
                  creditValue: Number(credit),
                  courseType: type,
                  ...(levelId ? { levelId } : {}),
                });
                setCode("");
                setTitle("");
              }}
            >
              <Icon name="plus" size={14} /> Add course
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
