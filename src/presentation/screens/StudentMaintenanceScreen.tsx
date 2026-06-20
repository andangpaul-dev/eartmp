/**
 * StudentMaintenanceScreen — Phase 10.3
 * Operator-confirmed identity maintenance:
 *   1. Duplicate candidates list with per-pair "Merge" (confirm → mergeStudents)
 *   2. Bulk matricule regeneration panel (faculty + year → confirm → bulkRegenerateMatricules)
 * Both action areas are gated on the `students.manage` permission.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync } from "../runtime/hooks";
import { useDialogs } from "../runtime/DialogProvider";
import { Button, Card, EmptyState, Field } from "../components/ui";
import type { Faculty } from "../runtime/contract";

// ── Duplicate candidates panel ─────────────────────────────────────────────

function DuplicatesPanel() {
  const core = useCore();
  const { confirm } = useDialogs();

  const candidates = useAsync(() => core.findDuplicateCandidates({}), []);

  const handleMerge = async (survivingId: string, duplicateId: string) => {
    const ok = await confirm({
      title: "Merge duplicate student records?",
      message: `Survivor: ${survivingId} · Duplicate: ${duplicateId}. The duplicate will be removed and its data merged into the survivor. This cannot be undone.`,
      confirmLabel: "Confirm",
      danger: true,
    });
    if (!ok) return;
    await core.mergeStudents({ survivingId, duplicateId });
    candidates.reload();
  };

  if (candidates.loading) {
    return (
      <div className="muted" style={{ padding: 16 }}>
        Scanning for duplicates…
      </div>
    );
  }

  if (candidates.error) {
    return <div className="alert danger">{candidates.error.message}</div>;
  }

  if (!candidates.data || candidates.data.length === 0) {
    return (
      <EmptyState
        title="No duplicate candidates"
        hint="No potential duplicate student records were found."
      />
    );
  }

  return (
    <table className="data">
      <thead>
        <tr>
          <th>Survivor ID</th>
          <th>Duplicate ID</th>
          <th>Reason</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {candidates.data.map((pair) => (
          <tr key={`${pair.survivingId}-${pair.duplicateId}`}>
            <td className="mono">{pair.survivingId}</td>
            <td className="mono">{pair.duplicateId}</td>
            <td>{pair.reason}</td>
            <td>
              <Button
                variant="danger"
                onClick={() =>
                  void handleMerge(pair.survivingId, pair.duplicateId)
                }
              >
                Merge
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Bulk matricule regeneration panel ─────────────────────────────────────

function BulkRegenerationPanel() {
  const core = useCore();
  const { confirm } = useDialogs();

  const faculties = useAsync(() => core.listFaculties({}), []);
  const [facultyId, setFacultyId] = useState("");
  const [year, setYear] = useState("");
  const [result, setResult] = useState<{
    regenerated: number;
    skipped: string[];
  } | null>(null);

  const handleRegenerate = async () => {
    const selectedFaculty = faculties.data?.find((f) => f.id === facultyId);
    const yearNum = parseInt(year, 10);
    if (!facultyId || !yearNum) return;

    const ok = await confirm({
      title: "Bulk-regenerate matricules?",
      message: `This will regenerate all matricules for faculty "${selectedFaculty?.name ?? facultyId}" for admission year ${yearNum}. Existing matricules are permanently replaced.`,
      confirmLabel: "Confirm",
      danger: true,
    });
    if (!ok) return;

    const res = await core.bulkRegenerateMatricules({
      facultyId,
      year: yearNum,
    });
    setResult(res);
  };

  const valid = facultyId && year && !isNaN(parseInt(year, 10));

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
        <Field label="Faculty">
          <select
            className="select"
            aria-label="Faculty"
            value={facultyId}
            onChange={(e) => {
              setFacultyId(e.target.value);
              setResult(null);
            }}
          >
            <option value="">Select faculty…</option>
            {faculties.data?.map((f: Faculty) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Admission year">
          <input
            className="input mono"
            aria-label="Admission year"
            type="number"
            min={1900}
            max={2100}
            placeholder="e.g. 2025"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setResult(null);
            }}
          />
        </Field>
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() => void handleRegenerate()}
        >
          Regenerate all
        </Button>
      </div>

      {result && (
        <div className="alert" style={{ marginTop: 8 }}>
          <strong>regenerated:</strong> {result.regenerated} &nbsp;·&nbsp;
          <strong>skipped:</strong> {result.skipped.length}
        </div>
      )}
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────

export function StudentMaintenanceScreen() {
  const { can } = useSession();
  const hasManage = can("students.manage");

  return (
    <div className="stack">
      <Card>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
          Maintenance
        </h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Identity maintenance tools for operator use. Requires{" "}
          <code>students.manage</code> permission.
        </p>

        {hasManage ? (
          <>
            {/* Duplicates section */}
            <section style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                Duplicate candidates
              </h3>
              <DuplicatesPanel />
            </section>

            {/* Bulk regeneration section */}
            <section>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                Bulk matricule regeneration
              </h3>
              <BulkRegenerationPanel />
            </section>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            You do not have the <code>students.manage</code> permission required
            to access maintenance actions.
          </div>
        )}
      </Card>
    </div>
  );
}
