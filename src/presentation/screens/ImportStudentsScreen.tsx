/**
 * Import students — bulk-upload student information from an .xlsx/.csv
 * (parsed on the HOST), scoped to a chosen faculty / department / sub-department
 * (and optional admission session). Dry-run validates to a scannable report,
 * then commits all-or-nothing. Expected columns: matricNumber, fullName, and
 * optional regNumber, gender, nationality.
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
import type { RawRow, StudentImportReport } from "../runtime/contract";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function ImportStudentsScreen() {
  const core = useCore();
  const [facultyId, setFacultyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [subDepartmentId, setSubDepartmentId] = useState("");
  const [admissionSession, setAdmissionSession] = useState("");
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<StudentImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
  const sessions = useAsync(() => core.listSessions({}), []);

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
    ...(facultyId ? { facultyId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(subDepartmentId ? { subDepartmentId } : {}),
    ...(admissionSession ? { admissionSession } : {}),
  });

  const validate = useAction(
    () => core.importStudents({ ...target(), dryRun: true }),
    { onSuccess: setReport },
  );
  const commit = useAction(() => core.importStudents(target()), {
    onSuccess: (r) => {
      setReport(r);
      setCommitted(true);
      setToast(`Imported ${r.imported} students`);
    },
  });

  const canValidate = facultyId && departmentId && rows && rows.length > 0;
  const cleanReport = report && report.errors.length === 0;

  return (
    <div className="stack">
      <Card title="1 · Placement & file">
        <div className="form-grid">
          <Field label="Faculty / School">
            <select
              className="select"
              aria-label="Faculty"
              value={facultyId}
              onChange={(e) => {
                setFacultyId(e.target.value);
                setDepartmentId("");
                setSubDepartmentId("");
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
                setSubDepartmentId("");
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
          <Field label="Sub-department (optional)">
            <select
              className="select"
              aria-label="Sub-department"
              value={subDepartmentId}
              disabled={
                !departmentId || (subDepartments.data?.length ?? 0) === 0
              }
              onChange={(e) => setSubDepartmentId(e.target.value)}
            >
              <option value="">— none —</option>
              {subDepartments.data?.map((sd) => (
                <option key={sd.id} value={sd.id}>
                  {sd.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Admission session (optional)">
            <select
              className="select"
              aria-label="Admission session"
              value={admissionSession}
              onChange={(e) => setAdmissionSession(e.target.value)}
            >
              <option value="">—</option>
              {sessions.data?.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Spreadsheet (.xlsx / .csv)">
            <input
              className="input"
              type="file"
              accept=".xlsx,.csv"
              aria-label="Spreadsheet file"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </Field>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
          Columns: <span className="mono">matricNumber</span>,{" "}
          <span className="mono">fullName</span> (required);{" "}
          <span className="mono">regNumber</span>,{" "}
          <span className="mono">gender</span>,{" "}
          <span className="mono">nationality</span> (optional).
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
                : "Choose a faculty and department first."}
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
                  <Badge tone="info">{report.imported} imported</Badge>
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
              Writes all {report!.validRows} students in one transaction
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
