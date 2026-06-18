/**
 * Structure — manage the academic hierarchy: Faculty/School → Department →
 * Sub-department → Programme → Level (with a per-level grade scale), plus the
 * courses under a department/sub-department. A drill-down: selecting an item on
 * the left reveals its children on the right. Writes are gated structure.manage
 * (courses by courses.create / courses.update); reads need structure.read.
 */
import { useEffect, useMemo, useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync } from "../runtime/hooks";
import { Card, Button, Field, Modal, Toast, Icon } from "../components/ui";
import type {
  Level,
  Course,
  Programme,
  StoredGradeScale,
} from "../runtime/contract";

const COURSE_TYPES = ["CORE", "ELECTIVE", "PRACTICAL", "CLINICAL"] as const;
// Standard two-semester year; the per-course semester is still free-form (any
// positive rank), these are just the quick-pick groupings shown per level.
const SEMESTERS = [1, 2] as const;
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const sumCredits = (cs: Course[]) =>
  cs.reduce((n, c) => n + (c.creditValue || 0), 0);

export function StructureScreen() {
  const core = useCore();
  const { can } = useSession();
  const manage = can("structure.manage");
  const [institutionId, setInstitutionId] = useState("");
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

  const institutions = useAsync(() => core.listInstitutions({}), []);
  const allFaculties = useAsync(() => core.listFaculties({}), []);
  // Scope faculties to the chosen institution (empty = all).
  const facultyItems = (allFaculties.data ?? []).filter(
    (f) => !institutionId || f.institutionId === institutionId,
  );
  const faculties = { ...allFaculties, data: facultyItems };
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

  const selectedProgramme =
    (programmes.data ?? []).find((p) => p.id === programmeId) ?? null;

  // Create any missing Level rows for ranks 1..years (the curriculum's years of
  // training), so courses can be organised per year. Never deletes existing levels.
  const generateLevels = (years: number) =>
    guard(async () => {
      const have = new Set((levels.data ?? []).map((l) => l.rank));
      for (let rank = 1; rank <= years; rank++) {
        if (!have.has(rank)) {
          await core.createLevel({
            name: `Level ${rank}`,
            rank,
            programmeId: programmeId!,
          });
        }
      }
      await levels.reload();
    }, "Levels generated");

  return (
    <div className="stack">
      <Card>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <Field label="Institution">
            <select
              className="select"
              aria-label="Institution"
              value={institutionId}
              onChange={(e) => {
                setInstitutionId(e.target.value);
                setFacultyId(null);
                setDepartmentId(null);
                setSubDepartmentId(null);
                setProgrammeId(null);
              }}
            >
              <option value="">All institutions</option>
              {institutions.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </Field>
          {manage && (
            <span className="muted" style={{ alignSelf: "flex-end" }}>
              {institutionId
                ? "New faculties are added under this institution."
                : "Showing all faculties — pick an institution to scope new ones."}
            </span>
          )}
        </div>
      </Card>

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
              await core.createFaculty({
                name,
                code,
                ...(institutionId ? { institutionId } : {}),
              });
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
              const created = await core.createProgramme({
                name,
                code,
                departmentId: departmentId!,
                ...(subDepartmentId ? { subDepartmentId } : {}),
              });
              // Lay out Level 1..N up front so the curriculum is ready per year
              // the moment the new programme is opened.
              for (
                let rank = 1;
                rank <= (created.durationLevels || 4);
                rank++
              ) {
                await core.createLevel({
                  name: `Level ${rank}`,
                  rank,
                  programmeId: created.id,
                });
              }
              programmes.reload();
            }, "Programme created with levels")
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

      {/* Curriculum for the selected programme — years of training, levels and
          courses organised per year (Level 1, Level 2 …) → semester. */}
      {programmeId && selectedProgramme && (
        <CurriculumCard
          programme={selectedProgramme}
          levels={levels.data ?? []}
          loading={levels.loading || courses.loading}
          courses={courses.data?.items ?? []}
          scales={gradeScales.data ?? []}
          canManage={manage}
          canCreateCourse={can("courses.create")}
          canUpdateCourse={can("courses.update")}
          onSaveProgramme={(patch) =>
            guard(async () => {
              await core.updateProgramme({ id: selectedProgramme.id, patch });
              await programmes.reload();
            }, "Programme saved")
          }
          onGenerateLevels={generateLevels}
          onSetLevelScale={(level, gradeScaleId) =>
            guard(async () => {
              await core.updateLevel({ id: level.id, patch: { gradeScaleId } });
              levels.reload();
            }, "Grade scale updated")
          }
          onDeleteLevel={(level) =>
            guard(async () => {
              await core.deleteLevel({ id: level.id });
              levels.reload();
            }, "Level deleted")
          }
          onAddCourse={(c) =>
            guard(async () => {
              await core.createCourse({
                ...c,
                departmentId: departmentId!,
                ...(subDepartmentId ? { subDepartmentId } : {}),
                programmeId: selectedProgramme.id,
              });
              courses.reload();
            }, "Course added")
          }
          onUpdateCourse={(id, patch) =>
            guard(async () => {
              await core.updateCourse({ id, patch });
              courses.reload();
            }, "Course saved")
          }
          onDeleteCourse={(c) =>
            guard(async () => {
              await core.deleteCourse({ id: c.id });
              courses.reload();
            }, "Course deleted")
          }
        />
      )}

      {/* Department catalogue when no programme is selected (shared/elective
          courses not yet placed in a programme's curriculum). */}
      {departmentId && !programmeId && (
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

type NewCourse = {
  code: string;
  title: string;
  creditValue: number;
  courseType: Course["courseType"];
  levelId?: string;
  semesterRank?: number;
};

/**
 * CurriculumCard — the programme's academic & curricular organigram: editable
 * programme details (name, code, YEARS OF TRAINING → Level 1…N, credits
 * required), the courses organised per year then per semester with credit
 * subtotals, an "unassigned" bucket, and the programme credit total vs the
 * graduation requirement. Course rows are editable via a modal (Cancel/Save).
 */
function CurriculumCard({
  programme,
  levels,
  loading,
  courses,
  scales,
  canManage,
  canCreateCourse,
  canUpdateCourse,
  onSaveProgramme,
  onGenerateLevels,
  onSetLevelScale,
  onDeleteLevel,
  onAddCourse,
  onUpdateCourse,
  onDeleteCourse,
}: {
  programme: Programme;
  levels: Level[];
  loading: boolean;
  courses: Course[];
  scales: StoredGradeScale[];
  canManage: boolean;
  canCreateCourse: boolean;
  canUpdateCourse: boolean;
  onSaveProgramme: (patch: {
    name: string;
    code: string;
    durationLevels: number;
    creditsRequired: number;
  }) => void;
  onGenerateLevels: (years: number) => void;
  onSetLevelScale: (level: Level, gradeScaleId: string | null) => void;
  onDeleteLevel: (level: Level) => void;
  onAddCourse: (c: NewCourse) => void;
  onUpdateCourse: (id: string, patch: Partial<Course>) => void;
  onDeleteCourse: (c: Course) => void;
}) {
  const [name, setName] = useState(programme.name);
  const [code, setCode] = useState(programme.code);
  const [years, setYears] = useState(String(programme.durationLevels));
  const [credits, setCredits] = useState(String(programme.creditsRequired));
  const [editing, setEditing] = useState<Course | null>(null);

  // Re-sync the editor when a different programme is selected or after a save.
  useEffect(() => {
    setName(programme.name);
    setCode(programme.code);
    setYears(String(programme.durationLevels));
    setCredits(String(programme.creditsRequired));
  }, [
    programme.id,
    programme.name,
    programme.code,
    programme.durationLevels,
    programme.creditsRequired,
  ]);

  const yearsN = Number(years);
  const creditsN = Number(credits);
  const detailsValid =
    name.trim().length > 0 &&
    code.trim().length > 0 &&
    Number.isInteger(yearsN) &&
    yearsN > 0 &&
    yearsN <= 12 &&
    Number.isInteger(creditsN) &&
    creditsN >= 0;
  const dirty =
    name !== programme.name ||
    code !== programme.code ||
    years !== String(programme.durationLevels) ||
    credits !== String(programme.creditsRequired);
  const reset = () => {
    setName(programme.name);
    setCode(programme.code);
    setYears(String(programme.durationLevels));
    setCredits(String(programme.creditsRequired));
  };

  const sortedLevels = useMemo(
    () => [...levels].sort((a, b) => a.rank - b.rank),
    [levels],
  );
  const levelIds = useMemo(() => new Set(levels.map((l) => l.id)), [levels]);
  const progCourses = courses.filter(
    (c) =>
      c.programmeId === programme.id || (c.levelId && levelIds.has(c.levelId)),
  );
  const unassigned = progCourses.filter((c) => !c.levelId);
  const total = sumCredits(progCourses);
  const missing = Number.isInteger(yearsN)
    ? Array.from({ length: Math.max(0, yearsN) }, (_, i) => i + 1).filter(
        (r) => !levels.some((l) => l.rank === r),
      ).length
    : 0;

  return (
    <Card title={`Curriculum — ${programme.name}`}>
      {/* ---- Programme details (editable) ---- */}
      {canManage ? (
        <>
          <div className="form-grid">
            <Field label="Programme name">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Code">
              <input
                className="input mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field label="Years of training">
              <input
                className="input mono"
                type="number"
                min={1}
                max={12}
                value={years}
                onChange={(e) => setYears(e.target.value)}
              />
            </Field>
            <Field label="Credits required (graduation)">
              <input
                className="input mono"
                type="number"
                min={0}
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
            </Field>
          </div>
          <div className="actions">
            {missing > 0 && Number.isInteger(yearsN) && (
              <Button onClick={() => onGenerateLevels(yearsN)}>
                <Icon name="plus" size={14} /> Generate {missing} level
                {missing > 1 ? "s" : ""}
              </Button>
            )}
            <Button disabled={!dirty} onClick={reset}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!dirty || !detailsValid}
              onClick={() =>
                onSaveProgramme({
                  name: name.trim(),
                  code: code.trim(),
                  durationLevels: yearsN,
                  creditsRequired: creditsN,
                })
              }
            >
              Save
            </Button>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            “Years of training” defines Level 1…N. Use “Generate levels” to
            create any missing years, then add each year’s courses below.
          </div>
        </>
      ) : (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {programme.durationLevels} year(s) of training ·{" "}
          {programme.creditsRequired} credits required.
        </div>
      )}

      {/* ---- Per-year curriculum ---- */}
      {loading ? (
        <div className="muted" style={{ marginTop: 12 }}>
          Loading…
        </div>
      ) : sortedLevels.length === 0 ? (
        <div className="muted" style={{ marginTop: 12 }}>
          No levels yet — set the years of training above and Generate levels.
        </div>
      ) : (
        sortedLevels.map((level) => (
          <LevelSection
            key={level.id}
            level={level}
            courses={progCourses.filter((c) => c.levelId === level.id)}
            scales={scales}
            canManage={canManage}
            canCreateCourse={canCreateCourse}
            canUpdateCourse={canUpdateCourse}
            onSetScale={onSetLevelScale}
            onDeleteLevel={onDeleteLevel}
            onAddCourse={onAddCourse}
            onEditCourse={setEditing}
            onDeleteCourse={onDeleteCourse}
          />
        ))
      )}

      {/* ---- Courses not yet placed in a year ---- */}
      {unassigned.length > 0 && (
        <div className="level-section">
          <div className="row" style={{ alignItems: "baseline" }}>
            <strong>Not assigned to a year</strong>
            <span className="muted" style={{ marginLeft: 8 }}>
              {unassigned.length} course(s) · {sumCredits(unassigned)} credits —
              edit a course to place it in a year.
            </span>
          </div>
          <CourseTable
            courses={unassigned}
            canUpdate={canUpdateCourse}
            onEdit={setEditing}
            onDelete={onDeleteCourse}
          />
        </div>
      )}

      {/* ---- Programme credit total vs requirement ---- */}
      {sortedLevels.length > 0 && (
        <div
          className="row"
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: "1px solid var(--border)",
            alignItems: "center",
          }}
        >
          <strong>Total curriculum credits: {total}</strong>
          {programme.creditsRequired > 0 && (
            <span
              className={`badge ${
                total >= programme.creditsRequired ? "success" : "warn"
              }`}
              style={{ marginLeft: 10 }}
            >
              <span className="bdot" />
              {total >= programme.creditsRequired
                ? `meets the ${programme.creditsRequired} required`
                : `${programme.creditsRequired - total} short of ${programme.creditsRequired}`}
            </span>
          )}
        </div>
      )}

      {editing && (
        <EditCourseModal
          course={editing}
          levels={sortedLevels}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            onUpdateCourse(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

/** One year of the curriculum: header (grade scale + delete), courses grouped
 *  by semester with subtotals, and an inline add-course row. */
function LevelSection({
  level,
  courses,
  scales,
  canManage,
  canCreateCourse,
  canUpdateCourse,
  onSetScale,
  onDeleteLevel,
  onAddCourse,
  onEditCourse,
  onDeleteCourse,
}: {
  level: Level;
  courses: Course[];
  scales: StoredGradeScale[];
  canManage: boolean;
  canCreateCourse: boolean;
  canUpdateCourse: boolean;
  onSetScale: (level: Level, gradeScaleId: string | null) => void;
  onDeleteLevel: (level: Level) => void;
  onAddCourse: (c: NewCourse) => void;
  onEditCourse: (c: Course) => void;
  onDeleteCourse: (c: Course) => void;
}) {
  const groups = [
    ...SEMESTERS.map((s) => ({
      label: `Semester ${s}`,
      items: courses.filter((c) => c.semesterRank === s),
    })),
    {
      label: "No semester",
      items: courses.filter(
        (c) => !c.semesterRank || !SEMESTERS.includes(c.semesterRank as 1 | 2),
      ),
    },
  ];
  return (
    <div className="level-section">
      <div className="row" style={{ alignItems: "center", gap: 10 }}>
        <strong>
          Level {level.rank}: {level.name}
        </strong>
        <span className="muted">
          {courses.length} course(s) · {sumCredits(courses)} credits
        </span>
        <div style={{ flex: 1 }} />
        {canManage && (
          <select
            className="select"
            aria-label={`Grade scale for level ${level.name}`}
            value={level.gradeScaleId ?? ""}
            onChange={(e) => onSetScale(level, e.target.value || null)}
          >
            <option value="">Institution default scale</option>
            {scales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {canManage && (
          <Button
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Delete level "${level.name}"?`))
                onDeleteLevel(level);
            }}
          >
            Delete level
          </Button>
        )}
      </div>
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <div key={g.label} style={{ marginTop: 6 }}>
            <div
              className="muted"
              style={{ fontSize: 11.5, fontWeight: 600, margin: "6px 0 2px" }}
            >
              {g.label} · {sumCredits(g.items)} credits
            </div>
            <CourseTable
              courses={g.items}
              canUpdate={canUpdateCourse}
              onEdit={onEditCourse}
              onDelete={onDeleteCourse}
            />
          </div>
        ),
      )}
      {courses.length === 0 && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          No courses in this year yet.
        </div>
      )}
      {canCreateCourse && (
        <AddCourseRow onAdd={(c) => onAddCourse({ ...c, levelId: level.id })} />
      )}
    </div>
  );
}

function CourseTable({
  courses,
  canUpdate,
  onEdit,
  onDelete,
}: {
  courses: Course[];
  canUpdate: boolean;
  onEdit: (c: Course) => void;
  onDelete: (c: Course) => void;
}) {
  return (
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
            <td>{titleCase(c.courseType)}</td>
            {canUpdate && (
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <Button variant="ghost" onClick={() => onEdit(c)}>
                  Edit
                </Button>
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
      </tbody>
    </table>
  );
}

/** Inline add-course row for a single year (level is supplied by the section). */
function AddCourseRow({
  onAdd,
}: {
  onAdd: (c: Omit<NewCourse, "levelId">) => void;
}) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [credit, setCredit] = useState("3");
  const [type, setType] = useState<Course["courseType"]>("CORE");
  const [sem, setSem] = useState("1");
  const valid =
    code.trim().length > 0 &&
    title.trim().length > 0 &&
    Number.isInteger(Number(credit)) &&
    Number(credit) > 0;
  return (
    <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      <input
        className="input mono"
        style={{ width: 90 }}
        placeholder="Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <input
        className="input"
        style={{ minWidth: 160 }}
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="input mono"
        style={{ width: 64 }}
        placeholder="Cr"
        aria-label="Credit value"
        value={credit}
        onChange={(e) => setCredit(e.target.value)}
      />
      <select
        className="select"
        aria-label="Course type"
        value={type}
        onChange={(e) => setType(e.target.value as Course["courseType"])}
      >
        {COURSE_TYPES.map((t) => (
          <option key={t} value={t}>
            {titleCase(t)}
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label="Semester"
        value={sem}
        onChange={(e) => setSem(e.target.value)}
      >
        {SEMESTERS.map((s) => (
          <option key={s} value={s}>
            Sem {s}
          </option>
        ))}
        <option value="">No sem</option>
      </select>
      <Button
        variant="primary"
        disabled={!valid}
        onClick={() => {
          onAdd({
            code: code.trim(),
            title: title.trim(),
            creditValue: Number(credit),
            courseType: type,
            ...(sem ? { semesterRank: Number(sem) } : {}),
          });
          setCode("");
          setTitle("");
          setCredit("3");
        }}
      >
        <Icon name="plus" size={14} /> Add course
      </Button>
    </div>
  );
}

/** Edit a course (Cancel/Save) — change its details, move it to another year or
 *  semester. Code is immutable (the identifier on results/transcripts). */
function EditCourseModal({
  course,
  levels,
  onClose,
  onSave,
}: {
  course: Course;
  levels: Level[];
  onClose: () => void;
  onSave: (patch: Partial<Course>) => void;
}) {
  const [title, setTitle] = useState(course.title);
  const [credit, setCredit] = useState(String(course.creditValue));
  const [type, setType] = useState<Course["courseType"]>(course.courseType);
  const [levelId, setLevelId] = useState(course.levelId ?? "");
  const [sem, setSem] = useState(
    course.semesterRank ? String(course.semesterRank) : "",
  );
  const creditN = Number(credit);
  const valid =
    title.trim().length > 0 && Number.isInteger(creditN) && creditN > 0;
  return (
    <Modal
      title={`Edit ${course.code}`}
      subtitle="Course details"
      onClose={onClose}
    >
      <div className="form-grid">
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
            type="number"
            min={1}
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
                {titleCase(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Year / Level">
          <select
            className="select"
            aria-label="Course level"
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
          >
            <option value="">Not assigned</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                Level {l.rank}: {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Semester">
          <select
            className="select"
            aria-label="Semester"
            value={sem}
            onChange={(e) => setSem(e.target.value)}
          >
            <option value="">None</option>
            {SEMESTERS.map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() =>
            onSave({
              title: title.trim(),
              creditValue: creditN,
              courseType: type,
              ...(levelId ? { levelId } : {}),
              ...(sem ? { semesterRank: Number(sem) } : {}),
            })
          }
        >
          Save
        </Button>
      </div>
    </Modal>
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
