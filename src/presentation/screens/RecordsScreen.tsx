/**
 * Records — the cross-student registry of treated transcripts. Lists every
 * issued/treated transcript (newest first) with the student's identity, status,
 * and issue date, filterable by status and searchable by matric / name /
 * number. Each row can be verified (Ed25519, needs the key unsealed), previewed,
 * and — when APPROVED/LOCKED — exported. Read-only registry; issuing happens on
 * the Transcripts screen.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useKeyState } from "../runtime/KeyProvider";
import { useAsync } from "../runtime/hooks";
import {
  Card,
  Badge,
  Button,
  Field,
  Modal,
  Toast,
  EmptyState,
  Icon,
  type Tone,
} from "../components/ui";
import type {
  TranscriptRecord,
  VerifyResult,
  ExportedDoc,
} from "../runtime/contract";

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "warn",
  APPROVED: "info",
  LOCKED: "success",
  REVOKED: "danger",
};

const STATUSES = ["", "DRAFT", "APPROVED", "LOCKED", "REVOKED"] as const;

function downloadDoc(doc: ExportedDoc): void {
  const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: doc.contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RecordsScreen() {
  const core = useCore();
  const { can, session } = useSession();
  const { sealed } = useKeyState();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [facultyId, setFacultyId] = useState("");

  // Faculty filter (#6). A faculty-scoped user only sees their faculties here;
  // the server enforces the boundary regardless.
  const scopedFaculties = session?.facultyIds ?? [];
  const allFaculties = useAsync(() => core.listFaculties({}), []);
  const facultyOptions = (allFaculties.data ?? []).filter(
    (f) => scopedFaculties.length === 0 || scopedFaculties.includes(f.id),
  );
  const [verifyOf, setVerifyOf] = useState<Record<string, VerifyResult>>({});
  const [preview, setPreview] = useState<{
    number: string;
    url: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const records = useAsync(
    () =>
      core.listTranscriptRecords({
        status: status || undefined,
        search,
        ...(facultyId ? { facultyId } : {}),
      }),
    [status, search, facultyId],
  );

  const verify = async (r: TranscriptRecord) => {
    try {
      const v = await core.verifyTranscript({ transcriptId: r.id });
      setVerifyOf((m) => ({ ...m, [r.id]: v }));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Verify failed");
    }
  };

  const showPreview = async (r: TranscriptRecord) => {
    try {
      const doc = await core.exportTranscript({
        transcriptId: r.id,
        preview: true,
      });
      const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: doc.contentType }),
      );
      setPreview({ number: r.transcriptNumber, url });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Preview failed");
    }
  };

  const exportOfficial = async (r: TranscriptRecord) => {
    try {
      downloadDoc(await core.exportTranscript({ transcriptId: r.id }));
      notify(`Exported ${r.transcriptNumber}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export failed");
    }
  };

  return (
    <div className="stack">
      <Card>
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          <Field label="Search">
            <input
              className="input"
              aria-label="Search records"
              placeholder="Matric, name or transcript number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              className="select"
              aria-label="Status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "All"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Faculty">
            <select
              className="select"
              aria-label="Faculty filter"
              value={facultyId}
              onChange={(e) => setFacultyId(e.target.value)}
            >
              <option value="">
                {scopedFaculties.length ? "My faculties" : "All faculties"}
              </option>
              {facultyOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Transcript records">
        {records.loading ? (
          <div className="muted" style={{ padding: 16 }}>
            Loading…
          </div>
        ) : records.error ? (
          <div className="alert danger">{records.error.message}</div>
        ) : (records.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No transcripts yet"
            hint="Generated transcripts appear here across all students."
          />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Number</th>
                <th>Student</th>
                <th>Type</th>
                <th>Status</th>
                <th>Issued</th>
                <th>Signature</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.data!.map((r) => {
                const v = verifyOf[r.id];
                const official =
                  r.status === "APPROVED" || r.status === "LOCKED";
                return (
                  <tr key={r.id}>
                    <td className="mono">{r.transcriptNumber}</td>
                    <td>
                      <span className="mono">{r.matricNumber}</span> ·{" "}
                      {r.studentName}
                    </td>
                    <td>{r.type.replace(/_/g, " ").toLowerCase()}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="mono">
                      {new Date(r.generatedAt).toLocaleDateString()}
                    </td>
                    <td>
                      {v ? (
                        v.valid ? (
                          <span className="verify-ok">
                            <Icon name="check" size={14} /> valid
                          </span>
                        ) : v.revoked ? (
                          <span className="verify-bad">
                            <Icon name="shield" size={14} /> REVOKED
                          </span>
                        ) : !v.signatureValid ? (
                          <span className="verify-bad">
                            <Icon name="shield" size={14} /> INVALID
                          </span>
                        ) : !v.keyMatches ? (
                          <span className="verify-bad">
                            <Icon name="shield" size={14} /> key mismatch
                          </span>
                        ) : (
                          <span className="verify-bad">
                            <Icon name="shield" size={14} /> not issued
                          </span>
                        )
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div
                        className="row"
                        style={{ justifyContent: "flex-end", gap: 6 }}
                      >
                        <Button
                          variant="ghost"
                          disabled={sealed}
                          title={
                            sealed ? "Unseal the key to verify" : undefined
                          }
                          onClick={() => verify(r)}
                        >
                          Verify
                        </Button>
                        <Button variant="ghost" onClick={() => showPreview(r)}>
                          Preview
                        </Button>
                        {can("transcripts.read") && (
                          <Button
                            variant="ghost"
                            disabled={!official}
                            title={
                              official ? undefined : "Only issued transcripts"
                            }
                            onClick={() => exportOfficial(r)}
                          >
                            <Icon name="download" size={14} /> Export
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {preview && (
        <Modal
          title={`Preview · ${preview.number}`}
          subtitle="A4 preview — watermarked DRAFT, not an official copy."
          onClose={() => {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        >
          <object
            className="a4-preview"
            data={preview.url}
            type="application/pdf"
            aria-label="Transcript A4 preview"
          >
            <div className="muted">
              Preview unavailable — use Export to download.
            </div>
          </object>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
