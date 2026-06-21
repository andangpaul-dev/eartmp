/**
 * Import courses — bulk-upload course information from an .xlsx/.csv
 * (parsed on the HOST), scoped to a chosen department / programme / level /
 * semester. Dry-run validates to a scannable report, then commits all-or-nothing.
 * Expected columns: Course code, Course title, Credit Value, Course type.
 */
import { useState } from "react";
import { useCore } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import {
  Button,
  Card,
  Badge,
  Field,
  Toast,
  EmptyState,
} from "../components/ui";
import type { RawRow, CourseImportReport } from "../runtime/contract";
import {
  downloadCsvTemplate,
  COURSE_TEMPLATE_HEADERS,
} from "./import/csvTemplate";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function ImportCoursesScreen() {
  const core = useCore();
  const [facultyId, setFacultyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [semester, setSemester] = useState("");
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<CourseImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const faculties = useAsync(() => core.listFaculties({}), []);
  const departments = useAsync(
    () =>
      facultyId ? core.listDepartments({ facultyId }) : Promise.resolve([]),
    [facultyId],
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

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setReport(null);
    setCommitted(false);
    try {
      const base64 = await fileToBase64(file);
      setRows(await core.parseWorkbook({ base64 }));
    } catch {
      setRows(null);
      setToast("Could not parse that file.");
    }
  };

  const target = () => ({
    rows: rows!,
    departmentId: departmentId || undefined,
    programmeId: programmeId || undefined,
    levelId: levelId || undefined,
    semesterRank: semester ? Number(semester) : undefined,
  });

  const validate = useAction(
    () => core.importCourses({ ...target(), dryRun: true }),
    { onSuccess: setReport },
  );
  const commit = useAction(() => core.importCourses(target()), {
    onSuccess: (r) => {
      setReport(r);
      setCommitted(true);
      setToast(`${r.created} created, ${r.updated} updated`);
    },
  });

  const canValidate =
    departmentId &&
    programmeId &&
    levelId &&
    semester &&
    rows &&
    rows.length > 0;
  const cleanReport = report && report.errors.length === 0;

  return (
    <div className="stack">
      <Card title="1 · Scope & file">
        <div className="form-grid">
          <Field label="Faculty / School">
            <select
              className="select"
              aria-label="Faculty"
              value={facultyId}
              onChange={(e) => {
                setFacultyId(e.target.value);
                setDepartmentId("");
                setProgrammeId("");
                setLevelId("");
              }}
            >
              <option value="">Select…</option>
              {faculties.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Department">
            <select
              className="select"
              aria-label="Department"
              value={departmentId}
              disabled={!facultyId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setProgrammeId("");
                setLevelId("");
              }}
            >
              <option value="">{facultyId ? "Select…" : "—"}</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Programme">
            <select
              className="select"
              aria-label="Programme"
              value={programmeId}
              disabled={!departmentId}
              onChange={(e) => {
                setProgrammeId(e.target.value);
                setLevelId("");
              }}
            >
              <option value="">{departmentId ? "Select…" : "—"}</option>
              {programmes.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Level">
            <select
              className="select"
              aria-label="Level"
              value={levelId}
              disabled={!programmeId}
              onChange={(e) => setLevelId(e.target.value)}
            >
              <option value="">{programmeId ? "Select…" : "—"}</option>
              {levels.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Semester">
            <select
              className="select"
              aria-label="Semester"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
            >
              <option value="">Select…</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </Field>
          <Field label="Spreadsheet (.xlsx / .csv)">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                type="file"
                accept=".xlsx,.csv"
                aria-label="Spreadsheet file"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <Button
                variant="ghost"
                aria-label="Download template"
                onClick={() =>
                  downloadCsvTemplate(
                    "courses-template.csv",
                    COURSE_TEMPLATE_HEADERS,
                  )
                }
              >
                Download template
              </Button>
            </div>
          </Field>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
          Columns: <span className="mono">Course code</span>,{" "}
          <span className="mono">Course title</span>,{" "}
          <span className="mono">Credit Value</span>,{" "}
          <span className="mono">Course type</span>.
          {rows && (
            <>
              {" — "}
              <span className="mono">{fileName}</span> · {rows.length} rows
              parsed
            </>
          )}
        </div>
      </Card>

      {rows && rows.length > 0 && (
        <Card title="2 · Validate (dry run)">
          <div className="spread">
            <span className="muted">
              {canValidate
                ? "Checks every row without writing. Fix all errors, then commit."
                : "Choose department, programme, level and semester first."}
            </span>
            <Button
              variant="primary"
              disabled={!canValidate}
              loading={validate.loading}
              onClick={validate.run}
            >
              Validate
            </Button>
          </div>
          {validate.error && (
            <div className="alert danger" style={{ marginTop: 12 }}>
              {validate.error.message}
            </div>
          )}

          {report && (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                <Badge tone="neutral">{report.totalRows} rows</Badge>
                <Badge tone="success">{report.validRows} valid</Badge>
                {report.errors.length > 0 ? (
                  <Badge tone="danger">
                    {report.errors.length} with errors
                  </Badge>
                ) : (
                  <Badge tone="success">No errors</Badge>
                )}
                {committed && (
                  <>
                    <Badge tone="info">{report.created} created</Badge>
                    <Badge tone="info">{report.updated} updated</Badge>
                  </>
                )}
              </div>
              {report.errors.length > 0 ? (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Problems</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((e) => (
                      <tr key={e.row}>
                        <td className="mono">{e.row}</td>
                        <td style={{ color: "var(--danger-fg)" }}>
                          {e.messages.join("; ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState title="All rows valid" hint="Safe to commit." />
              )}
            </div>
          )}
        </Card>
      )}

      {cleanReport && !committed && (
        <Card title="3 · Commit">
          <div className="spread">
            <span className="muted">
              Writes all {report!.validRows} courses in one transaction
              (all-or-nothing).
            </span>
            <Button
              variant="primary"
              loading={commit.loading}
              onClick={commit.run}
            >
              Commit import
            </Button>
          </div>
          {commit.error && (
            <div className="alert danger" style={{ marginTop: 12 }}>
              {commit.error.message}
            </div>
          )}
        </Card>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
