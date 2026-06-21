/**
 * Import results — upload a spreadsheet (parsed on the HOST, not in the
 * webview), dry-run validate to a scannable error report, then commit
 * all-or-nothing. The core dedupes and rejects bad rows; nothing writes unless
 * every row is valid.
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
import type { RawRow, ImportReport } from "../runtime/contract";
import { downloadCsvTemplate } from "./import/csvTemplate";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function ImportScreen() {
  const core = useCore();
  const [sessionId, setSessionId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const sessions = useAsync(() => core.listSessions({}), []);
  const semesters = useAsync(
    () => (sessionId ? core.listSemesters({ sessionId }) : Promise.resolve([])),
    [sessionId],
  );
  const structure = useAsync(() => core.getAssessmentStructure({}), []);
  const templateHeaders = [
    "matricNumber",
    "courseCode",
    ...(structure.data ?? []).map((c) => c.key),
    "sitting",
    "status",
  ];

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

  const validate = useAction(
    () => core.importResults({ semesterId, rows: rows!, dryRun: true }),
    { onSuccess: setReport },
  );
  const commit = useAction(
    () => core.importResults({ semesterId, rows: rows! }),
    {
      onSuccess: (r) => {
        setReport(r);
        setCommitted(true);
        setToast(`Imported ${r.imported} rows`);
      },
    },
  );

  const canValidate = semesterId && rows && rows.length > 0;
  const cleanReport = report && report.errors.length === 0;

  return (
    <div className="stack">
      <Card title="1 · Target & file">
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
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
                  downloadCsvTemplate("results-template.csv", templateHeaders)
                }
              >
                Download template
              </Button>
            </div>
          </Field>
        </div>
        {rows && (
          <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
            <span className="mono">{fileName}</span> · {rows.length} rows parsed
          </div>
        )}
        <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
          Columns: <span className="mono">matricNumber</span>,{" "}
          <span className="mono">courseCode</span>, and one column per
          assessment component (e.g. <span className="mono">ca</span>,{" "}
          <span className="mono">exam</span>) — required for graded rows.
          Optional: <span className="mono">sitting</span> (NORMAL/RESIT, default
          NORMAL) and <span className="mono">status</span>{" "}
          (GRADED/DID/DISQUALIFIED/INCOMPLETE, default GRADED). Non-graded rows
          need no scores.
        </div>
      </Card>

      {rows && rows.length > 0 && (
        <Card title="2 · Validate (dry run)">
          <div className="spread">
            <span className="muted">
              Checks every row without writing. Fix all errors, then commit.
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
              Writes all {report!.validRows} rows in one transaction
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
